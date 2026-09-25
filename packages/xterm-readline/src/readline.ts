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

/**
 * 재그리기 하나. 콜백을 기다리는 동안 들어온 `printAbove`·`printAboveRaw` 호출은 새로 만들지 않고 여기에 합류한다.
 * `cancelRead()`·`takeRead()`·`dispose()`가 `Readline.redraw`에서 떼어 내면 무효가 된다.
 */
interface RedrawRun {
  /** 합류한 호출 수. 각 호출의 write 콜백은 자기 순번이 마지막일 때만 다시 그린다. */
  calls: number;
  /** 합류한 호출들의 resolve. 마지막 콜백이 다시 그린 뒤, 또는 무효가 된 뒤 첫 콜백에서 한꺼번에 부른다. */
  waiters: (() => void)[];
}

/** 기다리던 호출을 모두 resolve한다. 두 번 불려도 한 번만 resolve한다. */
function settleRun(run: RedrawRun) {
  for (const resolve of run.waiters.splice(0)) resolve();
}

/** `cancelRead()`가 읽기를 끝낼 때 reject 사유로 쓰는 오류. */
export class ReadCancelledError extends Error {
  constructor() {
    super("read cancelled");
    this.name = "ReadCancelledError";
  }
}

/**
 * `takeRead()`가 읽기를 끝낼 때 reject 사유로 쓰는 오류. 제출(resolve)도 취소(`ReadCancelledError`)도
 * 아니라 "호출자가 입력 상태를 가져갔다"는 뜻이라 별도 클래스로 구분한다.
 */
export class ReadTakenError extends Error {
  constructor() {
    super("read taken");
    this.name = "ReadTakenError";
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
  /**
   * 모든 `keydown`/`keypress`/`keyup`에서 벤더 `handleKeyEvent` 처리 앞에서 부른다. `true`를
   * 돌려주면 벤더 처리를 생략하고 `handleKeyEvent` 자체도 xterm에 `false`를 돌려준다(xterm의
   * 기본 처리도 생략됨). 활성 읽기 유무와 무관하게 항상 불린다.
   */
  onKeyEvent?: (event: KeyboardEvent) => boolean;
  /**
   * false면 활성 읽기가 없는 구간(실행 중·`read()` write 콜백 대기 중·부팅 중)에 들어온 입력을 쌓지 않고
   * 버린다(키·붙여넣기·IME 조합 완성 덩어리·Shift+Enter). Ctrl+C·Ctrl+L 단독 입력은 그대로 즉시 처리한다.
   * 활성 읽기 중 `printAbove` 재그리기 동안 쌓는 `queued`는 이 옵션의 대상이 아니다. 기본값은 true
   * (type-ahead 동작). `=== false`일 때만 끈다.
   */
  typeAhead?: boolean;
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
   * `prefill`을 채운 직후 커서를 둘 위치(UTF-16 인덱스). `[0, prefill 길이]`로 자른다. `prefill`이 없거나
   * 빈 문자열이면 무시한다. 생략하면 커서는 끝에 놓인다. `takeRead()`가 돌려준 커서를 그대로 넘기면 된다.
   */
  prefillCursor?: number;
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

/**
 * 활성 읽기가 없는 구간에 친 키를 쌓아 두는 버퍼의 상한(UTF-16 코드 유닛 합계). Linux tty
 * `N_TTY_BUF_SIZE`와 같다. 넘치는 덩어리는 통째로 버린다.
 */
const TYPE_AHEAD_LIMIT = 4096;

/** `prefillCursor`를 `[0, length]`로 자른다. 생략·NaN이면 끝(`length`)이다. */
function clampCursor(cursor: number | undefined, length: number): number {
  if (cursor === undefined || Number.isNaN(cursor)) return length;
  return Math.min(Math.max(Math.trunc(cursor), 0), length);
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
  private onKeyEvent?: (event: KeyboardEvent) => boolean;
  /** false면 활성 읽기가 없을 때 들어온 입력을 `pushTypeAhead`에서 버린다. `options.typeAhead === false`일 때만 false. */
  private typeAheadEnabled: boolean;
  /**
   * `printAbove`·`printAboveRaw`가 기다리는 재그리기. 있는 동안(`redrawing`) 들어온 키는 벤더가 바로 처리하지 않고
   * `queued`에 쌓는다.
   */
  private redraw: RedrawRun | undefined;
  /**
   * `redrawing`인 동안 들어온 입력을 순서대로 쌓아 둔다. 문자열은 `onData` 원본(키 하나 또는 붙여넣기
   * 덩어리), `Input`은 `onData`를 거치지 않는 Shift+Enter다.
   */
  private queued: (string | Input)[] = [];
  /**
   * 재그리기를 시작할 때의 논리 커서. `printAbove`의 `moveCursorToEnd()`가 `line.pos`를 끝으로 옮기므로 재그리기
   * 콜백과 재그리기 중 `takeRead()`가 원래 커서를 쓰려면 따로 보관해야 한다. 겹친 호출은 덮어쓰지 않는다(처음 값).
   * 재그리기 대기 중 공개 편집 API(`editInsert`·`editBackspace`·`updateLine`)는 이 커서 자리의 버퍼를 고치고 이 값을 편집 뒤
   * 커서로 바꾼다.
   */
  private redrawCursor = 0;
  /**
   * 활성 읽기가 없을 때(실행 중·`read()` write 콜백 대기 중·부팅 중) 들어온 입력을 순서대로 쌓아 둔다
   * (type-ahead). `onData` 덩어리는 원본 문자열째, Shift+Enter는 `Input`째 쌓는다. 다음 `read()`의 write
   * 콜백이 재생하고, Ctrl+C·`cancelRead()`·`dispose()`가 비운다. Ctrl+C·Ctrl+L 단독 입력은 쌓지 않는다.
   */
  private typeAhead: (string | Input)[] = [];
  /** `typeAhead`에 쌓인 덩어리 길이(UTF-16 코드 유닛) 합계. `TYPE_AHEAD_LIMIT` 검사에 쓴다. */
  private typeAheadLength = 0;
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
    this.onKeyEvent = options.onKeyEvent;
    this.typeAheadEnabled = options.typeAhead !== false;
  }

  /** 재그리기 콜백을 기다리는 중인가. */
  private get redrawing(): boolean {
    return this.redraw !== undefined;
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
        // 재그리기 대기 중에는 입력줄이 화면에 없다. 지금 그리면 출력 아래에 흔적 행이 남고 콜백이 한 번 더 그린다.
        // 크기는 위에서 이미 갱신했으므로 콜백(`finishRedraw`)이 새 크기로 그린다.
        if (this.activeRead !== undefined && !this.redrawing) {
          this.state.refresh();
        }
      }),
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
    // 기다리던 재그리기를 무효로 해 늦은 콜백이 해제된 터미널에 닿지 않게 한다(TRP-004).
    this.redraw = undefined;
    this.queued = [];
    this.clearTypeAhead();
    const error = new Error("readline disposed");
    rejects.forEach((reject) => reject(error));
  }

  /**
   * 열린 읽기(활성 읽기 + write 콜백을 기다리는 읽기)를 `ReadCancelledError`로 끝낸다.
   * `dispose()`와 달리 리스너·term·history·state는 건드리지 않고 화면에도 아무것도 쓰지 않는다
   * (개행·안내 줄 여부는 호출자가 결정한다). 열린 읽기가 없으면 아무것도 하지 않는다.
   */
  public cancelRead(): void {
    // 리셋은 새 프로세스라 옛 맥락에서 쌓인 키를 다음 읽기에 넘기지 않는다.
    this.clearTypeAhead();
    // 취소 이전에 queued에 쌓인 키는 옛 맥락이라 폐기하고, 이후 도착하는 키는 activeRead가 없으므로 type-ahead로 가게 한다.
    // 기다리던 재그리기는 무효가 되어 늦은 콜백이 그리지 않는다(다음 읽기의 재그리기도 건드리지 않는다).
    this.redraw = undefined;
    this.queued = [];
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
   * 열린 읽기를 제출·history 없이 끝내고 입력 상태를 가져간다. 열린 읽기가 없으면 아무것도 하지 않고
   * `undefined`를 돌려준다.
   *
   * - 활성 읽기: 프롬프트 첫 행부터 입력 마지막 행까지(감긴 행·멀티라인 버퍼 포함) 화면에서 지우고 커서를
   *   프롬프트 첫 행 열 0에 둔다. 프롬프트 앞에 붙은 꼬리(`a>>> `의 `a`)도 프롬프트라 함께 지워지므로 복원은
   *   호출자가 한다. 돌려주는 값은 지우기 전의 텍스트·커서다.
   * - write 콜백을 기다리는 읽기(아직 그려지지 않음): 화면에 그린 것이 없으므로 `{ text: "", cursor: 0 }`이다.
   *   늦게 오는 콜백은 읽기를 되살리지 않는다(`cancelRead()`와 같은 `cancelled` 표시).
   * - `printAbove` 재그리기 중: 입력줄은 이미 출력 위에 남았고 그 아래에 출력이 있어 지울 수 없다. 재그리기
   *   콜백 전의 텍스트·저장 커서(`redrawCursor`)를 돌려준다 — 재그리기 대기 중 공개 편집 API(`editInsert`·
   *   `editBackspace`·`updateLine`)가 화면 밖에서 고친 버퍼·커서를 반영한 값이다. 늦게 오는 재그리기 콜백은
   *   재그리기가 무효가 되어 입력줄을 다시 그리지 않는다.
   * - `printAboveRaw` 재그리기 중: 입력줄·접두는 이미 지워졌고 아직 다시 그려지지 않아 지울 것이 없다. 처리는
   *   위와 같다. 접두는 화면에 없으므로 필요하면 호출자가 이 호출 전에 `abovePrefix()`로 읽어 다시 쓴다.
   *
   * 읽기 promise는 `ReadTakenError`로 reject한다(`ReadCancelledError`와 구분). 재그리기 중 쌓인 키(`queued`)는
   * type-ahead로 옮겨 다음 읽기가 재생한다. 이미 쌓인 type-ahead는 그대로 둔다. history는 건드리지 않는다.
   */
  public takeRead(): { text: string; cursor: number } | undefined {
    const active = this.activeRead;
    const pending = [...this.pendingReads];
    if (active === undefined && pending.length === 0) return undefined;

    let taken = { text: "", cursor: 0 };
    if (active !== undefined) {
      if (this.redrawing) {
        taken = { text: this.state.buffer(), cursor: this.redrawCursor };
      } else {
        taken = { text: this.state.buffer(), cursor: this.state.cursor() };
        this.state.erase();
      }
    }

    this.activeRead = undefined;
    this.pendingReads.clear();
    pending.forEach((p) => {
      p.cancelled = true;
    });
    // 재그리기 중 쌓인 키는 지금부터 활성 읽기가 없으므로 type-ahead로 옮겨 순서를 보존한다.
    const queued = this.queued;
    this.queued = [];
    this.redraw = undefined;
    for (const entry of queued) {
      this.pushTypeAhead(entry);
    }

    const error = new ReadTakenError();
    pending.forEach((p) => p.reject(error));
    active?.reject(error);
    return taken;
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
   * 돌려주는 프로미스는 재그리기(활성 읽기가 없으면 `println`)가 실제로 끝난 뒤 resolve한다 —
   * 호출자(코어 `tab-reader.ts`)가 재그리기 도중에 큐의 다음 키를 벤더 큐를 우회해 처리하지
   * 않도록 순서를 맞추는 용도다(DELTA-04a). 조기 반환 두 경로(`term`·`activeRead` 없음)도
   * 매달리지 않게 각각 resolve한다.
   *
   * 옛 입력행(접두 포함)은 화면에 남기므로 새 입력행은 접두 없이 그린다(접두를 비운다). 재그리기를 기다리는
   * 중(앞선 `printAbove`·`printAboveRaw`)에 불리면 그 재그리기에 합류한다: 입력줄은 화면에 없고 커서는 앞 출력
   * 아래 행 머리이므로 앞 `\r\n` 없이 `text`를 쓰고, 아직 그리지 않은 접두는 먼저 자기 행으로 쓴다. 저장 커서는
   * 처음 값을 유지하고 프로미스는 합친 재그리기가 끝날 때 resolve한다.
   *
   * @param text - 입력줄 위에 찍을 텍스트. 여러 줄이면 `\n`으로 잇는다(`write`가 `\r\n`으로 정규화).
   */
  public printAbove(text: string): Promise<void> {
    if (this.activeRead === undefined || this.term === undefined) {
      this.println(text);
      return Promise.resolve();
    }
    if (this.redrawing) {
      // moveCursorToEnd()를 부르지 않는다: 입력줄이 화면에 없어 refresh()가 엉뚱한 행에 그리고, 논리 커서도
      // 끝으로 옮겨 처음 커서를 잃는다(이슈 02).
      const prefix = this.state.promptPrefix();
      if (prefix !== "") this.write(prefix + "\x1b[0m\r\n");
      this.write(text + "\r\n");
    } else {
      // moveCursorToEnd()는 물리적 커서를 버퍼 끝(여러 줄로 감긴 경우 마지막 행)으로 옮겨야 그
      // 아래에 원시 텍스트를 안전하게 쓸 수 있지만, 논리 커서(line.pos)도 함께 옮긴다. 재그리기
      // 뒤에는 원래 위치로 돌려놓아야 하므로 먼저 저장해 둔다.
      this.redrawCursor = this.state.cursor();
      this.state.moveCursorToEnd();
      this.write("\r\n" + text + "\r\n");
    }
    // moveCursorToEnd()가 옛 프롬프트로 다시 그린 뒤에 비운다(먼저 비우면 화면의 접두가 지워진다).
    this.state.setPromptPrefix("");
    return this.scheduleRedraw(this.term);
  }

  /**
   * 활성 읽기가 있는가(`printAbove`·`printAboveRaw` 재그리기 대기 중 포함). `read()`의 write 콜백을 기다리는
   * 읽기(아직 그리지 않음)는 포함하지 않는다.
   */
  public isReading(): boolean {
    return this.activeRead !== undefined;
  }

  /** 활성 읽기의 프롬프트 앞 접두(`printAboveRaw`가 준 값). 활성 읽기가 없으면 빈 문자열. */
  public abovePrefix(): string {
    return this.activeRead === undefined ? "" : this.state.promptPrefix();
  }

  /**
   * `abovePrefix()` 중 아직 화면에 그리지 않은 것. 재그리기(`printAboveRaw`)의 write 콜백을 기다리는 동안에만 접두가 있으면
   * 접두를 돌려주고(입력줄이 접두째 지워진 상태), 그 밖에는 `""`다. `cancelRead()`는 화면에 쓰지 않으므로 콜백 전에 취소하면
   * 이 접두가 사라진다 — 취소 직전에 이 값을 읽어 다시 쓰는 것은 호출자 몫이다. 재그리기가 끝난 뒤의 접두는 이미 프롬프트 행에
   * 그려져 있으므로 이 값이 `""`이고, 다시 쓰면 중복된다.
   */
  public undrawnAbovePrefix(): string {
    return this.redrawing ? this.abovePrefix() : "";
  }

  /**
   * 열린 읽기 위에 배경 출력을 쓴다. 입력줄(프롬프트 첫 행부터 입력 마지막 행까지, 접두 포함)을 지우고 그 자리에
   * `lines`를 쓴 뒤, 프롬프트 앞에 `prefix`를 붙여 같은 읽기(버퍼·커서)를 그 아래에 다시 그린다. 다시 그리기는
   * write 콜백에서 앵커를 새 커서 행으로 옮긴 뒤 하고, 그동안 들어온 키는 `queued`에 쌓았다가 재생한다.
   *
   * - `lines`: 완성된 행. 빈 문자열이거나 `\n`으로 끝나야 한다. 앞 접두가 화면에서 지워지므로 이어 쓰려면 호출자가
   *   앞 접두를 `lines` 앞에 붙인다(`abovePrefix()`). 비어 있지 않으면 뒤에 `\x1b[0m`을 쓴다.
   * - `prefix`: 개행 없이 끝난 나머지. `\n`·`\r`이 없어야 한다(`State.setPromptPrefix`). 빈 문자열이면 접두 없음.
   * - 재그리기를 기다리는 중(앞선 `printAboveRaw`·`printAbove`)이면 입력줄은 화면에 없으므로 지우지 않고 `lines`만
   *   쓰고 접두를 바꿔 그 재그리기에 합류한다. 마지막 호출의 콜백만 다시 그린다.
   * - 활성 읽기가 없거나 `term`이 없으면 `write(lines + prefix)`와 같다.
   *
   * 돌려주는 프로미스는 합친 재그리기가 끝난 뒤(무효가 됐으면 콜백이 온 뒤) resolve한다.
   */
  public printAboveRaw(lines: string, prefix: string): Promise<void> {
    if (this.activeRead === undefined || this.term === undefined) {
      this.write(lines + prefix);
      return Promise.resolve();
    }
    if (!this.redrawing) {
      this.redrawCursor = this.state.cursor();
      // 레이아웃 기준으로 프롬프트 첫 행까지 올라가 지우고 레이아웃을 초기화한다(물리 커서는 그 행 열 0).
      this.state.erase();
    }
    if (lines !== "") this.write(lines + "\x1b[0m");
    this.state.setPromptPrefix(prefix);
    return this.scheduleRedraw(this.term);
  }

  /**
   * 재그리기를 시작하거나 기다리는 재그리기에 합류하고, write 콜백에서 마지막 호출만 같은 읽기를 다시 그린다.
   * 부르기 전에 입력줄은 화면에서 떠나 있고 물리 커서는 출력 아래 행 머리여야 한다.
   */
  private scheduleRedraw(term: Terminal): Promise<void> {
    const run = this.redraw ?? { calls: 0, waiters: [] };
    this.redraw = run;
    run.calls += 1;
    const call = run.calls;
    return new Promise<void>((resolve) => {
      run.waiters.push(resolve);
      term.write("", () => this.finishRedraw(run, call));
    });
  }

  /** `scheduleRedraw`의 write 콜백. */
  private finishRedraw(run: RedrawRun, call: number) {
    // cancelRead()·takeRead()·dispose()가 무효로 했으면 그리지 않는다. 해제된 터미널의 buffer도 읽지 않는다
    // (TRP-004). 뒤 읽기가 시작한 재그리기(`this.redraw`)는 건드리지 않는다.
    if (run !== this.redraw) {
      settleRun(run);
      return;
    }
    // 뒤에 합류한 호출의 콜백이 다시 그린다.
    if (call !== run.calls) return;
    this.redraw = undefined;
    // 위 세 경로가 재그리기를 무효로 하므로 닿지 않는 방어다(읽기가 없으면 그리지 않는다).
    if (this.term === undefined || this.activeRead === undefined) {
      this.queued = [];
      settleRun(run);
      return;
    }
    this.state.getTty().anchorRow = this.term.buffer.active.cursorY;
    this.state.restoreCursor(this.redrawCursor);
    // moveCursorToEnd()가 남긴 옛 레이아웃(감긴 경우 마지막 행 기준)을 새 앵커 기준
    // 레이아웃으로 되돌린다. 이게 없으면 refresh()가 옛 커서 행 기준으로 위로 올라가
    // 방금 쓴 원시 텍스트나 입력줄 일부를 \x1b[J로 지운다(다중 행 블록 입력 회귀).
    this.state.resetLayout();
    this.state.refresh();
    const queued = this.queued;
    this.queued = [];
    for (const entry of queued) {
      this.dispatch(entry);
    }
    settleRun(run);
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
    if (this.redrawing) {
      // 재그리기 대기 중: 입력줄이 화면에 없어 버퍼만 바꾸고, 콜백이 이 커서로 다시 그린다(이슈 10).
      this.redrawCursor = this.state.updateOffscreen(text);
      return;
    }
    return this.state.update(text);
  }

  /**
   * 재그리기 대기 중 들어와 큐(`queued`)에 쌓인 입력이 있는가. 큐의 키는 콜백에서 재생되기 전까지 버퍼에 없어
   * `getLine`·`getCursor` 비교로는 보이지 않으므로, 버퍼 비교로 경합을 판정하는 호출자(Tab 완성 응답)가 이 값을
   * 함께 봐야 한다. 재그리기 중이 아니거나 큐가 비었으면 false다. 읽기 밖 type-ahead 버퍼는 활성 읽기가 없을 때의 것이라
   * 포함하지 않는다.
   */
  public hasQueuedInput(): boolean {
    return this.redrawing && this.queued.length > 0;
  }

  /**
   * 현재 버퍼의 커서 위치(UTF-16 인덱스)를 돌려준다. `getLine`/`updateLine`과 같은 수준으로 활성
   * 읽기가 없어도 현재 state에 작용한다. 재그리기 대기 중이면 저장 커서(`redrawCursor`)다 — Tab `printAbove`의
   * `moveCursorToEnd()`가 논리 커서를 끝으로 옮겨 두어도 공개 편집 API가 쓰는 자리와 같은 값을 돌려준다.
   */
  public getCursor(): number {
    return this.redrawing ? this.redrawCursor : this.state.cursor();
  }

  /**
   * 현재 커서 위치에 텍스트를 끼워 넣는다(원본 편집 경로와 같은 `State.editInsert`). `printAbove`·`printAboveRaw` 재그리기를
   * 기다리는 중이면 입력줄이 화면에 없으므로 그리지 않고 저장 커서(`redrawCursor`) 자리의 버퍼에만 넣은 뒤 저장 커서를 삽입 뒤로
   * 옮긴다 — 재그리기 콜백이 그 커서로 다시 그린다(Tab 완성 삽입이 배경 출력 재그리기와 겹칠 때, 이슈 10).
   */
  public editInsert(text: string): void {
    if (this.redrawing) {
      this.redrawCursor = this.state.insertOffscreen(this.redrawCursor, text);
      return;
    }
    this.state.editInsert(text);
  }

  /** 커서 앞 n글자를 지운다(원본 편집 경로와 같은 `State.editBackspace`). 재그리기 대기 중 처리는 `editInsert`와 같다. */
  public editBackspace(n: number): void {
    if (this.redrawing) {
      this.redrawCursor = this.state.backspaceOffscreen(this.redrawCursor, n);
      return;
    }
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
        anchor,
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
    options: ReadOptions = {},
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
          this.history,
        );
        if (options.prefill !== undefined && options.prefill !== "") {
          this.state.update(
            options.prefill,
            clampCursor(options.prefillCursor, options.prefill.length),
          );
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
        this.replayTypeAhead();
      });
    });
  }

  private handleKeyEvent(event: KeyboardEvent): boolean {
    if (this.onKeyEvent?.(event)) return false;
    if (event.key === "Enter" && event.shiftKey) {
      if (event.type === "keydown") {
        // onData를 거치지 않는 키라 재그리기·type-ahead 분기를 직접 태운다(dispatch).
        this.dispatch({
          inputType: InputType.ShiftEnter,
          data: ["\r"],
        });
      }
      return false;
    }
    return true;
  }

  private readData(data: string) {
    this.dispatch(data);
  }

  /**
   * 입력 하나(`onData` 원본 문자열 또는 Shift+Enter `Input`)를 상태에 맞게 보낸다. `onData`·Shift+Enter·
   * 두 재생 경로(`replayTypeAhead`, `printAbove` 콜백의 `queued`)가 모두 이 분기를 탄다.
   */
  private dispatch(entry: string | Input) {
    if (this.redrawing) {
      // 재그리기(printAbove) 중 도착한 입력은 원본째 쌓아 둔다. 붙여넣기 덩어리도 하나로 보관해 재생 시
      // readPaste 경로를 그대로 타게 하고, Shift+Enter도 여기 쌓아 앞서 친 키보다 먼저 적용되지 않게 한다.
      this.queued.push(entry);
      return;
    }
    if (typeof entry !== "string") {
      // Shift+Enter: 활성 읽기가 없으면 쌓았다가 다음 읽기에서 readKey(onKey 훅 포함)로 재생한다.
      if (this.activeRead === undefined) {
        this.pushTypeAhead(entry);
        return;
      }
      this.readKey(entry);
      return;
    }
    const input = parseInput(entry);
    // 활성 읽기가 없으면 키를 버리지 않고 쌓는다. Ctrl+C·Ctrl+L 단독 입력만 즉시 처리한다(readKey).
    if (this.activeRead === undefined && !this.isImmediateKey(input)) {
      this.pushTypeAhead(entry);
      return;
    }
    if (
      input.length > 1 ||
      (input[0].inputType === InputType.Text && input[0].data.length > 1)
    ) {
      this.readPaste(input);
      return;
    }
    this.readKey(input[0]);
  }

  /** 활성 읽기가 없어도 쌓지 않고 바로 처리하는 입력(Ctrl+C·Ctrl+L 단독)인지 본다. */
  private isImmediateKey(input: Input[]): boolean {
    return (
      input.length === 1 &&
      (input[0].inputType === InputType.CtrlC ||
        input[0].inputType === InputType.CtrlL)
    );
  }

  /**
   * 항목을 통째로 쌓는다. 길이는 문자열이면 `data.length`, Shift+Enter `Input`이면 1(3.14 tty `\r` 1바이트)이다.
   * 합계가 상한을 넘으면 그 항목만 버린다(앞에 쌓인 것은 유지, 알림 없음).
   */
  private pushTypeAhead(entry: string | Input) {
    // typeAhead: false면 쌓지 않고 버린다. 활성 읽기 없는 구간의 입력(onData 키·붙여넣기·IME, Shift+Enter)은
    // 모두 dispatch를 거쳐 여기로 오므로 이 한 곳에서 막는다. onKeyEvent는 KeyboardEvent에만 불려 붙여넣기·IME를 못 막는다.
    if (!this.typeAheadEnabled) return;
    const length = typeof entry === "string" ? entry.length : 1;
    if (this.typeAheadLength + length > TYPE_AHEAD_LIMIT) return;
    this.typeAhead.push(entry);
    this.typeAheadLength += length;
  }

  private clearTypeAhead() {
    this.typeAhead = [];
    this.typeAheadLength = 0;
  }

  /**
   * 쌓인 항목을 `dispatch`로 하나씩 재생한다(`onKey` 훅·붙여넣기 경로 포함, Shift+Enter는 `readKey`).
   * 스냅샷을 먼저 꺼내 비우므로 Enter로 읽기가 끝난 뒤의 항목은 `activeRead` 없음 → 다시 `typeAhead`로
   * 들어가 순서가 보존되고 다음 읽기가 받는다. 재생 키가 `printAbove`로 재그리기를 시작하면 남은 항목은
   * `queued`가 이어받는다.
   */
  private replayTypeAhead() {
    const entries = this.typeAhead;
    this.clearTypeAhead();
    for (const entry of entries) {
      this.dispatch(entry);
    }
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
          // 게이트 결과와 무관하게 쌓인 키를 버린다(새 프로세스·인터럽트 뒤에 옛 키를 넘기지 않는다).
          this.clearTypeAhead();
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
          this.history,
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
