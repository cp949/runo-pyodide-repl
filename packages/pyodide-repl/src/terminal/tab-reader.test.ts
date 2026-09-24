/**
 * `createTabReader` 시험(docs/design/07-tab-completion.md 7.1~7.3, RD-015 DELTA-04). 실제 `Readline` +
 * 실제 `createTerminalSinks` + `createFakeTerminal({ asyncWrite: true })`로 `block-history.test.ts`의
 * `setup()` 패턴을 그대로 쓴다(재그리기 write 콜백 타이밍을 통제해야 `printAbove` 왕복을 실사용과
 * 같은 순서로 재현할 수 있다). `deps.complete`는 `vi.fn()`으로 대체하고, 경합·큐 시험은 지연 제어
 * 가능한 deferred로 왕복 타이밍을 직접 정한다. `readEnded`는 `session.ts`가 부르는 자리를 시험이
 * 직접 흉내 낸다(이 파일은 `createTabReader` 단위 시험이라 세션 배선은 `index.test.ts`가 맡는다).
 */
import { Readline } from "@cp949/runo-xterm-readline";
import { describe, expect, test, vi } from "vitest";
import { createFakeTerminal } from "@repo/pyodide-testkit/fake-terminal";
import type { SourceCompletion } from "../worker/complete-source";
import { createAutoIndent } from "./auto-indent";
import { createBlockHistory } from "./block-history";
import { mergeReadOptions } from "./read-options";
import { createReplReader } from "./repl-reader";
import { createTerminalSinks } from "./sinks";
import { createTabReader, type TabReaderDeps } from "./tab-reader";

/** 매크로태스크 한 번. 큐에 쌓인 프라미스 체인(`.then().catch().finally()`)이 풀릴 시간을 준다. */
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** 지연 제어 가능한 `SourceCompletion` promise. 시험이 원하는 시점에 `resolve`/`reject`를 부른다. */
function deferredCompletion() {
  let resolve!: (value: SourceCompletion) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<SourceCompletion>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup() {
  const fake = createFakeTerminal({ asyncWrite: true });
  const readline = new Readline({ persist: false, skipBlankHistory: true });
  fake.term.loadAddon(readline);
  const sinks = createTerminalSinks(readline);
  const autoIndent = createAutoIndent(readline);
  const blockHistory = createBlockHistory(readline);
  const complete = vi.fn<TabReaderDeps["complete"]>();
  const interruptCompletion = vi.fn();
  const tabReader = createTabReader(readline, { complete, interruptCompletion });
  const reader = createReplReader(readline, fake.term, sinks, (pending) =>
    mergeReadOptions(
      blockHistory.readOptions(pending),
      autoIndent.readOptions(pending),
      tabReader.readOptions(pending),
    ),
  );

  /** `>>> `(pending 없음) 또는 `... `(pending 있음) 읽기 하나를 시작해 배출까지 기다린다. */
  async function startRead(
    pending?: string,
    cancelable = true,
  ): Promise<{ line: Promise<string | null> }> {
    const prompt = pending === undefined ? ">>> " : "... ";
    const line = reader.read(prompt, pending, cancelable);
    fake.flush();
    await tick();
    fake.flush();
    return { line };
  }

  return {
    fake,
    readline,
    tabReader,
    complete,
    interruptCompletion,
    startRead,
  };
}

describe("createTabReader: 삽입", () => {
  test('"os.pa" 뒤 Tab은 complete("os.pa", undefined)를 요청하고 응답을 커서에 삽입한다', async () => {
    const { readline, complete, startRead, fake } = setup();
    const { line } = await startRead();
    fake.type("os.pa");

    const p = deferredCompletion();
    complete.mockReturnValueOnce(p.promise);
    fake.type("\t");
    expect(complete).toHaveBeenCalledWith("os.pa", undefined);

    p.resolve({ completions: ["os.path"], start: 0 });
    await tick();

    expect(readline.getLine()).toBe("os.path");
    fake.type("\r");
    await expect(line).resolves.toBe("os.path");
  });

  test("여럿이면 공통 접두사만 채운다", async () => {
    const { readline, complete, startRead, fake } = setup();
    await startRead();
    fake.type("os.pa");
    complete.mockReturnValueOnce(
      Promise.resolve({
        completions: ["os.path", "os.pathconf", "os.pathsep"],
        start: 0,
      }),
    );

    fake.type("\t");
    await tick();

    expect(readline.getLine()).toBe("os.path");
  });
});

describe("createTabReader: 목록", () => {
  test("채울 것이 없으면 첫 Tab은 무동작이고 두 번째 Tab이 목록을 연다", async () => {
    const { readline, complete, startRead, fake } = setup();
    await startRead();
    fake.type("os.p");
    complete.mockResolvedValue({
      completions: ["os.path", "os.popen"],
      start: 0,
    });
    const printAbove = vi.spyOn(readline, "printAbove");

    fake.type("\t");
    await tick();
    expect(readline.getLine()).toBe("os.p");
    expect(readline.getCursor()).toBe(4);
    expect(printAbove).not.toHaveBeenCalled();

    fake.type("\t");
    await tick();
    expect(printAbove).toHaveBeenCalledTimes(1);
    // 버퍼·커서는 목록을 연 뒤에도 그대로다(입력줄은 지워지지 않고 그 자리에 남는다).
    expect(readline.getLine()).toBe("os.p");
    expect(readline.getCursor()).toBe(4);
    const printed = printAbove.mock.calls[0]?.[0] ?? "";
    expect(printed).toContain("os.path");
    expect(printed).toContain("os.popen");
  });

  test("사이에 다른 키가 끼면 첫 Tab 규칙으로 돌아간다", async () => {
    const { readline, complete, startRead, fake } = setup();
    await startRead();
    fake.type("os.p");
    complete.mockResolvedValue({
      completions: ["os.path", "os.popen"],
      start: 0,
    });
    const printAbove = vi.spyOn(readline, "printAbove");

    fake.type("\t");
    await tick();
    // 커서를 좌우로 움직여 버퍼·커서는 그대로 두고 lastKeyWasTab만 초기화한다.
    fake.type("\x1b[D\x1b[C");
    fake.type("\t");
    await tick();

    expect(printAbove).not.toHaveBeenCalled();
    expect(readline.getLine()).toBe("os.p");
  });

  test("후보 하나가 입력과 같으면 목록을 열지 않는다", async () => {
    const { readline, complete, startRead, fake } = setup();
    await startRead();
    fake.type("os.path");
    complete.mockResolvedValue({ completions: ["os.path"], start: 0 });
    const printAbove = vi.spyOn(readline, "printAbove");

    fake.type("\t");
    await tick();
    fake.type("\t");
    await tick();

    expect(printAbove).not.toHaveBeenCalled();
    expect(readline.getLine()).toBe("os.path");
  });
});

describe("createTabReader: 빈 스템", () => {
  test("스템이 빈 곳은 왕복 없이 4-(열%4)칸 공백을 넣는다(complete 0회)", async () => {
    const { readline, complete, startRead, fake } = setup();
    await startRead();
    // 공백(구분자)으로 끝나 스템이 빈다. 열은 줄 전체 길이(4)로 센다: 4 - 4%4 = 4칸.
    fake.type("abc ");
    fake.type("\t");

    expect(complete).not.toHaveBeenCalled();
    expect(readline.getLine()).toBe("abc     ");
  });

  test('"... " 줄(pending)에서도 같다', async () => {
    const { readline, complete, startRead, fake } = setup();
    // pending("x = 1")은 ":"로 끝나지 않아 자동 들여쓰기 프리필이 없다 — 빈 버퍼로 시작한다.
    await startRead("x = 1");
    fake.type("\t");

    expect(complete).not.toHaveBeenCalled();
    expect(readline.getLine()).toBe("    ");
  });

  test("Tab 문자 자체는 버퍼에 들어가지 않는다", async () => {
    const { readline, startRead, fake } = setup();
    await startRead();
    fake.type("abc ");
    fake.type("\t");

    expect(readline.getLine()).not.toContain("\t");
  });
});

describe("createTabReader: pending 전달", () => {
  test("pending이 있으면 complete(source, pending)으로 넘긴다(RD-016 대비)", async () => {
    const { complete, startRead, fake } = setup();
    // pending("if True:")은 ":"로 끝나 자동 들여쓰기 프리필 "    "이 붙는다.
    await startRead("if True:");
    fake.type("pri");
    complete.mockReturnValueOnce(new Promise<SourceCompletion>(() => {}));
    fake.type("\t");

    expect(complete).toHaveBeenCalledWith("    pri", "if True:");
  });
});

describe("createTabReader: 모듈 경로(RD-016 게이트 참 + 빈 스템)", () => {
  test('"import " 뒤 Tab은 빈 스템이어도 complete("import ", undefined)를 요청하고 응답을 삽입한다', async () => {
    const { readline, complete, startRead, fake } = setup();
    await startRead();
    fake.type("from os import ");
    complete.mockResolvedValueOnce({ completions: ["path"], start: 15 });

    fake.type("\t");
    expect(complete).toHaveBeenCalledWith("from os import ", undefined);
    await tick();

    expect(readline.getLine()).toBe("from os import path");
  });

  test('pending에만 import가 있고 현재 줄이 비어도 complete("", pending)을 요청한다', async () => {
    const { readline, complete, startRead, fake } = setup();
    // 열린 괄호 안이라 자동 들여쓰기 프리필이 없어 현재 줄이 비어 있다.
    await startRead("from os import (");
    expect(readline.getLine()).toBe("");
    complete.mockResolvedValueOnce({ completions: ["path"], start: 0 });

    fake.type("\t");
    expect(complete).toHaveBeenCalledWith("", "from os import (");
    await tick();

    expect(readline.getLine()).toBe("path");
  });

  test("게이트가 거짓인 빈 스템(x = )은 왕복 없이 공백을 넣는다", async () => {
    const { readline, complete, startRead, fake } = setup();
    await startRead();
    fake.type("x = ");
    fake.type("\t");

    expect(complete).not.toHaveBeenCalled();
    expect(readline.getLine()).toBe("x =     ");
  });

  test("게이트 참·빈 스템(important = ) Tab 8연타는 큐로 이어져 공백 후보가 32칸 들어간다(RD-015 큐와 결합)", async () => {
    const { readline, complete, startRead, fake } = setup();
    await startRead();
    fake.type("important = ");
    // worker의 공백 후보 분기를 흉내 낸다: None + 빈 스템 → ' ' * (4 - 열 % 4), start = len(source).
    complete.mockImplementation(async (source) => ({
      completions: [" ".repeat(4 - (source.length % 4))],
      start: source.length,
    }));

    fake.type("\t".repeat(8));
    // 첫 Tab만 왕복을 시작하고 나머지 7회는 큐에 있다.
    expect(complete).toHaveBeenCalledTimes(1);
    await tick();
    await tick();

    expect(complete).toHaveBeenCalledTimes(8);
    expect(readline.getLine()).toBe(`important = ${" ".repeat(32)}`);
  });

  test("Tab 직후 입력하면 모듈 후보 응답을 버린다(오래된 응답 버리기)", async () => {
    const { readline, complete, startRead, fake } = setup();
    await startRead();
    fake.type("from os import ");
    const p = deferredCompletion();
    complete.mockReturnValueOnce(p.promise);
    fake.type("\t");
    fake.type("p"); // 왕복 중 입력 — 버퍼가 스냅샷과 달라진다.

    p.resolve({ completions: ["path"], start: 15 });
    await tick();

    expect(readline.getLine()).toBe("from os import p");
  });

  test("Tab 직후 커서를 옮기면 모듈 후보 응답을 버린다", async () => {
    const { readline, complete, startRead, fake } = setup();
    await startRead();
    fake.type("import ");
    const p = deferredCompletion();
    complete.mockReturnValueOnce(p.promise);
    fake.type("\t");
    fake.type("\x1b[D"); // 왼쪽 화살표

    p.resolve({ completions: ["os"], start: 7 });
    await tick();

    expect(readline.getLine()).toBe("import ");
  });
});

describe("createTabReader: 경합", () => {
  test("왕복 중 버퍼가 바뀌면 응답을 버린다", async () => {
    const { readline, complete, startRead, fake } = setup();
    await startRead();
    fake.type("os.pa");
    const p = deferredCompletion();
    complete.mockReturnValueOnce(p.promise);
    fake.type("\t");

    // 커서 위치(5)는 그대로 두고 버퍼 내용만 바꾼다(Backspace 뒤 다른 글자) — 커서 검사와 독립적으로
    // 버퍼 검사만 고립해서 본다.
    fake.type("\x7f"); // Backspace: "os.p", pos=4
    fake.type("b"); // "os.pb", pos=5(snap.pos와 같다)
    expect(readline.getCursor()).toBe(5);

    p.resolve({ completions: ["os.path"], start: 0 });
    await tick();

    expect(readline.getLine()).toBe("os.pb");
  });

  test("왕복 중 커서가 바뀌면 응답을 버린다", async () => {
    const { readline, complete, startRead, fake } = setup();
    await startRead();
    fake.type("os.pa");
    const p = deferredCompletion();
    complete.mockReturnValueOnce(p.promise);
    fake.type("\t");

    fake.type("\x1b[D"); // 버퍼는 그대로, 커서만 한 칸 앞으로.
    p.resolve({ completions: ["os.path"], start: 0 });
    await tick();

    expect(readline.getLine()).toBe("os.pa");
    expect(readline.getCursor()).toBe(4);
  });

  test('왕복 중 Enter로 읽기가 끝나면(readEnded("os.pa")) 버린다 — 다음 읽기에 삽입되지 않는다', async () => {
    const { readline, tabReader, complete, startRead, fake } = setup();
    const { line } = await startRead();
    fake.type("os.pa");
    const p = deferredCompletion();
    complete.mockReturnValueOnce(p.promise);
    fake.type("\t");
    fake.type("\r");
    const result = await line;
    tabReader.readEnded(result);

    await startRead();
    p.resolve({ completions: ["os.path"], start: 0 });
    await tick();

    expect(readline.getLine()).toBe("");
  });

  test("세대가 달라지면(같은 버퍼·커서라도) 응답을 버린다", async () => {
    const { readline, tabReader, complete, startRead, fake } = setup();
    const { line } = await startRead();
    fake.type("os.pa");
    const stale = deferredCompletion();
    complete.mockReturnValueOnce(stale.promise);
    fake.type("\t"); // gen1 요청(snap: buf="os.pa", pos=5)
    fake.type("\r");
    const result = await line;
    tabReader.readEnded(result);

    // gen2도 똑같이 "os.pa"를 타이핑해 버퍼·커서를 gen1의 스냅샷과 우연히 같게 만든다 — 세대 검사만
    // 고립해서 본다(버퍼·커서 검사는 통과하는데도 버려야 한다).
    await startRead();
    fake.type("os.pa");

    stale.resolve({ completions: ["os.path"], start: 0 });
    await tick();

    expect(readline.getLine()).toBe("os.pa");
  });

  test("ended(읽기 종료 표시)가 세대·버퍼·커서와 별개로 응답을 버린다", async () => {
    const { readline, tabReader, complete, startRead, fake } = setup();
    await startRead();
    fake.type("os.pa");
    const p = deferredCompletion();
    complete.mockReturnValueOnce(p.promise);
    fake.type("\t");

    // 세대·버퍼·커서는 그대로 둔 채 종료만 표시한다(ended 검사만 고립해서 본다).
    tabReader.readEnded("os.pa");

    p.resolve({ completions: ["os.path"], start: 0 });
    await tick();

    expect(readline.getLine()).toBe("os.pa");
  });

  test("왕복 중 Ctrl+C(readEnded(null))면 버린다", async () => {
    const { readline, tabReader, complete, startRead, fake } = setup();
    const { line } = await startRead();
    fake.type("os.pa");
    const p = deferredCompletion();
    complete.mockReturnValueOnce(p.promise);
    fake.type("\t");
    fake.type("\x03");
    const result = await line;
    expect(result).toBeNull();
    tabReader.readEnded(result);

    await startRead();
    p.resolve({ completions: ["os.path"], start: 0 });
    await tick();

    expect(readline.getLine()).toBe("");
  });
});

describe("createTabReader: 큐", () => {
  test("왕복 중 Tab 1회는 큐에 남아 응답 뒤 두 번째 Tab으로 처리돼 목록을 연다", async () => {
    const { readline, complete, startRead, fake } = setup();
    await startRead();
    fake.type("os.p");
    const first = deferredCompletion();
    complete.mockReturnValueOnce(first.promise);
    complete.mockResolvedValueOnce({
      completions: ["os.path", "os.popen"],
      start: 0,
    });
    const printAbove = vi.spyOn(readline, "printAbove");

    fake.type("\t"); // 요청 #1(second=false)
    fake.type("\t"); // 왕복 중 → 큐(second=true)
    expect(complete).toHaveBeenCalledTimes(1);

    first.resolve({ completions: ["os.path", "os.popen"], start: 0 });
    await tick();

    expect(complete).toHaveBeenCalledTimes(2);
    expect(printAbove).toHaveBeenCalledTimes(1);
    expect(readline.getLine()).toBe("os.p");
    expect(readline.getCursor()).toBe(4);
  });

  test("왕복 중 Tab 8회는 순서대로 이어 처리된다", async () => {
    const { readline, complete, startRead, fake } = setup();
    await startRead();
    // 이미 완전히 일치하는 후보 하나뿐 → 채울 것도 목록도 없다(printAbove와 무관하게 순서만 본다).
    fake.type("os.path");
    const first = deferredCompletion();
    complete.mockReturnValueOnce(first.promise);
    complete.mockResolvedValue({ completions: ["os.path"], start: 0 });

    fake.type("\t".repeat(8));
    expect(complete).toHaveBeenCalledTimes(1);

    first.resolve({ completions: ["os.path"], start: 0 });
    await tick();

    expect(complete).toHaveBeenCalledTimes(8);
    expect(readline.getLine()).toBe("os.path");
    expect(readline.getCursor()).toBe(7);
  });

  test("옛 세대의 큐 Tab은 새 읽기에서 폐기된다", async () => {
    const { readline, tabReader, complete, startRead, fake } = setup();
    const { line } = await startRead();
    fake.type("os.p");
    const stale = deferredCompletion();
    complete.mockReturnValueOnce(stale.promise);
    fake.type("\t"); // 옛 세대 요청 진행 중
    fake.type("\t"); // 옛 세대 큐
    fake.type("\r");
    const result = await line;
    tabReader.readEnded(result);

    await startRead(); // 새 세대(큐·상태 리셋)
    const printAbove = vi.spyOn(readline, "printAbove");
    stale.resolve({ completions: ["os.path", "os.popen"], start: 0 }); // 뒤늦은 옛 응답
    await tick();

    expect(readline.getLine()).toBe(""); // 새 세대 버퍼는 영향받지 않는다
    expect(printAbove).not.toHaveBeenCalled();
  });

  test("큐 Tab이 공백 삽입(indent)으로 끝나도 남은 큐 Tab을 이어 처리한다(최종 리뷰 Important-1)", async () => {
    const { readline, complete, startRead, fake } = setup();
    await startRead();
    fake.type("a.b");
    const p = deferredCompletion();
    complete.mockReturnValueOnce(p.promise);
    fake.type("\t"); // 요청 #1(snap: buf="a.b", pos=3)

    // 왕복 중 스페이스가 끼어 스템이 비워진다("a.b " → 다음 Tab은 indent 경로를 탄다).
    fake.type(" ");
    fake.type("\t"); // 큐(second=false)
    fake.type("\t"); // 큐(second=true)
    expect(complete).toHaveBeenCalledTimes(1);

    // 응답이 올 때는 버퍼가 이미 "a.b "로 바뀌어 있어(snap.buf="a.b") applyResume이 버린다 —
    // drainQueue만 큐를 이어 처리해야 한다.
    p.resolve({ completions: ["a.bar"], start: 0 });
    await tick();

    // 고치기 전: drainQueue가 큐 Tab을 하나(indent)만 처리하고 멈춰 두 번째 큐 Tab이 방치되고,
    // "a.b " 뒤 4칸만 삽입된 "a.b     "(총 8글자)로 남는다.
    // 고친 뒤: indent가 requesting을 다시 세우지 않으므로 drainQueue가 남은 큐 Tab도 이어
    // 처리해 4칸을 한 번 더 넣는다 — "a.b " + 8칸(총 12글자).
    expect(readline.getLine()).toBe(`a.b${" ".repeat(9)}`);
    expect(readline.getLine()).toHaveLength(12);
    // 큐 Tab 둘 다 indent였으므로 complete()는 최초 1회 호출에서 멈춘다 — 방치된 요청이
    // 남아 있다가 나중 엉뚱한 Tab에서 튀어나오지 않는다.
    expect(complete).toHaveBeenCalledTimes(1);
  });

  test("요청이 reject되면 무동작이고 큐는 이어 처리된다", async () => {
    const { readline, complete, startRead, fake } = setup();
    await startRead();
    fake.type("os.pa");
    const first = deferredCompletion();
    complete.mockReturnValueOnce(first.promise);
    complete.mockResolvedValueOnce({ completions: ["os.path"], start: 0 });

    fake.type("\t"); // 요청 #1
    fake.type("\t"); // 큐

    first.reject(new Error("rpc disposed"));
    await tick();

    expect(complete).toHaveBeenCalledTimes(2);
    expect(readline.getLine()).toBe("os.path"); // 큐의 두 번째 요청은 정상 처리됐다
  });
});

describe("createTabReader: 취소 인터럽트", () => {
  test("요청 진행 중 readEnded(null)이면 interruptCompletion을 1회 부른다", async () => {
    const { tabReader, complete, interruptCompletion, startRead, fake } = setup();
    await startRead();
    fake.type("os.pa");
    complete.mockReturnValueOnce(new Promise<SourceCompletion>(() => {}));
    fake.type("\t");

    tabReader.readEnded(null);

    expect(interruptCompletion).toHaveBeenCalledTimes(1);
  });

  test("요청이 없으면 interruptCompletion을 부르지 않는다", async () => {
    const { tabReader, interruptCompletion, startRead } = setup();
    await startRead();

    tabReader.readEnded(null);

    expect(interruptCompletion).not.toHaveBeenCalled();
  });

  test("응답이 이미 온 뒤면 interruptCompletion을 부르지 않는다", async () => {
    const { tabReader, complete, interruptCompletion, startRead, fake } = setup();
    await startRead();
    fake.type("os.pa");
    complete.mockResolvedValueOnce({ completions: ["os.path"], start: 0 });
    fake.type("\t");
    await tick(); // 왕복이 끝난다(requesting = false)

    tabReader.readEnded(null);

    expect(interruptCompletion).not.toHaveBeenCalled();
  });

  test("Enter로 끝나면(line !== null) interruptCompletion을 부르지 않는다", async () => {
    const { tabReader, complete, interruptCompletion, startRead, fake } = setup();
    await startRead();
    fake.type("os.pa");
    complete.mockReturnValueOnce(new Promise<SourceCompletion>(() => {}));
    fake.type("\t");

    tabReader.readEnded("os.pa");

    expect(interruptCompletion).not.toHaveBeenCalled();
  });

  test("큐에서 시작한 요청 중 취소도 interruptCompletion 1회다", async () => {
    const { tabReader, complete, interruptCompletion, startRead, fake } = setup();
    await startRead();
    fake.type("os.p");
    const first = deferredCompletion();
    complete.mockReturnValueOnce(first.promise);
    complete.mockReturnValueOnce(new Promise<SourceCompletion>(() => {})); // 큐 처리 뒤 요청은 응답하지 않는다

    fake.type("\t"); // 요청 #1
    fake.type("\t"); // 큐(second=true)

    first.resolve({ completions: ["os.path", "os.popen"], start: 0 }); // second=false라 채울 것 없음 → 큐가 이어 처리된다
    await tick();
    expect(complete).toHaveBeenCalledTimes(2); // 큐에서 시작한 요청 #2가 진행 중

    tabReader.readEnded(null);

    expect(interruptCompletion).toHaveBeenCalledTimes(1);
  });
});

describe("createTabReader: 읽기 시작 전", () => {
  test("readOptions 전(읽기 시작 전) Tab은 무동작이다", () => {
    const { complete, fake } = setup();
    fake.type("\t");

    expect(complete).not.toHaveBeenCalled();
  });
});

describe("createTabReader: printAbove 재진입(pending-issue 01, DELTA-04a)", () => {
  test("커서가 줄 중간일 때 list 응답을 연속으로 받아도 재그리기 중 버퍼가 오염되지 않고, 큐의 Tab은 원래 커서/버퍼로 처리된다", async () => {
    const { readline, complete, startRead, fake } = setup();
    await startRead();
    // 리뷰(opus) 재현: 커서를 버퍼 끝이 아닌 ")" 앞(pos=4)에 둔다 — printAbove가 재그리기 동안
    // moveCursorToEnd()로 커서를 버퍼 끝(pos=5)으로 옮기므로, 큐의 다음 Tab이 재그리기가 끝나기
    // 전에 처리되면(수정 전 버그) 옮겨진 커서로 잘못 계산한다.
    fake.type("os.p)"); // 두 후보 모두 "os.p"까지만 공통 → 채울 것이 없다
    fake.type("\x1b[D");
    expect(readline.getCursor()).toBe(4);
    const completions = ["os.path", "os.popen"];
    const req1 = deferredCompletion();
    const req2 = deferredCompletion();
    const req3 = deferredCompletion();
    complete.mockReturnValueOnce(req1.promise);
    complete.mockReturnValueOnce(req2.promise);
    complete.mockReturnValueOnce(req3.promise);

    fake.type("\t\t\t"); // Tab 3연타: 1번째만 즉시 처리, 2·3번째는 큐에 쌓인다(둘 다 second=true)
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenNthCalledWith(1, "os.p", undefined);

    // 1번째 요청(second=false) 응답: 채울 것 없음 → 목록 없음(printAbove 호출 없이 즉시 끝난다).
    // 큐의 2번째 Tab(second=true)이 원래 스냅샷("os.p", pos=4)으로 이어 요청된다.
    req1.resolve({ completions, start: 0 });
    await tick();
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete).toHaveBeenNthCalledWith(2, "os.p", undefined);

    // 2번째 요청(second=true) 응답: 목록을 연다(printAbove #1) → applyResume이 printAbove의
    // 프로미스를 그대로 돌려주므로, 재그리기의 write 콜백이 아직 오지 않은(flush 전) 동안에는
    // `.finally(drainQueue)`가 실행되지 않는다 — 큐의 3번째 Tab이 아직 요청되지 않아야 한다.
    req2.resolve({ completions, start: 0 });
    await tick();
    expect(complete).toHaveBeenCalledTimes(2); // 재그리기가 끝나기 전에는 큐가 이어 처리되지 않는다
    // 재그리기가 진행 중이어도(논리 커서는 moveCursorToEnd()로 버퍼 끝에 가 있다) 버퍼 자체는
    // 오염되지 않는다 — printAbove는 line.buffer를 건드리지 않는다.
    expect(readline.getLine()).toBe("os.p)");

    fake.flush(); // 재그리기 write 콜백을 완료시켜 printAbove의 프로미스를 resolve한다
    await tick();
    expect(complete).toHaveBeenCalledTimes(3); // 재그리기가 끝난 뒤에야 큐의 3번째 Tab이 이어 요청된다
    // 큐의 Tab은 재그리기 중 옮겨진 커서(버퍼 끝, pos=5)가 아니라 원래 스냅샷("os.p", pos=4)으로
    // 처리된다 — 수정 전에는 "os.p)"(버퍼 끝까지)로 요청이 나갔다.
    expect(complete).toHaveBeenNthCalledWith(3, "os.p", undefined);

    // 3번째 요청(second=true) 응답: 다시 목록을 연다(printAbove #2). 재진입(redrawing 중 재호출)
    // 없이 커서·버퍼가 원래 자리로 돌아오는지 본다.
    req3.resolve({ completions, start: 0 });
    await tick();
    fake.flush();
    await tick();

    expect(readline.getLine()).toBe("os.p)");
    expect(readline.getCursor()).toBe(4);
  });
});
