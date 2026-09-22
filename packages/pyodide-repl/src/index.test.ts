/**
 * `createRepl` 시험.
 * RD-003: 실제 `Readline`을 가짜 터미널에 붙여 write 콜백을 동기/비동기로 돌려 본다. 호출자가 준 Terminal에 줄
 * 편집기를 붙여 한 줄을 읽어 돌려주는 것까지가 이 범위다.
 * RD-004: worker 세션 시작(초기화 프레임 전송·출력 알림 4종·`ready`/`loadFailed`·상태 콜백)과 비격리 페이지 경로.
 * worker는 가짜(`postMessage`·`terminate`만 기록)이고, worker 역할의 rpc는 시험이 프레임의 포트에 직접 만든다.
 * RD-005: 줄 읽기는 worker가 RPC `readLine`을 요청하는 경로가 유일하다. RD-003의 줄 편집 시험은 worker 역할 rpc가
 * `readLine`을 요청하는 형태로 옮겼고, `sessionTerminated` 알림 → `onStatus('terminated')`를 더했다.
 * RD-006: worker의 `readInput` 알림 → stdin 읽기(꼬리 프롬프트) → 메일박스 `deliver`·`fail`, REPL 읽기와의 순서(read-guard).
 * worker가 없어 메일박스를 아무도 가져가지 않으므로 main이 쓴 값이 그대로 남는다. 실제 `Atomics.wait` 왕복은
 * `protocol/thread-scenario.test.ts`가 본다.
 * RD-007: 실행 중 Ctrl+C. 벤더 `Readline`이 활성 읽기 없이 부르는 `setCtrlCHandler`가 `^C`를 꼬리에 쓰고 프레임의
 * interrupt buffer에 SIGINT를 쓰는지, 게이트(`pythonRunning`)가 대상 코드가 없는 구간의 눌림을 버리는지, cancel 지점이
 * 송신기의 재전송을 멈추는지 본다. 송신기의 상태기계 자체는 `protocol/interrupt-sender.test.ts`가 맡는다.
 * RD-008: 입력줄 Ctrl+C 취소. REPL 읽기는 응답 `null`, stdin 읽기는 메일박스 CANCELLED가 되고 둘 다 `^C`를 찍지 않는다.
 * 취소 응답 뒤 다음 요청이 오기 전의 구간(`cancelSettling`)은 게이트를 닫고, `input()` 취소에는 닫지 않는다.
 */
import { Readline } from "@cp949/runo-xterm-readline";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  createRepl,
  DEFAULT_PYODIDE_INDEX_URL,
  NOT_ISOLATED_WARNING,
  RESET_NOTICE,
  type ReplHandle,
  type ReplOptions,
} from "./index";
import { parseInitFrame, type InitFrame } from "./protocol/init-frame";
import { ACK, SEQ, SIGNAL } from "./protocol/interrupt-protocol";
import { createRpc, type Rpc } from "./protocol/rpc";
import {
  createFakeTerminal,
  type FakeTerminal,
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

/** 배열 인덱스가 반드시 있는 시험에서 `T | undefined`를 `T`로 좁힌다(`noUncheckedIndexedAccess`). */
function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("있어야 할 값이 없다");
  return value;
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
 * `reset()` 시험용: `createWorker`를 부를 때마다 새 가짜 worker를 만든다(`startSession`은 같은 worker를 재사용해
 * 리셋 전후의 worker를 구분할 수 없다). `fake`는 세션을 넘어 하나다(화면·history가 리셋을 넘어 산다). `fakeWorker`·
 * `workerRpc`는 가장 최근 세션(리셋됐으면 새 세션)을 가리킨다 — 기존 헬퍼(`startRead` 등)를 리셋 뒤에도 그대로 쓸 수 있게.
 */
function startResettableSession(
  overrides: Partial<ReplOptions> = {},
  terminalOptions: FakeTerminalOptions = {},
) {
  const fake = createFakeTerminal(terminalOptions);
  const workers: ReturnType<typeof createFakeWorker>[] = [];
  const rpcs: Rpc[] = [];
  const onStatus = vi.fn();
  const createWorkerSpy = vi.fn(() => {
    const fakeWorker = createFakeWorker();
    workers.push(fakeWorker);
    return fakeWorker.worker;
  });
  const handle = createRepl({
    terminal: fake.term,
    createWorker: createWorkerSpy,
    onStatus,
    ...overrides,
  });
  handles.push(handle);
  const bytes = () => fake.written.join("");
  const workerRpcAt = (index: number): Rpc => {
    const existing = rpcs[index];
    if (existing !== undefined) return existing;
    const rpc = createRpc(must(workers[index]).frame().rpcPort);
    workerRpcs.push(rpc);
    rpcs[index] = rpc;
    return rpc;
  };
  return {
    fake,
    workers,
    onStatus,
    createWorkerSpy,
    handle,
    workerRpcAt,
    get fakeWorker() {
      return must(workers[workers.length - 1]);
    },
    get workerRpc() {
      return workerRpcAt(workers.length - 1);
    },
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

/** `term.write("", cb)`를 요청한 횟수. 읽기가 시작되는 중이라는 신호다(`startRead` 설명 참고). */
const flushRequestCount = (fake: FakeTerminal) =>
  fake.written.filter((text) => text === "").length;

/** 읽기 요청이 도착해 write 콜백을 배출하면 읽기가 시작된다. `before`는 요청 전의 `flushRequestCount`다. */
async function drainReadStart(fake: FakeTerminal, before: number) {
  await waitFor(() => flushRequestCount(fake) > before);
  fake.flush();
  await tick();
  fake.flush();
}

/** worker 역할 rpc로 `readInput`을 알리고 stdin 읽기가 시작될 때까지 기다린다. 응답 통로는 메일박스뿐이라 반환값이 없다. */
async function startInputRead(
  session: Pick<ReturnType<typeof startSession>, "fake" | "workerRpc">,
) {
  const before = flushRequestCount(session.fake);
  session.workerRpc.notify("readInput", true);
  await drainReadStart(session.fake, before);
}

// 메일박스 값(01-protocols.md 2.1): ctrl = [STATE, BYTE_LENGTH, FLAGS, 예약],
// STATE 0=IDLE·1=READY·2=CANCELLED·3=ERROR, FLAGS 비트 0=마지막 청크.
const MAILBOX = { IDLE: 0, READY: 1, CANCELLED: 2, ERROR: 3 } as const;
const FLAG_LAST = 1;

/** 초기화 프레임의 메일박스를 읽는다. main의 `createMailboxWriter`가 쓰는 것과 같은 SharedArrayBuffer다. */
function readMailbox(
  session: Pick<ReturnType<typeof startSession>, "fakeWorker">,
) {
  const { stdinCtrl, stdinData } = session.fakeWorker.frame();
  const length = Atomics.load(stdinCtrl, 1);
  return {
    state: Atomics.load(stdinCtrl, 0),
    length,
    text: new TextDecoder().decode(stdinData.slice(0, length)),
    last: (Atomics.load(stdinCtrl, 2) & FLAG_LAST) !== 0,
  };
}

/** 메일박스가 READY(전달됨)가 될 때까지 기다린다. `deliver`는 비동기라 Enter 직후에는 아직일 수 있다. */
const waitDelivered = (
  session: Pick<ReturnType<typeof startSession>, "fakeWorker">,
) => waitFor(() => readMailbox(session).state === MAILBOX.READY);

/** 메일박스가 CANCELLED(`input()` 취소)가 될 때까지 기다린다. `cancel()`도 비동기다. */
const waitCancelled = (
  session: Pick<ReturnType<typeof startSession>, "fakeWorker">,
) => waitFor(() => readMailbox(session).state === MAILBOX.CANCELLED);

type Session = ReturnType<typeof startSession>;

/** 프레임의 interrupt buffer 슬롯 세 개. main 송신기가 쓰는 것과 같은 SharedArrayBuffer 뷰다. */
function slots(session: Pick<Session, "fakeWorker">) {
  const buffer = session.fakeWorker.frame().interruptBuffer;
  return {
    signal: Atomics.load(buffer, SIGNAL),
    ack: Atomics.load(buffer, ACK),
    seq: Atomics.load(buffer, SEQ),
  };
}

/** 지금까지 터미널에 쓴 `^C` 에코 횟수. */
const echoes = (session: Pick<Session, "bytes">) =>
  session.bytes().split("^C").length - 1;

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

describe.each([
  { mode: "동기", asyncWrite: false },
  { mode: "비동기", asyncWrite: true },
])("input() 읽기(write 콜백이 $mode 모드일 때)", ({ asyncWrite }) => {
  /** 실제 `Readline.read`를 그대로 부르면서 받은 프롬프트를 기록한다(프로토타입 메서드라 addon 인스턴스에도 적용된다). */
  function spyPrompts() {
    const read = vi.spyOn(Readline.prototype, "read");
    return () => read.mock.calls.map(([prompt]) => prompt);
  }

  test("readInput 알림에 직전 출력의 꼬리를 프롬프트로 한 줄을 읽어 메일박스에 전달한다", async () => {
    const session = startSession({}, { asyncWrite });
    const prompts = spyPrompts();
    session.workerRpc.notify("write", "x: ");
    await startInputRead(session);

    session.fake.type("abc\r");
    await waitDelivered(session);

    expect(prompts()).toEqual(["x: "]);
    expect(readMailbox(session)).toMatchObject({ text: "abc", last: true });
    // 프롬프트와 입력이 Enter 때 한 조각으로 다시 그려진다 — 화면에는 `x: abc` 한 줄이 남는다.
    expect(session.fake.written).toContain("x: abc");
  });

  test("꼬리가 없으면 프롬프트 없이 읽는다", async () => {
    const session = startSession({}, { asyncWrite });
    const prompts = spyPrompts();
    await startInputRead(session);

    session.fake.type("abc\r");
    await waitDelivered(session);

    expect(prompts()).toEqual([""]);
    expect(readMailbox(session)).toMatchObject({ text: "abc", last: true });
  });

  test("빈 줄 Enter는 빈 문자열을 전달한다(길이 0, 마지막 청크)", async () => {
    const session = startSession({}, { asyncWrite });
    await startInputRead(session);

    session.fake.type("\r");
    await waitDelivered(session);

    expect(readMailbox(session)).toMatchObject({
      length: 0,
      text: "",
      last: true,
    });
  });

  test("REPL 읽기가 열려 있는 동안 도착한 readInput은 그 줄을 Enter한 뒤에 시작하고 REPL 줄은 REPL 응답이 된다", async () => {
    const session = startSession({}, { asyncWrite });
    const { fake, workerRpc } = session;
    const prompts = spyPrompts();
    const { line } = await startRead(session);
    const outcome = observe(line);

    // 프롬프트를 기다리는 사이 배경 콜백의 `input("bg> ")`가 프롬프트를 쓰고 stdin 읽기를 요청한다.
    workerRpc.notify("write", "bg> ");
    workerRpc.notify("readInput", true);
    await settle();
    expect(prompts()).toEqual([">>> "]);
    expect(readMailbox(session).state).toBe(MAILBOX.IDLE);
    expect(outcome().state).toBe("pending");

    // 사용자가 REPL 줄을 친다. 이 줄은 REPL 응답이 되고 stdin 읽기는 그 뒤에 배경 프롬프트(`bg> `)로 시작한다.
    const before = flushRequestCount(fake);
    fake.type("x = 41\r");
    await drainReadStart(fake, before);
    await waitFor(() => outcome().state === "resolved");
    expect(outcome()).toEqual({ state: "resolved", value: "x = 41" });
    expect(prompts()).toEqual([">>> ", "bg> "]);
    expect(readMailbox(session).state).toBe(MAILBOX.IDLE);

    fake.type("hello\r");
    await waitDelivered(session);
    expect(readMailbox(session)).toMatchObject({ text: "hello", last: true });
  });

  test("겹치는 readLine 요청의 거절이 read-guard의 활성 REPL 읽기 추적을 깨지 않는다", async () => {
    const session = startSession({}, { asyncWrite });
    const { fake, workerRpc } = session;
    const prompts = spyPrompts();
    const { line: first } = await startRead(session);
    const second = observe(workerRpc.call("readLine", ">>> ", undefined, true));
    await waitFor(() => second().state === "rejected");

    // 거절된 요청을 가드가 활성 읽기로 추적하면 진짜 활성 REPL 읽기를 잃어 stdin 읽기가 앞당겨진다.
    workerRpc.notify("readInput", true);
    await settle();
    expect(prompts()).toEqual([">>> "]);

    const before = flushRequestCount(fake);
    fake.type("ok\r");
    await drainReadStart(fake, before);
    await expect(first).resolves.toBe("ok");
    expect(prompts()).toEqual([">>> ", ""]);
    fake.type("hello\r");
    await waitDelivered(session);
    expect(readMailbox(session)).toMatchObject({ text: "hello", last: true });
  });

  test("dispose하면 대기 중인 stdin 읽기가 끝나도 메일박스를 쓰지 않고 오류도 내지 않는다", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const session = startSession({}, { asyncWrite });
    session.workerRpc.notify("write", "x: ");
    await startInputRead(session);

    // `readline.dispose()`가 대기 중인 읽기를 reject한다. dispose된 세션의 worker는 이미 terminate됐으므로 `fail`하지 않는다.
    session.handle.dispose();
    session.fake.flush();
    await settle();

    expect(readMailbox(session).state).toBe(MAILBOX.IDLE);
    expect(consoleError).not.toHaveBeenCalled();
  });

  test("폭을 넘는 꼬리를 정리하려고 flush를 기다리는 중에 dispose해도 stdin 읽기의 뒤늦은 콜백이 해제된 buffer를 읽지 않는다", async () => {
    const { handle, fake, workerRpc } = startSession({}, { asyncWrite });
    // 100자 꼬리는 짧지 않아 `rewindTail`이 flush를 기다린다(비동기 모드에서는 그 콜백이 dispose 뒤에 온다).
    workerRpc.notify("write", "x".repeat(100));
    workerRpc.notify("readInput", true);
    await waitFor(() => fake.written.includes(""));

    handle.dispose();
    expect(() => fake.term.dispose()).not.toThrow();
    fake.flush();
    await tick();
    fake.flush();

    expect(fake.disposedBufferReads).toBe(0);
  });

  test("읽기가 dispose 밖의 이유로 실패하면 fail로 worker를 깨워 사유를 알린다", async () => {
    const session = startSession({}, { asyncWrite });
    vi.spyOn(Readline.prototype, "read").mockRejectedValueOnce(
      new Error("읽기 실패"),
    );

    session.workerRpc.notify("readInput", true);
    await waitFor(() => readMailbox(session).state === MAILBOX.ERROR);

    expect(readMailbox(session).text).toContain("읽기 실패");
  });

  test("stdin 읽기 중 Ctrl+C는 `^C` 없이 읽기를 취소해 메일박스를 CANCELLED로 만든다", async () => {
    const session = startSession({}, { asyncWrite });
    const { fake } = session;
    session.workerRpc.notify("write", "x: ");
    await startInputRead(session);

    fake.type("ab\x03");
    fake.flush();
    await waitCancelled(session);

    expect(session.bytes()).toContain("ab");
    expect(session.bytes()).not.toContain("^C");
    // 취소는 main이 메일박스로 알린다. main은 어느 취소 경로에서도 SIGINT를 쓰지 않는다(DELTA-03이 worker에서 쓴다).
    expect(slots(session).seq).toBe(0);
  });

  test("`input()` 취소 직후의 Ctrl+C는 게이트가 열려 있어 에코하고 전송한다", async () => {
    const session = startSession({}, { asyncWrite });
    const { fake } = session;
    session.workerRpc.notify("write", "x: ");
    await startInputRead(session);
    fake.type("ab\x03");
    fake.flush();
    await waitCancelled(session);
    // `inputReadsPending`은 `cancel()`이 끝난 뒤에 내려간다.
    await settle();

    fake.type("\x03");

    // 취소 뒤에도 사용자 코드(`except KeyboardInterrupt` 뒤 계산)가 계속 돌 수 있으므로 이 구간은 중단 경로다.
    expect(echoes(session)).toBe(1);
    expect(slots(session).seq).toBe(1);
  });
});

describe.each([
  { mode: "동기", asyncWrite: false },
  { mode: "비동기", asyncWrite: true },
])(
  "입력줄 Ctrl+C 취소(RD-008), write 콜백이 $mode 모드일 때",
  ({ asyncWrite }) => {
    test("REPL 읽기 중 Ctrl+C는 `^C` 없이 줄을 바꾸고 `null`로 응답한다", async () => {
      const session = startSession({}, { asyncWrite });
      const { fake } = session;
      const { line } = await startRead(session);

      fake.type("abc\x03");
      fake.flush();

      await expect(line).resolves.toBeNull();
      expect(session.bytes()).toContain("abc");
      expect(session.bytes()).not.toContain("^C");
      expect(session.bytes().endsWith("\r\n")).toBe(true);
      // 취소는 응답 `null`로만 알린다. main은 SIGINT를 쓰지 않는다.
      expect(slots(session).seq).toBe(0);
    });

    test("Shift+Enter로 쌓은 여러 줄 버퍼도 `^C` 없이 취소된다", async () => {
      const session = startSession({}, { asyncWrite });
      const { fake } = session;
      const { line } = await startRead(session);

      fake.type("if True:");
      fake.keyDown({ key: "Enter", shiftKey: true });
      fake.type("    print(3)");
      fake.type("\x03");
      fake.flush();

      await expect(line).resolves.toBeNull();
      expect(session.bytes()).toContain("if True:");
      expect(session.bytes()).toContain("print(3)");
      expect(session.bytes()).not.toContain("^C");
      expect(session.bytes().endsWith("\r\n")).toBe(true);
    });

    test("취소 응답 뒤 새 `readLine` 요청은 겹침으로 거절되지 않는다", async () => {
      const session = startSession({}, { asyncWrite });
      const { fake } = session;
      const { line: cancelled } = await startRead(session);
      fake.type("abc\x03");
      fake.flush();
      await expect(cancelled).resolves.toBeNull();

      const { line: next } = await startRead(session);
      fake.type("ok\r");

      await expect(next).resolves.toBe("ok");
    });

    test("`cancelable`이 거짓인 `readLine` 요청은 벤더 원본대로 `^C`를 찍고 같은 프롬프트를 다시 그린다", async () => {
      const session = startSession({}, { asyncWrite });
      const { fake, workerRpc } = session;
      const before = flushRequestCount(fake);
      const response = observe(
        workerRpc.call("readLine", ">>> ", undefined, false),
      );
      await drainReadStart(fake, before);

      fake.type("abc\x03");
      fake.flush();
      await settle();

      expect(response().state).toBe("pending");
      expect(session.bytes()).toContain("^C");

      fake.type("1\r");
      await waitFor(() => response().state === "resolved");
      expect(response()).toEqual({ state: "resolved", value: "1" });
    });

    test("`cancelable`이 거짓인 `readInput` 알림도 원본대로라 메일박스가 IDLE로 남는다", async () => {
      const session = startSession({}, { asyncWrite });
      const { fake, workerRpc } = session;
      workerRpc.notify("write", "x: ");
      const before = flushRequestCount(fake);
      workerRpc.notify("readInput", false);
      await drainReadStart(fake, before);

      fake.type("ab\x03");
      fake.flush();
      await settle();

      expect(session.bytes()).toContain("^C");
      expect(readMailbox(session).state).toBe(MAILBOX.IDLE);
      expect(slots(session).seq).toBe(0);

      fake.type("cd\r");
      await waitDelivered(session);
      expect(readMailbox(session)).toMatchObject({ text: "cd", last: true });
    });
  },
);

describe("취소 직후의 게이트(cancelSettling, RD-008)", () => {
  test("취소 응답 뒤 다음 요청이 오기 전의 Ctrl+C는 에코도 전송도 하지 않는다", async () => {
    const session = startSession({}, { asyncWrite: true });
    const { fake } = session;
    const { line } = await startRead(session);
    fake.type("abc\x03");
    fake.flush();
    await expect(line).resolves.toBeNull();

    // 벤더에는 활성 읽기가 없어 이 키는 Ctrl+C 핸들러로 온다. 게이트가 막지 않으면 SIGINT가 남아 다음 push가 죽는다(TRP-009).
    fake.type("\x03");

    expect(echoes(session)).toBe(0);
    expect(slots(session).seq).toBe(0);

    // 정상 복귀: 다음 요청이 오면 읽기가 열리고 그 줄이 응답이 된다.
    const { line: next } = await startRead(session);
    fake.type("1\r");
    await expect(next).resolves.toBe("1");
  });

  test("`readLine` 요청 도착이 방어를 내려 응답 뒤의 Ctrl+C는 다시 전송된다", async () => {
    const session = startSession({}, { asyncWrite: true });
    const { fake } = session;
    const { line } = await startRead(session);
    fake.type("abc\x03");
    fake.flush();
    await expect(line).resolves.toBeNull();

    const { line: next } = await startRead(session);
    fake.type("1\r");
    await expect(next).resolves.toBe("1");

    fake.type("\x03");

    expect(echoes(session)).toBe(1);
    expect(slots(session).seq).toBe(1);
  });

  test("취소 뒤 열린 stdin 읽기가 값을 전달하면(`inputReadsPending` → 0) 방어가 내려간다", async () => {
    const session = startSession({}, { asyncWrite: true });
    const { fake, workerRpc } = session;
    const { line } = await startRead(session);
    // 프롬프트를 기다리는 사이 배경 콜백의 `input()`이 도착한다. 가드가 REPL 읽기 뒤로 미룬다.
    const before = flushRequestCount(fake);
    workerRpc.notify("readInput", true);
    await settle();

    // REPL 읽기를 취소하면 방어가 서고, 가드가 미뤄 둔 stdin 읽기가 열린다.
    fake.type("\x03");
    fake.flush();
    await expect(line).resolves.toBeNull();
    await drainReadStart(fake, before);

    fake.type("abc\r");
    await waitDelivered(session);
    await settle();

    // 값을 전달한 시점이 worker가 깨어나 사용자 코드를 재개하는 시점이다. 요청 도착만으로 내리면 이 구간이 막힌다.
    fake.type("\x03");
    expect(echoes(session)).toBe(1);
    expect(slots(session).seq).toBe(1);
  });

  test("cancelable 읽기 중 dispose하면 응답이 가지 않고 이후 Ctrl+C는 무동작이다", async () => {
    const session = startSession({}, { asyncWrite: true });
    const { fake } = session;
    const { line } = await startRead(session);
    const outcome = observe(line);
    fake.type("abc");

    session.handle.dispose();
    fake.flush();
    await settle();

    // 읽기는 `Error("readline disposed")`로 끝나지만 dispose가 RPC를 먼저 끊으므로 worker 역할 rpc에는 응답이 오지 않는다.
    expect(outcome().state).toBe("pending");
    const writtenAtDispose = fake.written.length;
    expect(() => fake.type("\x03")).not.toThrow();
    expect(fake.written).toHaveLength(writtenAtDispose);
    expect(slots(session).seq).toBe(0);
  });
});

describe("실행 중 Ctrl+C(RD-007)", () => {
  /** 소실을 흉내 낸다: ack 없이 SIGNAL만 0으로 지운다. 송신기가 살아 있으면 5ms 안에 같은 번호로 다시 쓴다. */
  function loseSignal(session: Pick<Session, "fakeWorker">) {
    Atomics.store(session.fakeWorker.frame().interruptBuffer, SIGNAL, 0);
  }

  /** worker가 메일박스 청크를 가져간 것처럼 STATE를 IDLE로 되돌려 main이 다음 청크를 쓰게 한다. */
  function takeChunk(session: Pick<Session, "fakeWorker">) {
    const { stdinCtrl } = session.fakeWorker.frame();
    Atomics.store(stdinCtrl, 0, MAILBOX.IDLE);
    Atomics.notify(stdinCtrl, 0);
  }

  /** 상태 콜백이 `loading` 다음 값을 받을 때까지 기다린다. cancel·게이트 갱신이 그 콜백보다 먼저 끝나 있다. */
  const waitNextStatus = (session: Pick<Session, "onStatus">) =>
    waitFor(() => session.onStatus.mock.calls.length === 2);

  test("활성 읽기가 없을 때(로딩 중 포함) Ctrl+C는 `^C`를 쓰고 요청 번호를 올려 SIGINT를 쓴다", async () => {
    // `ready`를 보내지 않아 세션은 아직 로딩 중이다. 부팅 중 눌림도 버퍼에 써져 worker가 폐기한다(boot-press).
    const session = startSession();
    session.workerRpc.notify("write", "t");
    await waitFor(() => session.bytes() === "t");

    session.fake.type("\x03");

    expect(session.bytes()).toBe("t^C");
    expect(slots(session)).toEqual({ signal: 2, ack: 0, seq: 1 });
  });

  test("`^C`는 sink write로 나가 꼬리에 남으므로 다음 프롬프트가 `t^C>>> `로 이어진다", async () => {
    const session = startSession();
    session.workerRpc.notify("write", "t");
    await waitFor(() => session.bytes() === "t");
    session.fake.type("\x03");

    await startRead(session);

    // `readline.print("^C")`로 에코하면 꼬리가 `t`뿐이라 `t>>> `가 되고 `^C`는 프롬프트 밖에 따로 남는다(S1).
    expect(session.bytes()).toContain("t^C\x1b[0m>>> ");
  });

  test("Ctrl+C를 연달아 누르면 눌림마다 `^C`를 쓰고 요청 번호를 하나씩 올린다", () => {
    const session = startSession();

    session.fake.type("\x03\x03\x03");

    expect(session.bytes()).toBe("^C^C^C");
    expect(slots(session)).toEqual({ signal: 2, ack: 0, seq: 3 });
  });

  test("눌림을 보낸 뒤 소실되면(SIGNAL만 0) 송신기가 같은 요청 번호로 다시 쓴다", async () => {
    const session = startSession();
    session.fake.type("\x03");
    loseSignal(session);

    await settle();

    // 재전송은 번호를 올리지 않는다. 이 시험은 송신기가 프레임의 그 버퍼에 배선됐는지만 본다(상태기계는 interrupt-sender 시험).
    expect(slots(session)).toEqual({ signal: 2, ack: 0, seq: 1 });
  });

  test.each([
    { notification: "sessionTerminated", args: [] },
    { notification: "loadFailed", args: ["Error: boom"] },
  ])(
    "$notification 뒤 Ctrl+C는 에코도 전송도 하지 않는다",
    async ({ notification, args }) => {
      const session = startSession();
      session.fake.type("\x03");
      // 대조: 세션이 살아 있는 동안에는 전송된다.
      expect(slots(session).seq).toBe(1);
      session.workerRpc.notify(notification, ...args);
      await waitNextStatus(session);

      session.fake.type("\x03");

      expect(slots(session).seq).toBe(1);
      expect(echoes(session)).toBe(1);
    },
  );

  test("`readLine` 요청이 도착한 뒤 읽기가 활성화되기 전(flush 갭)의 Ctrl+C는 에코도 전송도 하지 않는다", async () => {
    const session = startSession({}, { asyncWrite: true });
    const { fake, workerRpc } = session;
    const before = flushRequestCount(fake);
    const response = observe(
      workerRpc.call("readLine", ">>> ", undefined, true),
    );
    await waitFor(() => flushRequestCount(fake) > before);

    // 읽기 시작 write 콜백이 아직 오지 않아 벤더 `Readline`에는 활성 읽기가 없다. 그래서 이 키는 Ctrl+C 핸들러로 온다.
    fake.type("\x03");
    expect(echoes(session)).toBe(0);
    expect(slots(session).seq).toBe(0);

    fake.flush();
    await tick();
    fake.flush();
    fake.type("1\r");
    await waitFor(() => response().state === "resolved");
    expect(response()).toEqual({ state: "resolved", value: "1" });

    // 응답이 나간 뒤에는 worker가 실행을 재개한 것으로 보고 전송한다.
    fake.type("\x03");
    expect(slots(session).seq).toBe(1);
    expect(echoes(session)).toBe(1);
  });

  test("`readInput` 알림이 도착한 뒤 읽기가 활성화되기 전의 Ctrl+C는 에코도 전송도 하지 않고, 값을 전달한 뒤에는 전송한다", async () => {
    const session = startSession({}, { asyncWrite: true });
    const { fake, workerRpc } = session;
    workerRpc.notify("write", "x: ");
    const before = flushRequestCount(fake);
    workerRpc.notify("readInput", true);
    await waitFor(() => flushRequestCount(fake) > before);

    fake.type("\x03");
    expect(echoes(session)).toBe(0);
    expect(slots(session).seq).toBe(0);

    fake.flush();
    await tick();
    fake.flush();
    fake.type("abc\r");
    await waitDelivered(session);

    // 메일박스에 값이 실린 시점이 worker가 깨어나 실행을 재개하는 시점이다.
    fake.type("\x03");
    expect(slots(session).seq).toBe(1);
    expect(echoes(session)).toBe(1);
  });

  test("REPL 읽기가 실패로 끝나도 게이트가 다시 열린다", async () => {
    const session = startSession();
    vi.spyOn(Readline.prototype, "read").mockRejectedValueOnce(
      new Error("읽기 실패"),
    );
    const response = observe(
      session.workerRpc.call("readLine", ">>> ", undefined, true),
    );
    await waitFor(() => response().state === "rejected");

    session.fake.type("\x03");

    // 읽기가 줄·취소·실패 어느 쪽으로 끝나든 게이트는 열려야 한다. 닫힌 채 남으면 Ctrl+C가 영영 죽는다.
    expect(slots(session).seq).toBe(1);
  });

  test("`input()` 응답을 아직 다 전달하지 못한 동안(다음 청크 대기) Ctrl+C는 에코도 전송도 하지 않는다", async () => {
    const session = startSession();
    await startInputRead(session);
    // 64KiB를 넘는 줄은 청크로 나뉜다. worker가 첫 청크를 가져가기 전에는 다음 청크를 쓰지 못하고 멈춘다.
    session.fake.paste("x".repeat(70_000));
    session.fake.type("\r");
    await waitDelivered(session);

    session.fake.type("\x03");
    expect(echoes(session)).toBe(0);
    expect(slots(session).seq).toBe(0);

    // 마지막 청크까지 실리면 worker가 깨어나 실행을 재개한다. 그때부터 다시 전송한다.
    takeChunk(session);
    await waitFor(() => readMailbox(session).last);
    session.fake.type("\x03");
    expect(slots(session).seq).toBe(1);
  });

  test("`readLine` 요청이 도착하면 송신기가 취소돼 소실된 눌림을 다시 쓰지 않는다", async () => {
    const session = startSession();
    const { fake, workerRpc } = session;
    fake.type("\x03");
    const before = flushRequestCount(fake);
    observe(workerRpc.call("readLine", ">>> ", undefined, true));
    // 읽기 시작 write는 요청 핸들러가 돈 뒤에 나온다. 그 뒤에 지워야 재전송이 취소 때문에 없는 것이 된다.
    await waitFor(() => flushRequestCount(fake) > before);

    loseSignal(session);
    await settle();

    expect(slots(session).signal).toBe(0);
  });

  test("`readInput` 알림이 도착하면 송신기가 취소돼 소실된 눌림을 다시 쓰지 않는다", async () => {
    const session = startSession();
    const { fake, workerRpc } = session;
    workerRpc.notify("write", "x: ");
    await waitFor(() => session.bytes() === "x: ");
    fake.type("\x03");
    const before = flushRequestCount(fake);
    workerRpc.notify("readInput", true);
    await waitFor(() => flushRequestCount(fake) > before);

    loseSignal(session);
    await settle();

    expect(slots(session).signal).toBe(0);
  });

  test.each([
    { notification: "sessionTerminated", args: [] },
    { notification: "loadFailed", args: ["Error: boom"] },
  ])(
    "$notification 알림이 도착하면 송신기가 취소돼 소실된 눌림을 다시 쓰지 않는다",
    async ({ notification, args }) => {
      const session = startSession();
      session.fake.type("\x03");
      session.workerRpc.notify(notification, ...args);
      await waitNextStatus(session);

      loseSignal(session);
      await settle();

      expect(slots(session).signal).toBe(0);
    },
  );

  test("dispose하면 송신기가 취소돼 소실된 눌림을 다시 쓰지 않는다", async () => {
    const session = startSession();
    session.fake.type("\x03");

    session.handle.dispose();
    loseSignal(session);
    await settle();

    expect(slots(session).signal).toBe(0);
  });

  test("dispose 뒤 Ctrl+C는 에코도 전송도 하지 않고 오류도 내지 않는다", () => {
    const session = startSession();
    session.handle.dispose();
    const writtenAtDispose = session.fake.written.length;

    expect(() => session.fake.type("\x03")).not.toThrow();

    expect(session.fake.written).toHaveLength(writtenAtDispose);
    expect(slots(session).seq).toBe(0);
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

describe("reset()(RD-010)", () => {
  test("reset은 cancelRead → rpc dispose(port.close) → worker.terminate 순서로 옛 세션을 끝내고, SIGNAL을 지우며 송신기도 멈춘다", async () => {
    const cancelReadSpy = vi.spyOn(Readline.prototype, "cancelRead");
    const closeSpy = vi.spyOn(MessagePort.prototype, "close");

    const session = startResettableSession();
    const oldWorker = must(session.workers[0]);
    session.workerRpc.notify("write", "t");
    await waitFor(() => session.bytes() === "t");

    // 가짜 worker는 SIGINT를 소비(ack)하지 않는다 — 송신기가 살아 있다면 5ms마다 재전송한다.
    session.fake.type("\x03");
    const buffer = oldWorker.frame().interruptBuffer;
    await waitFor(() => Atomics.load(buffer, SIGNAL) === 2);
    cancelReadSpy.mockClear();
    closeSpy.mockClear();

    session.handle.reset();

    expect(Atomics.load(buffer, SIGNAL)).toBe(0);
    expect(cancelReadSpy).toHaveBeenCalledTimes(1);
    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(must(cancelReadSpy.mock.invocationCallOrder[0])).toBeLessThan(
      must(closeSpy.mock.invocationCallOrder[0]),
    );
    expect(must(closeSpy.mock.invocationCallOrder[0])).toBeLessThan(
      must(oldWorker.terminate.mock.invocationCallOrder[0]),
    );

    // 송신기가 멈췄으면 잠시 뒤에도 SIGNAL이 되살아나지 않는다(재전송 없음, TRP-009 계승).
    await settle();
    expect(Atomics.load(buffer, SIGNAL)).toBe(0);
  });

  test("reset은 같은 interruptBuffer를 새 프레임에 싣고 createWorker를 다시 부르며, 옛 worker만 terminate된다", () => {
    const session = startResettableSession();
    const oldWorker = must(session.workers[0]);
    const buffer = oldWorker.frame().interruptBuffer;

    session.handle.reset();

    expect(session.createWorkerSpy).toHaveBeenCalledTimes(2);
    expect(session.workers).toHaveLength(2);
    const newWorker = must(session.workers[1]);
    expect(newWorker.frame().interruptBuffer.buffer).toBe(buffer.buffer);
    expect(oldWorker.terminate).toHaveBeenCalledTimes(1);
    expect(newWorker.terminate).not.toHaveBeenCalled();
  });

  test("reset은 새 sink 세트·메일박스로 시작해 이전 꼬리·메일박스 값을 물려받지 않는다", async () => {
    const session = startResettableSession();
    session.workerRpc.notify("write", "t");
    await waitFor(() => session.bytes() === "t");
    const oldStdinData = must(session.workers[0]).frame().stdinData;

    session.handle.reset();
    await startRead(session);

    expect(session.bytes()).toContain(RESET_NOTICE);
    // 새 세션의 프롬프트가 옛 세션의 꼬리("t")를 이어 그리지 않는다(`t\x1b[0m>>> ` 형태가 되지 않는다, 296행과 대조).
    expect(session.bytes()).not.toContain("t\x1b[0m>>> ");
    const afterNotice = session
      .bytes()
      .slice(session.bytes().indexOf(RESET_NOTICE));
    expect(afterNotice).toContain(">>> ");
    expect(must(session.workers[1]).frame().stdinData.buffer).not.toBe(
      oldStdinData.buffer,
    );
  });

  test("reset은 loading을 동기로 발행하고 새 worker의 ready 알림에 ready를 발행한다", async () => {
    const session = startResettableSession();
    session.onStatus.mockClear();

    session.handle.reset();

    expect(session.onStatus.mock.calls.at(-1)).toEqual(["loading"]);

    session.workerRpc.notify("ready", { pyodideVersion: "0.28.3" });
    await waitFor(() => session.onStatus.mock.calls.at(-1)?.[0] === "ready");

    expect(session.onStatus.mock.calls.at(-1)).toEqual(["ready"]);
  });

  test("리셋 안내 줄: 커서가 행 머리가 아니면 개행 뒤에, 행 머리면 바로 그려진다(TRP-006)", () => {
    const session = startResettableSession();

    session.fake.screen.cursorX = 4;
    const before1 = session.fake.written.length;
    session.handle.reset();
    const written1 = session.fake.written.slice(before1).join("");
    expect(written1.startsWith("\r\n")).toBe(true);
    expect(written1).toContain(RESET_NOTICE);

    session.fake.screen.cursorX = 0;
    const before2 = session.fake.written.length;
    session.handle.reset();
    const written2 = session.fake.written.slice(before2).join("");
    expect(written2.startsWith("\r\n")).toBe(false);
    expect(written2).toContain(RESET_NOTICE);
  });

  test("reset은 옛 세션의 열린 readLine 읽기를 응답 없이 끝내고 새 세션의 첫 readLine 요청을 받는다", async () => {
    const session = startResettableSession();
    const { line: oldLine } = await startRead(session);
    const oldOutcome = observe(oldLine);

    session.handle.reset();
    await settle();

    expect(oldOutcome()).toEqual({ state: "pending" });

    // "이미 읽는 중"으로 거절되지 않고 새 세션의 첫 readLine이 정상 시작된다(reading은 세션마다 새로 시작).
    const { line: newLine } = await startRead(session);
    session.fake.type("ok\r");

    await expect(newLine).resolves.toBe("ok");
  });

  test("reset은 열린 input() 읽기를 끝내되 옛 메일박스에 fail을 쓰지 않는다(TRP-003)", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const session = startResettableSession();
    session.workerRpc.notify("write", "x: ");
    await startInputRead(session);
    const oldWorker = must(session.workers[0]);

    session.handle.reset();
    await settle();

    expect(readMailbox({ fakeWorker: oldWorker }).state).toBe(MAILBOX.IDLE);
    expect(consoleError).not.toHaveBeenCalled();
  });

  test("취소 응답 뒤(cancelSettling) 리셋하면 새 세션의 첫 Ctrl+C가 에코·전송된다", async () => {
    const session = startResettableSession();
    const { line } = await startRead(session);
    session.fake.type("abc\x03");
    await expect(line).resolves.toBeNull();

    session.handle.reset();
    const newWorker = must(session.workers[1]);
    session.fake.type("\x03");

    expect(echoes(session)).toBe(1);
    expect(slots({ fakeWorker: newWorker }).seq).toBe(1);
  });

  test("ready·terminated·load-failed·loading 상태 어디서든 reset이 새 세션을 만든다", () => {
    const triggers: Array<
      (s: ReturnType<typeof startResettableSession>) => void
    > = [
      () => {}, // loading(기본 상태, ready 알림 전)
      (s) => s.workerRpc.notify("ready", { pyodideVersion: "0.28.3" }),
      (s) => s.workerRpc.notify("sessionTerminated"),
      (s) => s.workerRpc.notify("loadFailed", "실패"),
    ];
    for (const trigger of triggers) {
      const session = startResettableSession();
      trigger(session);

      session.handle.reset();

      expect(session.workers).toHaveLength(2);
      expect(session.createWorkerSpy).toHaveBeenCalledTimes(2);
      expect(session.onStatus.mock.calls.at(-1)).toEqual(["loading"]);
    }
  });

  test("dispose 뒤 reset은 아무것도 하지 않는다", () => {
    const session = startResettableSession();
    session.handle.dispose();
    const writtenAtDispose = session.fake.written.length;

    expect(() => session.handle.reset()).not.toThrow();

    expect(session.createWorkerSpy).toHaveBeenCalledTimes(1);
    expect(session.fake.written).toHaveLength(writtenAtDispose);
  });

  test("reset 뒤 dispose는 마지막 세션만 끝낸다", () => {
    const session = startResettableSession();
    const oldWorker = must(session.workers[0]);
    session.handle.reset();
    const newWorker = must(session.workers[1]);

    session.handle.dispose();

    expect(oldWorker.terminate).toHaveBeenCalledTimes(1);
    expect(newWorker.terminate).toHaveBeenCalledTimes(1);
  });

  test("not-isolated에서 reset은 no-op이다", () => {
    vi.stubGlobal("crossOriginIsolated", false);
    const fake = createFakeTerminal();
    const createWorkerSpy = vi.fn(() => createFakeWorker().worker);
    const handle = createRepl({
      terminal: fake.term,
      createWorker: createWorkerSpy,
    });
    handles.push(handle);
    const writtenBefore = fake.written.length;

    expect(() => handle.reset()).not.toThrow();

    expect(createWorkerSpy).not.toHaveBeenCalled();
    expect(fake.written).toHaveLength(writtenBefore);
  });

  test("history는 reset을 넘어 유지된다(같은 Readline 인스턴스)", async () => {
    const session = startResettableSession();
    const { line } = await startRead(session);
    session.fake.type("kept\r");
    await expect(line).resolves.toBe("kept");

    session.handle.reset();

    const { line: next } = await startRead(session);
    session.fake.type("\x1b[A\r"); // ↑로 이전 history를 불러와 그대로 제출
    await expect(next).resolves.toBe("kept");
  });
});
