/**
 * jsdom 시험용 가짜 xterm `Terminal`. 실제 `Readline`이 읽는 멤버만 구현한다.
 * 실제 xterm은 jsdom에서 `open()`이 실패하므로(`matchMedia` 없음) 브라우저에서만 쓸 수 있다.
 *
 * 화면은 해석하지 않는다. write한 원문을 `written`에 모으고, 입력은 `type()`·`paste()`로 넣는다.
 * write 콜백은 동기로 돌리거나(`asyncWrite: false`) `flush()`까지 미룬다(`asyncWrite: true`).
 * 비동기 모드는 실제 xterm의 비동기 파싱을 흉내내 콜백이 다음 동기 문장 뒤에 오는 순서를 시험이 통제하게 한다.
 * 동기 모드만 쓰면 `read()`가 입력 상태를 콜백 안에서 만드는 데서 오는 오류(TRP-008)를 놓친다.
 */
import type { ITerminalAddon, Terminal } from "@xterm/xterm";

export interface FakeTerminalOptions {
  /** 참이면 write 콜백을 `flush()` 때까지 미룬다. 기본은 거짓(write 안에서 바로 실행). */
  asyncWrite?: boolean;
  cols?: number;
  rows?: number;
}

export interface FakeTerminal {
  /** `Readline`과 `createRepl`에 넘기는 가짜. 구현한 멤버는 아래 `FakeXterm`뿐이다. */
  term: Terminal;
  /** `write`로 받은 원문. 콜백 유무·모드와 무관하게 호출 즉시 호출 순서대로 쌓인다. */
  written: string[];
  /** 키 하나마다 `onData`를 한 번씩 부른다. 이스케이프 시퀀스(`\x1b[D` 등)와 서로게이트 쌍은 한 키다. */
  type(text: string): void;
  /** 문자열 전체를 한 번의 `onData`로 보낸다(붙여넣기). */
  paste(text: string): void;
  /** custom key handler에 keydown을 넘기고 반환값을 돌려준다. 핸들러가 없으면 `true`(xterm이 그대로 처리). */
  keyDown(init: KeyboardEventInit): boolean;
  /** 미뤄 둔 write 콜백을 콜백 안에서 새로 쌓인 것까지 모두 순서대로 실행한다. */
  flush(): void;
  /** `dispose()` 뒤에 `buffer`를 읽은 횟수. 실제 xterm은 이때 `DisposableStore` 경고를 낸다(이전 구현 TRP-001). */
  readonly disposedBufferReads: number;
}

/** `Readline`이 `Terminal`에서 읽는 멤버와 `loadAddon`·`dispose`. */
interface FakeXterm {
  cols: number;
  rows: number;
  options: { tabStopWidth: number };
  buffer: { active: { readonly cursorY: number } };
  onData(listener: (data: string) => void): { dispose(): void };
  onResize(listener: (size: { cols: number; rows: number }) => void): {
    dispose(): void;
  };
  attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean): void;
  write(text: string, callback?: () => void): void;
  loadAddon(addon: ITerminalAddon): void;
  dispose(): void;
}

const ESC = "\x1b";

/** CSI 시퀀스의 매개변수 문자(숫자와 `;`). */
function isCsiParameter(char: string | undefined): boolean {
  return char !== undefined && ((char >= "0" && char <= "9") || char === ";");
}

/**
 * 입력 문자열을 키 단위로 나눈다. `ESC [ 매개변수 최종문자`는 한 키, `ESC 문자`(Alt 조합)도 한 키,
 * 그 밖에는 코드 포인트 하나가 한 키다. 벤더 keymap이 해석하는 시퀀스를 기준으로 했다.
 */
function splitKeys(text: string): string[] {
  const chars = [...text];
  const keys: string[] = [];
  let start = 0;
  while (start < chars.length) {
    let end = start + 1;
    if (chars[start] === ESC) {
      if (chars[end] === "[") {
        end += 1;
        while (end < chars.length && isCsiParameter(chars[end])) end += 1;
      }
      // 최종 문자 하나(입력이 거기서 끝났으면 있는 만큼)까지 한 키다.
      end = Math.min(end + 1, chars.length);
    }
    keys.push(chars.slice(start, end).join(""));
    start = end;
  }
  return keys;
}

export function createFakeTerminal(
  options: FakeTerminalOptions = {},
): FakeTerminal {
  const { asyncWrite = false, cols = 80, rows = 24 } = options;
  const written: string[] = [];
  const dataListeners = new Set<(data: string) => void>();
  const addons: ITerminalAddon[] = [];
  const pendingCallbacks: (() => void)[] = [];
  let keyHandler: ((event: KeyboardEvent) => boolean) | undefined;
  let disposed = false;
  let disposedBufferReads = 0;

  const xterm: FakeXterm = {
    cols,
    rows,
    options: { tabStopWidth: 8 },
    buffer: {
      active: {
        get cursorY() {
          if (disposed) disposedBufferReads += 1;
          return 0;
        },
      },
    },
    onData(listener) {
      dataListeners.add(listener);
      return {
        dispose: () => {
          dataListeners.delete(listener);
        },
      };
    },
    onResize() {
      return { dispose: () => {} };
    },
    attachCustomKeyEventHandler(handler) {
      keyHandler = handler;
    },
    write(text, callback) {
      written.push(text);
      if (callback === undefined) return;
      if (asyncWrite) pendingCallbacks.push(callback);
      else callback();
    },
    loadAddon(addon) {
      addons.push(addon);
      addon.activate(term);
    },
    dispose() {
      disposed = true;
      dataListeners.clear();
      // 실제 xterm처럼 로드한 addon도 dispose한다. 그래서 호출자가 먼저 dispose한 addon은 두 번 dispose된다.
      for (const addon of addons.splice(0)) addon.dispose();
    },
  };
  const term = xterm as unknown as Terminal;

  const emit = (data: string) => {
    for (const listener of [...dataListeners]) listener(data);
  };

  return {
    term,
    written,
    type(text) {
      for (const key of splitKeys(text)) emit(key);
    },
    paste(text) {
      emit(text);
    },
    keyDown(init) {
      const event = new KeyboardEvent("keydown", init);
      return keyHandler === undefined ? true : keyHandler(event);
    },
    flush() {
      // 콜백이 새 write를 낼 수 있어 큐가 빌 때까지 돈다.
      for (
        let callback = pendingCallbacks.shift();
        callback !== undefined;
        callback = pendingCallbacks.shift()
      ) {
        callback();
      }
    },
    get disposedBufferReads() {
      return disposedBufferReads;
    },
  };
}
