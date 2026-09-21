/**
 * `createRepl` 시험(RD-003: 터미널 마운트와 줄 편집).
 * 실제 `Readline`을 가짜 터미널에 붙여 write 콜백을 동기/비동기로 돌려 본다. pyodide·worker는 없고,
 * 호출자가 준 Terminal에 줄 편집기를 붙여 한 줄을 읽어 돌려주는 것까지가 이 시험의 범위다.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createRepl } from "./index";
import { createFakeTerminal } from "./test/fake-terminal";

type Outcome =
  | { state: "pending" }
  | { state: "resolved"; value: unknown }
  | { state: "rejected"; reason: unknown };

/**
 * promise의 현재 상태를 읽는 함수를 돌려준다. 끝나지 않는 읽기가 시험을 멈추지 않게 하고,
 * reject된 promise에 핸들러가 붙어 있어 처리되지 않은 rejection이 생기지 않는다.
 */
function observe(promise: Promise<unknown>): () => Outcome {
  let outcome: Outcome = { state: "pending" };
  promise.then(
    (value) => {
      outcome = { state: "resolved", value };
    },
    (reason) => {
      outcome = { state: "rejected", reason };
    },
  );
  return () => outcome;
}

/** 대기 중인 마이크로태스크와 타이머 하나를 모두 지나가게 한다. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each([
  { mode: "동기", asyncWrite: false },
  { mode: "비동기", asyncWrite: true },
])("write 콜백이 $mode 모드일 때", ({ asyncWrite }) => {
  /** readLine으로 읽기를 시작하고 입력 상태가 만들어질 때까지 write 콜백을 배출한다. */
  function startRead(
    fake: ReturnType<typeof createFakeTerminal>,
    repl: ReturnType<typeof createRepl>,
  ) {
    const line = repl.readLine(">>> ");
    fake.flush();
    return line;
  }

  test("타이핑한 글자를 터미널에 에코하고 Enter로 그 줄을 호출자에게 돌려준다", async () => {
    const fake = createFakeTerminal({ asyncWrite });
    const repl = createRepl({ terminal: fake.term });

    const line = startRead(fake, repl);
    fake.type("abc\r");

    await expect(line).resolves.toBe("abc");
    expect(fake.written.join("")).toContain("abc");
  });

  test("Backspace와 방향키(←/→)로 고친 줄을 돌려준다", async () => {
    const fake = createFakeTerminal({ asyncWrite });
    const repl = createRepl({ terminal: fake.term });

    const line = startRead(fake, repl);
    // "acd" → ←← → a 뒤에 "b" 삽입 → "abcd" → → → Backspace가 c를 지움 → "abd"
    fake.type("acd\x1b[D\x1b[Db\x1b[C\x7f\r");

    await expect(line).resolves.toBe("abd");
  });

  test("↑/↓로 이전에 입력한 줄을 불러온다", async () => {
    const fake = createFakeTerminal({ asyncWrite });
    const repl = createRepl({ terminal: fake.term });
    const first = startRead(fake, repl);
    fake.type("one\r");
    await first;
    const second = startRead(fake, repl);
    fake.type("two\r");
    await second;

    const third = startRead(fake, repl);
    // ↑ two, ↑ one, ↓ two
    fake.type("\x1b[A\x1b[A\x1b[B\r");

    await expect(third).resolves.toBe("two");
  });

  test("읽기가 열려 있는 동안 readLine을 다시 부르면 Error로 reject하고 첫 읽기는 정상 완료된다", async () => {
    const fake = createFakeTerminal({ asyncWrite });
    const repl = createRepl({ terminal: fake.term });
    const first = observe(startRead(fake, repl));

    const second = observe(repl.readLine(">>> "));
    fake.flush();
    fake.type("ok\r");
    await tick();

    expect(second()).toEqual({ state: "rejected", reason: expect.any(Error) });
    expect(first()).toEqual({ state: "resolved", value: "ok" });
  });

  test("dispose하면 대기 중인 읽기가 Error로 reject된다", async () => {
    const fake = createFakeTerminal({ asyncWrite });
    const repl = createRepl({ terminal: fake.term });
    const line = observe(startRead(fake, repl));

    repl.dispose();
    await tick();

    expect(line()).toEqual({ state: "rejected", reason: expect.any(Error) });
  });

  test("dispose 뒤 readLine은 터미널에 쓰지 않고 Error로 reject된다", async () => {
    const fake = createFakeTerminal({ asyncWrite });
    const repl = createRepl({ terminal: fake.term });
    repl.dispose();
    const writtenAtDispose = fake.written.length;

    const line = observe(repl.readLine(">>> "));
    fake.flush();
    await tick();

    expect(line()).toEqual({ state: "rejected", reason: expect.any(Error) });
    expect(fake.written).toHaveLength(writtenAtDispose);
  });

  // StrictMode의 mount → cleanup 순서: 읽기를 시작하자마자 dispose하고, 이어서 terminal.dispose()가 addon을 다시 dispose한다.
  test("dispose 직후 terminal.dispose()가 addon을 다시 dispose해도 안전하고 뒤늦은 콜백이 해제된 buffer를 읽지 않는다", async () => {
    const fake = createFakeTerminal({ asyncWrite });
    const repl = createRepl({ terminal: fake.term });
    const line = observe(repl.readLine(">>> "));

    repl.dispose();
    expect(() => fake.term.dispose()).not.toThrow();
    fake.flush();
    await tick();

    expect(line().state).toBe("rejected");
    expect(fake.disposedBufferReads).toBe(0);
  });
});

test("dispose를 두 번 불러도 안전하다", () => {
  const fake = createFakeTerminal();
  const repl = createRepl({ terminal: fake.term });

  repl.dispose();

  expect(() => repl.dispose()).not.toThrow();
});

test("dispose는 호출자가 소유한 Terminal을 dispose하지 않는다", () => {
  const fake = createFakeTerminal();
  const terminalDispose = vi.spyOn(fake.term, "dispose");
  const repl = createRepl({ terminal: fake.term });

  repl.dispose();

  expect(terminalDispose).not.toHaveBeenCalled();
});

describe("history 저장", () => {
  test("저장된 history를 복원하지도 덮어쓰지도 않고 메모리에서만 이전 줄을 불러온다", async () => {
    localStorage.setItem("history", JSON.stringify(["old"]));
    const fake = createFakeTerminal();
    const repl = createRepl({ terminal: fake.term });
    const first = repl.readLine(">>> ");
    fake.type("new\r");
    await first;

    const second = repl.readLine(">>> ");
    // ↑를 두 번 눌러도 "new"에서 멈춘다. 저장된 "old"를 복원했다면 두 번째 ↑가 "old"를 불러온다.
    fake.type("\x1b[A\x1b[A\r");

    await expect(second).resolves.toBe("new");
    expect(localStorage.getItem("history")).toBe(JSON.stringify(["old"]));
  });
});
