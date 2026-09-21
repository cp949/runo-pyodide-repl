/**
 * `createRepl` 시험.
 * RD-003: 실제 `Readline`을 가짜 터미널에 붙여 write 콜백을 동기/비동기로 돌려 본다. 호출자가 준 Terminal에 줄
 * 편집기를 붙여 한 줄을 읽어 돌려주는 것까지가 이 범위다.
 * RD-004: worker 세션 시작(초기화 프레임 전송·출력 알림 4종·`ready`/`loadFailed`·상태 콜백)과 비격리 페이지 경로.
 * worker는 가짜(`postMessage`·`terminate`만 기록)이고, worker 역할의 rpc는 시험이 프레임의 포트에 직접 만든다.
 * RD-005: 줄 읽기는 worker가 RPC `readLine`을 요청하는 경로가 유일하다. RD-003의 줄 편집 시험은 worker 역할 rpc가
 * `readLine`을 요청하는 형태로 옮겼고, `sessionTerminated` 알림 → `onStatus('terminated')`를 더했다.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  createRepl,
  DEFAULT_PYODIDE_INDEX_URL,
  NOT_ISOLATED_WARNING,
  type ReplHandle,
  type ReplOptions,
} from "./index";
import { parseInitFrame, type InitFrame } from "./protocol/init-frame";
import { createRpc, type Rpc } from "./protocol/rpc";
import {
  createFakeTerminal,
  type FakeTerminalOptions,
} from "./test/fake-terminal";

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

/** MessagePort 알림이 도착했을 시간을 준다. "오지 않아야 한다"는 단언 앞에서 쓴다. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 30));
}

/** MessagePort로 도착하는 알림을 기다린다. 조건이 참이 되면 바로 돌아온다(최대 2초). */
async function waitFor(predicate: () => boolean): Promise<void> {
  for (let waited = 0; waited < 2000; waited += 5) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("기다리던 상태가 되지 않았다");
}

/** 프레임의 rpcPort. 열린 MessagePort가 vitest 워커를 잡지 않게 시험이 끝나면 닫는다. */
const openPorts: MessagePort[] = [];
/** 새 시험이 만든 핸들과 worker 역할 rpc. 시험이 끝나면 정리한다. */
const handles: ReplHandle[] = [];
const workerRpcs: Rpc[] = [];

/** 아무것도 하지 않는 가짜 worker. postMessage로 받은 프레임을 기록한다. */
function createFakeWorker() {
  const postMessage = vi.fn<
    (message: unknown, transfer: Transferable[]) => void
  >((message) => {
    openPorts.push((message as InitFrame).rpcPort);
  });
  const terminate = vi.fn();
  const worker = {
    postMessage,
    terminate,
    addEventListener() {},
    removeEventListener() {},
  } as unknown as Worker;
  return {
    worker,
    postMessage,
    terminate,
    frame: () => postMessage.mock.calls[0]?.[0] as InitFrame,
  };
}

/** RD-003 시험이 쓰는 worker 팩토리. 세션이 시작되지만 아무 알림도 오지 않는다. */
const createWorker = () => createFakeWorker().worker;

/** 세션을 시작하고 worker 역할 rpc를 프레임의 포트에 만든다. */
function startSession(
  overrides: Partial<ReplOptions> = {},
  terminalOptions: FakeTerminalOptions = {},
) {
  const fake = createFakeTerminal(terminalOptions);
  const fakeWorker = createFakeWorker();
  const onStatus = vi.fn();
  const createWorkerSpy = vi.fn(() => fakeWorker.worker);
  const handle = createRepl({
    terminal: fake.term,
    createWorker: createWorkerSpy,
    onStatus,
    ...overrides,
  });
  handles.push(handle);
  const workerRpc = createRpc(fakeWorker.frame().rpcPort);
  workerRpcs.push(workerRpc);
  const bytes = () => fake.written.join("");
  return {
    fake,
    fakeWorker,
    onStatus,
    createWorkerSpy,
    handle,
    workerRpc,
    bytes,
  };
}

/**
 * worker 역할 rpc로 `readLine`을 요청하고, main이 읽기를 시작해 입력 상태가 만들어질 때까지 write 콜백을 배출한다.
 * 읽기는 `term.write("", cb)`를 낸다(긴 꼬리를 정리하는 `rewindTail`의 flush도 같다). 출력 알림은 빈 조각을 쓰지
 * 않으므로 빈 문자열 write가 늘어난 것이 "요청이 도착했다"는 신호다. 꼬리가 길면 flush를 두 번 배출해야 읽기가 시작된다.
 * 읽기가 끝나기를 기다리지 않도록(async 함수는 반환한 Promise를 풀어 버린다) 읽기 Promise를 객체에 담아 돌려준다.
 */
async function startRead(
  session: Pick<ReturnType<typeof startSession>, "fake" | "workerRpc">,
  prompt = ">>> ",
): Promise<{ line: Promise<string | null> }> {
  const { fake, workerRpc } = session;
  const flushRequests = () => fake.written.filter((text) => text === "").length;
  const before = flushRequests();
  const line = workerRpc.call<string | null>(
    "readLine",
    prompt,
    undefined,
    true,
  );
  // 시험이 읽기 결과를 기다리지 않고 끝나도 afterEach의 rpc 정리가 처리되지 않은 rejection을 만들지 않게 한다.
  void line.catch(() => {});
  await Promise.race([
    waitFor(() => flushRequests() > before),
    // 요청이 거절되면(핸들러 없음 등) 기다리지 않고 그 오류로 실패한다.
    line.then(() => undefined),
  ]);
  fake.flush();
  await tick();
  fake.flush();
  return { line };
}

beforeEach(() => {
  localStorage.clear();
  // jsdom에는 crossOriginIsolated가 없다(undefined → 비격리). 격리 페이지로 만든다.
  vi.stubGlobal("crossOriginIsolated", true);
});

afterEach(() => {
  for (const rpc of workerRpcs.splice(0)) rpc.dispose();
  for (const handle of handles.splice(0)) handle.dispose();
  for (const port of openPorts.splice(0)) port.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe.each([
  { mode: "동기", asyncWrite: false },
  { mode: "비동기", asyncWrite: true },
])("write 콜백이 $mode 모드일 때", ({ asyncWrite }) => {
  test("타이핑한 글자를 터미널에 에코하고 Enter로 그 줄을 worker에게 돌려준다", async () => {
    const session = startSession({}, { asyncWrite });

    const { line } = await startRead(session);
    session.fake.type("abc\r");

    await expect(line).resolves.toBe("abc");
    expect(session.bytes()).toContain("abc");
  });

  test("Backspace와 방향키(←/→)로 고친 줄을 돌려준다", async () => {
    const session = startSession({}, { asyncWrite });

    const { line } = await startRead(session);
    // "acd" → ←← → a 뒤에 "b" 삽입 → "abcd" → → → Backspace가 c를 지움 → "abd"
    session.fake.type("acd\x1b[D\x1b[Db\x1b[C\x7f\r");

    await expect(line).resolves.toBe("abd");
  });

  test("↑/↓로 이전에 입력한 줄을 불러온다", async () => {
    const session = startSession({}, { asyncWrite });
    const { line: first } = await startRead(session);
    session.fake.type("one\r");
    await first;
    const { line: second } = await startRead(session);
    session.fake.type("two\r");
    await second;

    const { line: third } = await startRead(session);
    // ↑ two, ↑ one, ↓ two
    session.fake.type("\x1b[A\x1b[A\x1b[B\r");

    await expect(third).resolves.toBe("two");
  });

  test("worker의 readLine 요청에 직전 출력의 꼬리와 프롬프트를 이어 그린다(`t>>> `)", async () => {
    const session = startSession({}, { asyncWrite });
    session.workerRpc.notify("write", "t");

    await startRead(session);

    expect(session.bytes()).toContain("t\x1b[0m>>> ");
  });

  test("worker가 요청한 프롬프트(`... `)를 그대로 그린다", async () => {
    const session = startSession({}, { asyncWrite });

    await startRead(session, "... ");

    expect(session.bytes()).toContain("... ");
    expect(session.bytes()).not.toContain(">>> ");
  });

  test("폭을 넘는 꼬리도 flush를 기다린 뒤 이어 그리고 줄을 읽는다", async () => {
    const session = startSession({}, { asyncWrite });
    session.workerRpc.notify("write", "x".repeat(100));

    const { line } = await startRead(session);
    session.fake.type("ok\r");

    await expect(line).resolves.toBe("ok");
    // 벤더 Tty가 폭에 맞춰 행을 나눠 그리므로 꼬리 전체가 아니라 꼬리 끝과 프롬프트의 이음매를 본다.
    expect(session.bytes()).toContain("x\x1b[0m>>> ");
  });

  test("readLine 응답은 편집 버퍼 그대로의 문자열이다", async () => {
    const session = startSession({}, { asyncWrite });

    const { line } = await startRead(session);
    session.fake.type("1 + 1\r");

    await expect(line).resolves.toBe("1 + 1");
  });

  test("빈 줄 Enter는 null(취소)이 아니라 빈 문자열로 응답한다", async () => {
    const session = startSession({}, { asyncWrite });

    const { line } = await startRead(session);
    session.fake.type("\r");

    await expect(line).resolves.toBe("");
  });

  test("읽기가 열려 있는 동안 readLine을 다시 요청하면 Error로 reject하고 첫 읽기는 정상 완료된다", async () => {
    const session = startSession({}, { asyncWrite });
    const { line: first } = await startRead(session);

    const second = observe(
      session.workerRpc.call("readLine", ">>> ", undefined, true),
    );
    await waitFor(() => second().state === "rejected");
    session.fake.type("ok\r");

    expect(second()).toEqual({
      state: "rejected",
      reason: expect.objectContaining({
        message: expect.stringContaining("이미 읽는 중"),
      }),
    });
    await expect(first).resolves.toBe("ok");
  });

  test("dispose하면 대기 중인 읽기가 끝나 뒤늦은 입력이 터미널에 쓰이지 않고 worker에 응답도 가지 않는다", async () => {
    const session = startSession({}, { asyncWrite });
    const { handle, fake } = session;
    const { line } = await startRead(session);
    const outcome = observe(line);

    handle.dispose();
    const writtenAtDispose = fake.written.length;
    fake.type("abc\r");
    await settle();

    expect(fake.written).toHaveLength(writtenAtDispose);
    // RPC가 닫혀 응답이 오지 않는다(응답이 갔다면 "abc"가 그대로 돌아온다).
    expect(outcome().state).toBe("pending");
  });

  test("dispose 뒤 도착한 readLine 요청은 터미널에 쓰지 않는다", async () => {
    const { handle, fake, workerRpc } = startSession({}, { asyncWrite });
    handle.dispose();
    const writtenAtDispose = fake.written.length;

    // 응답은 오지 않으므로 promise는 결과를 보지 않고 observe로만 붙여 둔다.
    observe(workerRpc.call("readLine", ">>> ", undefined, true));
    fake.flush();
    await settle();

    expect(fake.written).toHaveLength(writtenAtDispose);
  });

  // StrictMode의 mount → cleanup 순서: 읽기를 시작하자마자 dispose하고, 이어서 terminal.dispose()가 addon을 다시 dispose한다.
  test("dispose 직후 terminal.dispose()가 addon을 다시 dispose해도 안전하고 뒤늦은 콜백이 해제된 buffer를 읽지 않는다", async () => {
    const { handle, fake, workerRpc } = startSession({}, { asyncWrite });
    observe(workerRpc.call("readLine", ">>> ", undefined, true));
    await waitFor(() => fake.written.includes(""));

    handle.dispose();
    expect(() => fake.term.dispose()).not.toThrow();
    fake.flush();
    await tick();

    expect(fake.disposedBufferReads).toBe(0);
  });

  test("폭을 넘는 꼬리를 정리하려고 flush를 기다리는 중에 dispose해도 뒤늦은 콜백이 해제된 buffer를 읽지 않는다", async () => {
    const { handle, fake, workerRpc } = startSession({}, { asyncWrite });
    // 100자 꼬리는 짧지 않아 `rewindTail`이 flush를 기다린다(비동기 모드에서는 그 콜백이 dispose 뒤에 온다).
    workerRpc.notify("write", "x".repeat(100));
    observe(workerRpc.call("readLine", ">>> ", undefined, true));
    await waitFor(() => fake.written.includes(""));

    handle.dispose();
    expect(() => fake.term.dispose()).not.toThrow();
    fake.flush();
    await tick();
    fake.flush();

    expect(fake.disposedBufferReads).toBe(0);
  });
});

test("dispose를 두 번 불러도 안전하다", () => {
  const fake = createFakeTerminal();
  const repl = createRepl({ terminal: fake.term, createWorker });

  repl.dispose();

  expect(() => repl.dispose()).not.toThrow();
});

test("dispose는 호출자가 소유한 Terminal을 dispose하지 않는다", () => {
  const fake = createFakeTerminal();
  const terminalDispose = vi.spyOn(fake.term, "dispose");
  const repl = createRepl({ terminal: fake.term, createWorker });

  repl.dispose();

  expect(terminalDispose).not.toHaveBeenCalled();
});

describe("history 저장", () => {
  test("저장된 history를 복원하지도 덮어쓰지도 않고 메모리에서만 이전 줄을 불러온다", async () => {
    localStorage.setItem("history", JSON.stringify(["old"]));
    const session = startSession();
    const { line: first } = await startRead(session);
    session.fake.type("new\r");
    await first;

    const { line: second } = await startRead(session);
    // ↑를 두 번 눌러도 "new"에서 멈춘다. 저장된 "old"를 복원했다면 두 번째 ↑가 "old"를 불러온다.
    session.fake.type("\x1b[A\x1b[A\r");

    await expect(second).resolves.toBe("new");
    expect(localStorage.getItem("history")).toBe(JSON.stringify(["old"]));
  });
});

describe("격리 페이지의 세션 시작", () => {
  test("worker를 만들고 첫 메시지로 검증을 통과하는 초기화 프레임을 전송 목록과 함께 보낸다", () => {
    const { createWorkerSpy, fakeWorker } = startSession();

    expect(createWorkerSpy).toHaveBeenCalledTimes(1);
    expect(fakeWorker.postMessage).toHaveBeenCalledTimes(1);
    // MessagePort를 든 객체에는 toEqual·toContain을 쓰지 않는다(순환 내부 참조). 정체성으로 본다.
    const [message, transfer] = fakeWorker.postMessage.mock.calls[0] as [
      InitFrame,
      Transferable[],
    ];
    expect(message).toBe(fakeWorker.frame());
    expect(transfer).toHaveLength(1);
    expect(transfer[0] === message.rpcPort).toBe(true);
    expect(() => parseInitFrame(message)).not.toThrow();
    expect(message.topLevelAwait).toBe(false);
    expect(message.pyodide.indexURL).toBe(DEFAULT_PYODIDE_INDEX_URL);
  });

  test("`pyodide.indexURL` 옵션이 프레임에 들어가고 끝 `/`가 보장된다", () => {
    const { fakeWorker } = startSession({
      pyodide: { indexURL: "http://localhost:8000/pyodide" },
    });

    expect(fakeWorker.frame().pyodide.indexURL).toBe(
      "http://localhost:8000/pyodide/",
    );
  });

  test("`onStatus('loading')`을 createRepl 반환 전에 동기로 부른다", () => {
    const { onStatus } = startSession();

    expect(onStatus.mock.calls).toEqual([["loading"]]);
  });

  test("worker의 ready 알림에 `onStatus('ready')`로 답한다", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const { onStatus, workerRpc } = startSession();

    workerRpc.notify("ready", { pyodideVersion: "314.0.7" });
    await waitFor(() => onStatus.mock.calls.length === 2);

    expect(onStatus.mock.calls.at(-1)).toEqual(["ready"]);
    expect(info).toHaveBeenCalledWith("[repl] pyodide 준비", "314.0.7");
  });

  test("출력 알림 4종이 sink 규칙대로 터미널에 쓰인다", async () => {
    const { workerRpc, bytes } = startSession();

    workerRpc.notify("writeOutput", "v");
    workerRpc.notify("write", "x");
    workerRpc.notify("writeErrorRaw", "e");
    workerRpc.notify("writeError", "T");
    const expected =
      "v\r\n" + "x" + "\x1b[31me\x1b[0m" + "\x1b[31mT\x1b[0m\r\n";
    await waitFor(() => bytes().length >= expected.length);

    expect(bytes()).toBe(expected);
  });

  test("loadFailed 알림은 빨간 실패 줄과 `onStatus('load-failed')`가 된다", async () => {
    const { onStatus, workerRpc, bytes, fakeWorker } = startSession();

    workerRpc.notify("loadFailed", "Error: boom");
    await waitFor(() => onStatus.mock.calls.length === 2);

    expect(bytes()).toContain(
      "\x1b[31mpyodide 로드 실패: Error: boom\x1b[0m\r\n",
    );
    expect(onStatus.mock.calls.at(-1)).toEqual(["load-failed"]);
    // 로드 실패는 worker를 죽이지 않는다.
    expect(fakeWorker.terminate).not.toHaveBeenCalled();
  });

  test("dispose는 worker를 종료하고 이후 알림에 반응하지 않는다", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const { handle, fakeWorker, onStatus, workerRpc, fake } = startSession();
    handle.dispose();
    const writtenAtDispose = fake.written.length;
    const statusCallsAtDispose = onStatus.mock.calls.length;

    workerRpc.notify("write", "late");
    workerRpc.notify("ready", { pyodideVersion: "314.0.7" });
    await settle();

    expect(fakeWorker.terminate).toHaveBeenCalledTimes(1);
    expect(fake.written).toHaveLength(writtenAtDispose);
    expect(onStatus.mock.calls).toHaveLength(statusCallsAtDispose);
    expect(info).not.toHaveBeenCalled();
  });

  test("sessionTerminated 알림에 `onStatus('terminated')`로 답하고 그 뒤 입력은 터미널에 쓰이지 않는다", async () => {
    const session = startSession();
    const { fake, fakeWorker, onStatus, workerRpc } = session;
    const { line } = await startRead(session);
    fake.type("exit()\r");
    await line;
    const writtenBefore = fake.written.length;

    workerRpc.notify("sessionTerminated");
    await waitFor(() => onStatus.mock.calls.length === 2);
    fake.type("abc");

    expect(onStatus.mock.calls.at(-1)).toEqual(["terminated"]);
    // 종료는 터미널에 아무것도 쓰지 않고(3.14도 종료 메시지가 없다) worker도 살려 둔다(복구는 RD-010 reset()).
    expect(fake.written).toHaveLength(writtenBefore);
    expect(fakeWorker.terminate).not.toHaveBeenCalled();
  });

  test("dispose를 두 번 불러도 worker는 한 번만 종료된다", () => {
    const { handle, fakeWorker } = startSession();

    handle.dispose();
    handle.dispose();

    expect(fakeWorker.terminate).toHaveBeenCalledTimes(1);
  });

  test("crossOriginIsolated 속성이 참이다", () => {
    const { handle } = startSession();

    expect(handle.crossOriginIsolated).toBe(true);
  });

  test("핸들마다 자기 터미널에 쓴다(sink 세트를 세션 사이에 공유하지 않는다)", async () => {
    const first = startSession();
    const second = startSession();

    first.workerRpc.notify("write", "t1");
    second.workerRpc.notify("write", "t2");
    await waitFor(() => first.bytes() !== "" && second.bytes() !== "");

    expect(first.bytes()).toBe("t1");
    expect(second.bytes()).toBe("t2");
  });
});

describe("비격리 페이지", () => {
  beforeEach(() => {
    vi.stubGlobal("crossOriginIsolated", false);
  });

  test("worker를 만들지 않고 노란 경고 한 줄을 낸다", () => {
    const fake = createFakeTerminal();
    const createWorkerSpy = vi.fn(() => createFakeWorker().worker);

    const handle = createRepl({
      terminal: fake.term,
      createWorker: createWorkerSpy,
    });
    handles.push(handle);

    expect(createWorkerSpy).not.toHaveBeenCalled();
    expect(fake.written.join("")).toContain(
      `\x1b[33m${NOT_ISOLATED_WARNING}\x1b[0m\r\n`,
    );
  });

  test("`onStatus('not-isolated')`만 부른다", () => {
    const fake = createFakeTerminal();
    const onStatus = vi.fn();

    handles.push(createRepl({ terminal: fake.term, createWorker, onStatus }));

    expect(onStatus.mock.calls).toEqual([["not-isolated"]]);
  });

  test("crossOriginIsolated 속성이 거짓이고 dispose가 안전하다", () => {
    const fake = createFakeTerminal();
    const handle = createRepl({ terminal: fake.term, createWorker });

    expect(handle.crossOriginIsolated).toBe(false);
    expect(() => {
      handle.dispose();
      handle.dispose();
    }).not.toThrow();
  });
});
