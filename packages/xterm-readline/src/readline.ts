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
        this.activeRead = { prompt, resolve, reject, cancelable };
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
          this.history.append(this.state.buffer());
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
