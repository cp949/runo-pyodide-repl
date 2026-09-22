/**
 * `ReadOptions.historyEntry` 훅과 `Readline.getHistory()` 시험.
 * 계약(RD-014 DELTA-01): Enter로 제출된 줄을 history에 넣기 직전에 훅을 부르고, 돌려준 문자열이
 * 기록된다. `resolve`는 원래 줄(`buffer()`)을 그대로 돌려준다. `skipBlankHistory`가 거른 공백뿐인
 * 제출과 취소(`cancelable` Ctrl+C)에는 훅을 부르지 않는다.
 */
import { describe, expect, test, vi } from "vitest";
import { Readline } from "./readline";
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

  attachCustomKeyEventHandler(_fn: (event: KeyboardEvent) => boolean) {
    return;
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
}

function setup(cols = 20, rows = 8) {
  const term = new StubTerminal(cols, rows);
  const readline = new Readline({ persist: false, skipBlankHistory: true });
  readline.activate(readline_term(term));
  return { term, readline };
}

function readline_term(term: StubTerminal) {
  return term as unknown as Parameters<Readline["activate"]>[0];
}

const ARROW_UP = "\x1b[A";
const CTRL_C = "\x03";
const ENTER = "\r";

describe("historyEntry 훅", () => {
  test("훅이 돌려준 텍스트가 history에 기록되고 read()는 원래 줄을 돌려준다", async () => {
    const { term, readline } = setup();

    const first = readline.read("> ", { historyEntry: (l) => `[${l}]` });
    term.type("abc");
    term.feed(ENTER);
    await expect(first).resolves.toBe("abc");

    void readline.read("> ");
    term.feed(ARROW_UP);
    expect(readline.getLine()).toBe("[abc]");
  });

  test("공백뿐인 제출(skipBlankHistory)에는 훅을 부르지 않는다", async () => {
    const { term, readline } = setup();
    const historyEntry = vi.fn();

    const first = readline.read("> ", { historyEntry });
    term.type("   ");
    term.feed(ENTER);
    await expect(first).resolves.toBe("   ");

    expect(historyEntry).not.toHaveBeenCalled();

    void readline.read("> ");
    term.feed(ARROW_UP);
    expect(readline.getLine()).toBe("");
  });

  test("취소(cancelable Ctrl+C)에는 훅을 부르지 않는다", async () => {
    const { term, readline } = setup();
    const historyEntry = vi.fn();

    const first = readline.read("> ", { cancelable: true, historyEntry });
    term.type("abc");
    term.feed(CTRL_C);
    await expect(first).resolves.toBeNull();

    expect(historyEntry).not.toHaveBeenCalled();
  });

  test("훅이 없으면 제출한 줄이 그대로 기록된다", async () => {
    const { term, readline } = setup();

    const first = readline.read("> ");
    term.type("abc");
    term.feed(ENTER);
    await expect(first).resolves.toBe("abc");

    void readline.read("> ");
    term.feed(ARROW_UP);
    expect(readline.getLine()).toBe("abc");
  });

  test("getHistory()는 appendHistory와 같은 객체를 돌려준다", () => {
    const { readline } = setup();

    readline.appendHistory("z");

    expect(readline.getHistory().entries[0]).toBe("z");
  });
});
