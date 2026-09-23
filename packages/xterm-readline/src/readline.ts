import { Terminal, ITerminalAddon, IDisposable } from "@xterm/xterm";
import { Input, InputType, parseInput } from "./keymap";
import { State } from "./state";
import { History } from "./history";
import { Output, Tty } from "./tty";
import { Highlighter, IdentityHighlighter } from "./highlight";

interface ActiveRead {
  prompt: string;
  resolve: (input: string | null) => void;
  reject: (e: unknown) => void;
  cancelable: boolean;
  onKey?: (input: Input) => boolean;
  historyEntry?: (line: string) => string;
}

/** write 콜백을 기다리는 읽기 하나. `cancelled`는 콜백 도착 전에 `cancelRead()`가 먼저 끝냈는지 표시한다. */
interface PendingRead {
  reject: (e: unknown) => void;
  cancelled: boolean;
}

/** `cancelRead()`가 읽기를 끝낼 때 reject 사유로 쓰는 오류. */
export class ReadCancelledError extends Error {
  constructor() {
    super("read cancelled");
    this.name = "ReadCancelledError";
  }
}

type CheckHandler = (text: string) => boolean;
type CtrlCHandler = () => void;
type PauseHandler = (resume: boolean) => void;

export interface ReadlineOptions {
  /** false면 history를 localStorage에 저장·복원하지 않는다. 기본값은 true(원본 동작). */
  persist?: boolean;
  /**
   * true면 공백뿐인(trim 결과 빈 문자열) 제출을 history에 넣지 않고 cursor만 처음으로 되돌린다.
   * 기본값은 false(원본 동작 — 공백뿐인 제출도 그대로 기록).
   */
  skipBlankHistory?: boolean;
}

export interface ReadOptions {
  /** true면 활성 읽기 중 Ctrl+C가 읽기를 null로 끝낸다(줄 바꿈만, ^C·history 없음). 기본 false = 원본 동작. */
  cancelable?: boolean;
  /**
   * write 콜백 안에서 새 입력 상태(State)를 만든 직후 1회 채워 넣는 텍스트. 커서는 끝에 놓인다.
   * `read()` 호출 직후(콜백 밖)의 `updateLine()`은 이 타이밍보다 앞서 실행되어 사라지므로 이 옵션으로만
   * 넣는다.
   */
  prefill?: string;
  /**
   * 활성 읽기의 키마다 벤더 처리 앞에서 부른다. `true`를 돌려주면 벤더 처리를 생략한다(소비).
   * 활성 읽기가 없을 때(write 콜백 대기 중 포함)는 부르지 않는다. `readPaste`가 `editInsert`로 바로
   * 넣는 `Text` 토큰은 거치지 않는다(코드로 흘러들어온 텍스트에는 훅이 반응하지 않는다).
   */
  onKey?: (input: Input) => boolean;
  /**
   * Enter로 제출된 줄을 history에 넣기 직전에 부른다. 돌려준 문자열이 기록된다.
   * `skipBlankHistory`가 거른 공백뿐인 제출에는 부르지 않는다. 취소(`cancelable` Ctrl+C)에도
   * 부르지 않는다.
   */
  historyEntry?: (line: string) => string;
}

export class Readline implements ITerminalAddon {
  private term: Terminal | undefined;
  private highlighter: Highlighter = new IdentityHighlighter();
  private history: History;
  private activeRead: ActiveRead | undefined;
  private disposables: IDisposable[] = [];
  /** write 콜백이 아직 오지 않아 activeRead가 없는 읽기들. dispose·cancelRead가 이들도 끝내야 한다. */
  private pendingReads = new Set<PendingRead>();
  private watermark = 0;
  private highWatermark = 10000;
  private lowWatermark = 1000;
  private highWater = false;
  private state: State;
  private skipBlankHistory: boolean;
  /** `printAbove`가 재그리기 콜백을 기다리는 동안 true. 이 사이 들어온 키는 벤더가 바로 처리하지 않고 `queued`에 쌓는다. */
  private redrawing = false;
  /** `redrawing`인 동안 `readData`로 들어온 원본 문자열(키 하나 또는 붙여넣기 덩어리)을 순서대로 쌓아 둔다. */
  private queued: string[] = [];
  private checkHandler: CheckHandler = () => true;
  private ctrlCHandler: CtrlCHandler = () => {
    return;
  };

  private pauseHandler: PauseHandler = (resume: boolean) => {
    return;
  };

  constructor(options: ReadlineOptions = {}) {
    // history 옵션을 받기 위해 필드 초기화에서 생성자로 옮겼다. 생성 순서(history → state)는 원본과 같다.
    this.history = new History(50, { persist: options.persist });
    this.state = new State(">", this.tty(), this.highlighter, this.history);
    this.history.restoreFromLocalStorage();
    this.skipBlankHistory = options.skipBlankHistory ?? false;
  }

  /**
   * Activate this addon - this function is called by xterm's
   * loadAddon().
   *
   * @param term - The terminal this readline is attached to.
   */
  public activate(term: Terminal): void {
    this.term = term;
    this.disposables.push(this.term.onData(this.readData.bind(this)));
    this.disposables.push(
      this.term.onResize(({ cols, rows }) => {
        const tty = this.state.getTty();
        tty.col = cols;
        tty.row = rows;
        if (tty.anchorRow >= rows) tty.anchorRow = Math.max(0, rows - 1);
        if (this.activeRead !== undefined) {
          this.state.refresh();
        }
      })
    );
    this.term.attachCustomKeyEventHandler(this.handleKeyEvent.bind(this));
  }

  /**
   * Dispose
   *
   * 리스너를 해제하고 term을 비운다. 대기 중인 읽기(write 콜백 대기 중인 것 포함)는 Error로 reject한다.
   * term.dispose()도 addon을 dispose하므로 두 번 불릴 수 있어 두 번째 호출은 아무것도 하지 않는다.
   */
  public dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
    this.term = undefined;
    const rejects = [...this.pendingReads].map((p) => p.reject);
    if (this.activeRead !== undefined) rejects.push(this.activeRead.reject);
    this.pendingReads.clear();
    this.activeRead = undefined;
    this.redrawing = false;
    this.queued = [];
    const error = new Error("readline disposed");
    rejects.forEach((reject) => reject(error));
  }

  /**
   * 열린 읽기(활성 읽기 + write 콜백을 기다리는 읽기)를 `ReadCancelledError`로 끝낸다.
   * `dispose()`와 달리 리스너·term·history·state는 건드리지 않고 화면에도 아무것도 쓰지 않는다
   * (개행·안내 줄 여부는 호출자가 결정한다). 열린 읽기가 없으면 아무것도 하지 않는다.
   */
  public cancelRead(): void {
    const pending = [...this.pendingReads];
    this.pendingReads.clear();
    pending.forEach((p) => {
      p.cancelled = true;
    });
    const active = this.activeRead;
    this.activeRead = undefined;
    const error = new ReadCancelledError();
    pending.forEach((p) => p.reject(error));
    active?.reject(error);
  }

  /**
   * Manually append a line to the top of the readline's history.
   *
   * @param text - The text to append to history.
   */
  public appendHistory(text: string) {
    this.history.append(text);
  }

  /**
   * history 객체 그대로. 코어의 블록 history(RD-014)가 `entries` 스냅샷·`restore`에 쓴다.
   */
  public getHistory(): History {
    return this.history;
  }

  /**
   * Set the highlighter handler for this readline. This is used to
   * create custom highlighting functionality (e.g. for syntax highlighting
   * or bracket matching).
   *
   * @param highlighter - A handler to handle all highlight callbacks.
   */
  public setHighlighter(highlighter: Highlighter) {
    this.highlighter = highlighter;
  }

  /**
   * Set the check callback. This callback is used by readline to determine if input
   * requires additiona lines when the user presses 'enter'.
   *
   * @param fn - A function (string) -> boolean that should return true if the input
   *             is complete, and false if a line (\n) should be added to the input.
   */
  public setCheckHandler(fn: CheckHandler) {
    this.checkHandler = fn;
  }

  /**
   * Set the ctrl-c handler. This function will be called if ctrl-c is encountered
   * between readline reads. This may be used in circumstances where input from the
   * user may result in a long running task that can be cancelled.
   *
   * @param fn - The ctrl-c handler.
   */
  public setCtrlCHandler(fn: CtrlCHandler) {
    this.ctrlCHandler = fn;
  }

  /**
   * Set the callback to be called when the user presses ctrl-s/ctrl-q.
   *
   * @param fn - The pause handler
   */
  public setPauseHandler(fn: PauseHandler) {
    this.pauseHandler = fn;
  }

  /**
   * writeReady() may be used to implement basic output flow control. This function
   * will return false if the writes to the terminal initiated by Readline have
   * reached a highwater mark.
   *
   * @returns true if this terminal is accepting more input.
   */
  public writeReady(): boolean {
    return !this.highWater;
  }

  /**
   * Write text to the terminal.
   *
   * @param text - The text to write to the terminal.
   */
  public write(text: string) {
    if (text === "\n") {
      text = "\r\n";
    } else {
      text = text.replace(/^\n/, "\r\n");
      text = text.replace(/([^\r])\n/g, "$1\r\n");
    }
    const outputLength = text.length;
    this.watermark += outputLength;
    if (this.watermark > this.highWatermark) {
      this.highWater = true;
    }
    if (this.term) {
      this.term.write(text, () => {
        this.watermark = Math.max(this.watermark - outputLength, 0);
        if (this.highWater && this.watermark < this.lowWatermark) {
          this.highWater = false;
        }
      });
    }
  }

  /**
   * Write text to the terminal.
   *
   * @param text - The text to write to the terminal
   */
  public print(text: string) {
    return this.write(text);
  }

  /**
   * Write text to the terminal and append with "\r\n".
   *
   * @param text - The text to write to the terminal./
   * @returns
   */
  public println(text: string) {
    return this.write(text + "\r\n");
  }

  /**
   * 활성 입력줄 위에 `text`를 출력하고 입력줄을 같은 읽기로 다시 그린다. 활성 읽기가 없으면
   * `println`과 같다. 출력이 끝나기 전에 들어온 입력은 큐에 두었다가 순서대로 재생한다(TRP-008).
   *
   * @param text - 입력줄 위에 찍을 텍스트. 여러 줄이면 `\n`으로 잇는다(`write`가 `\r\n`으로 정규화).
   */
  public printAbove(text: string): void {
    if (this.activeRead === undefined || this.term === undefined) {
      this.println(text);
      return;
    }
    // moveCursorToEnd()는 물리적 커서를 버퍼 끝(여러 줄로 감긴 경우 마지막 행)으로 옮겨야 그
    // 아래에 원시 텍스트를 안전하게 쓸 수 있지만, 논리 커서(line.pos)도 함께 옮긴다. 재그리기
    // 뒤에는 원래 위치로 돌려놓아야 하므로 먼저 저장해 둔다.
    const cursor = this.state.cursor();
    this.state.moveCursorToEnd();
    this.write("\r\n" + text + "\r\n");
    this.redrawing = true;
    this.term.write("", () => {
      // 콜백이 오기 전에 dispose됐으면 해제된 터미널의 buffer를 건드리지 않는다(TRP-004).
      // dispose()가 이미 redrawing·queued를 비웠지만 명시적으로 한 번 더 맞춰 둔다.
      if (this.term === undefined) {
        this.redrawing = false;
        return;
      }
      // 콜백이 오기 전에 cancelRead()로 읽기가 끝났으면 이미 취소된 입력줄을 다시 그리지
      // 않는다. redrawing·queued도 비워야 다음 read()가 깨끗하게 시작한다.
      if (this.activeRead === undefined) {
        this.redrawing = false;
        this.queued = [];
        return;
      }
      this.state.getTty().anchorRow = this.term.buffer.active.cursorY;
      this.state.restoreCursor(cursor);
      // moveCursorToEnd()가 남긴 옛 레이아웃(감긴 경우 마지막 행 기준)을 새 앵커 기준
      // 레이아웃으로 되돌린다. 이게 없으면 refresh()가 옛 커서 행 기준으로 위로 올라가
      // 방금 쓴 원시 텍스트나 입력줄 일부를 \x1b[J로 지운다(다중 행 블록 입력 회귀).
      this.state.resetLayout();
      this.state.refresh();
      this.redrawing = false;
      const queued = this.queued;
      this.queued = [];
      for (const data of queued) {
        this.readData(data);
      }
    });
  }

  /**
   * Get the current line.
   *
   * @returns string - The current line
   */
  public getLine() {
    return this.state.buffer();
  }

  /**
   * Update the current line.
   *
   * @param text - The text to write to the terminal./
   * @returns
   */
  public updateLine(text: string) {
    return this.state.update(text);
  }

  /**
   * 현재 버퍼의 커서 위치(UTF-16 인덱스)를 돌려준다. `getLine`/`updateLine`과 같은 수준으로 활성
   * 읽기가 없어도 현재 state에 작용한다.
   */
  public getCursor(): number {
    return this.state.cursor();
  }

  /** 현재 커서 위치에 텍스트를 끼워 넣는다(원본 편집 경로와 같은 `State.editInsert`). */
  public editInsert(text: string): void {
    this.state.editInsert(text);
  }

  /** 커서 앞 n글자를 지운다(원본 편집 경로와 같은 `State.editBackspace`). */
  public editBackspace(n: number): void {
    this.state.editBackspace(n);
  }

  /**
   * Obtain an output interface to this terminal.
   *
   * @returns Output
   */
  public output(): Output {
    return this;
  }

  /**
   * Obtain a tty interface to this terminal.
   *
   * @returns A tty
   */
  public tty(): Tty {
    if (this.term?.options?.tabStopWidth !== undefined) {
      const anchor = this.term.buffer.active.cursorY;
      return new Tty(
        this.term.cols,
        this.term.rows,
        this.term.options.tabStopWidth,
        this.output(),
        anchor
      );
    } else {
      return new Tty(0, 0, 8, this.output());
    }
  }

  /**
   * Display the given prompt and wait for one line of input from the
   * terminal. The returned promise will be executed when a line has been
   * read from the terminal.
   *
   * @param prompt The prompt to use.
   * @returns A promise to be called when the input has been read.
   */
  public read(prompt: string): Promise<string>;
  /**
   * 취소 가능한 읽기. options.cancelable이 true면 Ctrl+C가 읽기를 null로 끝낸다.
   *
   * @param prompt 프롬프트.
   * @param options 읽기 옵션.
   * @returns 입력 한 줄 또는 취소를 뜻하는 null.
   */
  public read(prompt: string, options: ReadOptions): Promise<string | null>;
  public read(
    prompt: string,
    options: ReadOptions = {}
  ): Promise<string | null> {
    const cancelable = options.cancelable === true;
    return new Promise((resolve, reject) => {
      if (this.term === undefined) {
        reject("addon is not active");
        return;
      }
      // term.write is buffered, so any prior prints (e.g. an animated logo)
      // may not have updated buffer.active.cursorY by the time we read it
      // synchronously. Wait for the buffer to flush so the anchor row
      // accurately reflects where the prompt will land.
      const pending: PendingRead = { reject, cancelled: false };
      this.pendingReads.add(pending);
      this.term.write("", () => {
        this.pendingReads.delete(pending);
        // 콜백이 오기 전에 dispose됐으면 이미 reject됐다. 해제된 터미널에는 닿지 않는다.
        if (this.term === undefined) return;
        // 콜백이 오기 전에 cancelRead()로 이미 reject됐다. activeRead를 되살리지 않는다.
        if (pending.cancelled) return;
        this.state = new State(
          prompt,
          this.tty(),
          this.highlighter,
          this.history
        );
        if (options.prefill !== undefined && options.prefill !== "") {
          this.state.update(options.prefill);
        } else {
          this.state.refresh();
        }
        this.activeRead = {
          prompt,
          resolve,
          reject,
          cancelable,
          onKey: options.onKey,
          historyEntry: options.historyEntry,
        };
      });
    });
  }

  private handleKeyEvent(event: KeyboardEvent): boolean {
    if (event.key === "Enter" && event.shiftKey) {
      if (event.type === "keydown") {
        this.readKey({
          inputType: InputType.ShiftEnter,
          data: ["\r"],
        });
      }
      return false;
    }
    return true;
  }

  private readData(data: string) {
    if (this.redrawing) {
      // 재그리기(printAbove) 중 도착한 데이터는 원본 문자열째로 쌓아 둔다. 붙여넣기 덩어리도
      // 하나로 보관해 재생 시 readPaste 경로를 그대로 타게 한다.
      this.queued.push(data);
      return;
    }
    const input = parseInput(data);
    if (
      input.length > 1 ||
      (input[0].inputType === InputType.Text && input[0].data.length > 1)
    ) {
      this.readPaste(input);
      return;
    }
    this.readKey(input[0]);
  }

  private readPaste(input: Input[]) {
    const mappedInput = input.map((it) => {
      if (it.inputType === InputType.Enter) {
        return { inputType: InputType.Text, data: ["\n"] };
      }
      if (
        it.inputType === InputType.UnsupportedControlChar &&
        it.data.length === 1 &&
        it.data[0] === "\t"
      ) {
        return { inputType: InputType.Text, data: ["\t"] };
      }
      return it;
    });

    for (const it of mappedInput) {
      if (it.inputType === InputType.Text) {
        this.state.editInsert(it.data.join(""));
      } else {
        this.readKey(it);
      }
    }
  }

  private readKey(input: Input) {
    if (this.activeRead === undefined) {
      switch (input.inputType) {
        case InputType.CtrlC:
          this.ctrlCHandler();
          break;
        case InputType.CtrlL:
          this.write("\x1b[H\x1b[2J");
          break;
      }
      return;
    }

    if (this.activeRead.onKey?.(input)) {
      return;
    }

    switch (input.inputType) {
      case InputType.Text:
        this.state.editInsert(input.data.join(""));
        break;
      case InputType.AltEnter:
      case InputType.ShiftEnter:
        this.state.editInsert("\n");
        break;
      case InputType.Enter:
        if (this.checkHandler(this.state.buffer())) {
          this.state.moveCursorToEnd();
          // Strip any cursor-driven highlight (e.g. matching brackets)
          // before committing so the line frozen in scrollback is plain.
          this.state.refreshUnhighlighted();
          this.term?.write("\r\n");
          if (this.skipBlankHistory && this.state.buffer().trim() === "") {
            this.history.resetCursor();
          } else {
            const line = this.state.buffer();
            this.history.append(this.activeRead?.historyEntry?.(line) ?? line);
          }
          this.activeRead?.resolve(this.state.buffer());
          this.activeRead = undefined;
        } else {
          this.state.editInsert("\n");
        }
        break;
      case InputType.CtrlC:
        if (this.activeRead.cancelable) {
          // 취소: Enter와 같은 순서로 줄을 확정하되 ^C를 찍지 않고 history에도 넣지 않는다.
          this.state.moveCursorToEnd();
          this.state.refreshUnhighlighted();
          this.term?.write("\r\n");
          // resolve 콜백이 동기로 다음 read()를 불러도 상태가 꼬이지 않게 먼저 비운다.
          const cancelled = this.activeRead;
          this.activeRead = undefined;
          cancelled.resolve(null);
          break;
        }
        this.state.moveCursorToEnd();
        this.term?.write("^C\r\n");
        this.state = new State(
          this.activeRead.prompt,
          this.tty(),
          this.highlighter,
          this.history
        );
        this.state.refresh();
        break;
      case InputType.CtrlS:
        this.pauseHandler(false);
        break;
      case InputType.CtrlU:
        this.state.update("");
        break;
      case InputType.CtrlK:
        this.state.editDeleteEndOfLine();
        break;
      case InputType.CtrlQ:
        this.pauseHandler(true);
        break;
      case InputType.CtrlL:
        this.state.clearScreen();
        break;
      case InputType.Home:
      case InputType.CtrlA:
        this.state.moveCursorHome();
        break;
      case InputType.End:
      case InputType.CtrlE:
        this.state.moveCursorEnd();
        break;
      case InputType.Backspace:
        this.state.editBackspace(1);
        break;
      case InputType.Delete:
      case InputType.CtrlD:
        this.state.editDelete(1);
        break;
      case InputType.ArrowLeft:
        this.state.moveCursorBack(1);
        break;
      case InputType.ArrowRight:
        this.state.moveCursorForward(1);
        break;
      case InputType.ArrowUp:
        this.state.moveCursorUp(1);
        break;
      case InputType.ArrowDown:
        this.state.moveCursorDown(1);
        break;
      case InputType.UnsupportedControlChar:
      case InputType.UnsupportedEscape:
        break;
    }
  }
}
