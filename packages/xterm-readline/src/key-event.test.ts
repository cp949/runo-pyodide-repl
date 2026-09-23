/**
 * `ReadlineOptions.onKeyEvent` 훅 시험(DELTA-01, `docs/design/06-editing.md` 6.1/6.6).
 * 계약: 모든 keydown/keypress/keyup에서 벤더 `handleKeyEvent` 처리 앞에서 불린다. `true`를
 * 돌려주면 벤더 처리(Shift+Enter 삽입 포함)를 생략하고 `handleKeyEvent` 자체도 xterm에 `false`를
 * 돌려준다(xterm 쪽 기본 처리도 생략됨을 뜻함). `on-key.test.ts`의 `StubTerminal`/`setup()`
 * 패턴을 참고했다.
 */
import { describe, expect, test } from "vitest";
import { Readline, ReadlineOptions } from "./readline";
import { VTerm } from "./vterm";

/** 콜백을 동기로 부르는 스텁. read()의 write("", cb)가 즉시 입력 상태를 만든다. */
class StubTerminal {
  public cols: number;
  public rows: number;
  public options = { tabStopWidth: 8 } as { tabStopWidth?: number };
  public buffer = {
    active: {
      get cursorY() {
        return this.parent.vt.cursor()[0];
      },
      parent: null as unknown as StubTerminal,
    },
  };
  public vt: VTerm;
  private onDataHandlers: ((data: string) => void)[] = [];
  private keyEventHandler: ((event: KeyboardEvent) => boolean) | undefined;

  constructor(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
    this.vt = new VTerm(cols, rows);
    this.buffer.active.parent = this;
  }

  onData(handler: (data: string) => void) {
    this.onDataHandlers.push(handler);
    return { dispose: () => {} };
  }

  onResize(_handler: (size: { cols: number; rows: number }) => void) {
    return { dispose: () => {} };
  }

  attachCustomKeyEventHandler(fn: (event: KeyboardEvent) => boolean) {
    this.keyEventHandler = fn;
  }

  write(text: string, cb?: () => void) {
    this.vt.write(text);
    if (cb) cb();
  }

  feed(data: string) {
    for (const handler of this.onDataHandlers) handler(data);
  }

  type(text: string) {
    for (const ch of text) this.feed(ch);
  }

  /** 벤더 `handleKeyEvent`에 원시 이벤트를 넘기고 반환값(=xterm 자체 처리 여부)을 돌려준다. */
  fireKeyEvent(
    event: Partial<KeyboardEvent> & { key: string; type: string }
  ): boolean {
    return this.keyEventHandler?.(event as KeyboardEvent) ?? true;
  }
}

function setup(onKeyEvent?: ReadlineOptions["onKeyEvent"]) {
  const term = new StubTerminal(20, 8);
  const readline = new Readline({ persist: false, onKeyEvent });
  readline.activate(readline_term(term));
  return { term, readline };
}

function readline_term(term: StubTerminal) {
  return term as unknown as Parameters<Readline["activate"]>[0];
}

const SHIFT_ENTER_KEYDOWN = { key: "Enter", shiftKey: true, type: "keydown" };

describe("onKeyEvent 훅", () => {
  test("훅이 true면 Shift+Enter가 무시되고 xterm에 false를 돌려준다", () => {
    const { term, readline } = setup(() => true);
    void readline.read("> ");
    term.type("ab");

    const result = term.fireKeyEvent(SHIFT_ENTER_KEYDOWN);

    expect(result).toBe(false);
    expect(readline.getLine()).toBe("ab");
  });

  test("훅이 false면 Shift+Enter가 원본 동작대로 개행을 삽입한다", () => {
    const { term, readline } = setup(() => false);
    void readline.read("> ");
    term.type("ab");

    const result = term.fireKeyEvent(SHIFT_ENTER_KEYDOWN);

    expect(result).toBe(false);
    expect(readline.getLine()).toBe("ab\n");
  });

  test("훅이 없으면 원본 동작대로 개행을 삽입한다", () => {
    const { term, readline } = setup();
    void readline.read("> ");
    term.type("ab");

    const result = term.fireKeyEvent(SHIFT_ENTER_KEYDOWN);

    expect(result).toBe(false);
    expect(readline.getLine()).toBe("ab\n");
  });

  test("keyup 이벤트도 훅에 전달된다(event.type 확인)", () => {
    const seenTypes: string[] = [];
    const { term } = setup((event) => {
      seenTypes.push(event.type);
      return false;
    });

    term.fireKeyEvent({ key: "a", type: "keydown" });
    term.fireKeyEvent({ key: "a", type: "keyup" });

    expect(seenTypes).toEqual(["keydown", "keyup"]);
  });
});
