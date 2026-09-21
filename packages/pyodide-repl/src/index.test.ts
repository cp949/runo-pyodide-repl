/**
 * `createRepl` 시험.
 * RD-003: 실제 `Readline`을 가짜 터미널에 붙여 write 콜백을 동기/비동기로 돌려 본다. 호출자가 준 Terminal에 줄
 * 편집기를 붙여 한 줄을 읽어 돌려주는 것까지가 이 범위다.
 * RD-004: worker 세션 시작(초기화 프레임 전송·출력 알림 4종·`ready`/`loadFailed`·상태 콜백)과 비격리 페이지 경로.
 * worker는 가짜(`postMessage`·`terminate`만 기록)이고, worker 역할의 rpc는 시험이 프레임의 포트에 직접 만든다.
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
function startSession(overrides: Partial<ReplOptions> = {}) {
  const fake = createFakeTerminal();
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
    const repl = createRepl({ terminal: fake.term, createWorker });

    const line = startRead(fake, repl);
    fake.type("abc\r");

    await expect(line).resolves.toBe("abc");
    expect(fake.written.join("")).toContain("abc");
  });

  test("Backspace와 방향키(←/→)로 고친 줄을 돌려준다", async () => {
    const fake = createFakeTerminal({ asyncWrite });
    const repl = createRepl({ terminal: fake.term, createWorker });

    const line = startRead(fake, repl);
    // "acd" → ←← → a 뒤에 "b" 삽입 → "abcd" → → → Backspace가 c를 지움 → "abd"
    fake.type("acd\x1b[D\x1b[Db\x1b[C\x7f\r");

    await expect(line).resolves.toBe("abd");
  });

  test("↑/↓로 이전에 입력한 줄을 불러온다", async () => {
    const fake = createFakeTerminal({ asyncWrite });
    const repl = createRepl({ terminal: fake.term, createWorker });
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
    const repl = createRepl({ terminal: fake.term, createWorker });
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
    const repl = createRepl({ terminal: fake.term, createWorker });
    const line = observe(startRead(fake, repl));

    repl.dispose();
    await tick();

    expect(line()).toEqual({ state: "rejected", reason: expect.any(Error) });
  });

  test("dispose 뒤 readLine은 터미널에 쓰지 않고 Error로 reject된다", async () => {
    const fake = createFakeTerminal({ asyncWrite });
    const repl = createRepl({ terminal: fake.term, createWorker });
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
    const repl = createRepl({ terminal: fake.term, createWorker });
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
    const fake = createFakeTerminal();
    const repl = createRepl({ terminal: fake.term, createWorker });
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

  test("readLine 임시 API는 비격리에서도 동작한다", async () => {
    const fake = createFakeTerminal();
    const handle = createRepl({ terminal: fake.term, createWorker });
    handles.push(handle);

    const line = handle.readLine(">>> ");
    fake.type("a\r");

    await expect(line).resolves.toBe("a");
  });
});
