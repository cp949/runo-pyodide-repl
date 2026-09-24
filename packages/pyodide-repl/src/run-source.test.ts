/**
 * `ReplHandle.runSource(code)`·`busy` 시험(RD-022a DELTA-04, 계약: `_works/20260924-27-rd-022a-repl-run-source/
 * checklist.md` 확정 6~13). 실제 `Readline` + 가짜 터미널(화면을 해석하는 `VtScreen`을 물린다) + 가짜 worker다. worker 역할 rpc가
 * `readLine`을 요청하고, main이 줄 대신 `{ source }`로 응답하면 worker가 코드를 실행한 것처럼 출력을 알리고 결말을 다음 `readLine`
 * 요청의 네 번째 인자로 싣는다. 실제 pyodide 왕복은 worker 쪽 시험(`worker/run-source.test.ts`)과 DELTA-05 브라우저 확인이 맡는다.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { RunRejectedError as CoreRunRejectedError } from "@cp949/runo-pyodide-core";
import {
  ACK,
  PYODIDE_VERSION,
  SEQ,
  SIGNAL,
  createRpc,
  type InitFrame,
  type Rpc,
  type RpcHandlers,
} from "@cp949/runo-pyodide-core";
import { createFakeTerminal } from "@repo/pyodide-testkit/fake-terminal";
import {
  RunRejectedError,
  createRepl,
  type ReplHandle,
  type RunResult,
} from "./index";
import type { ReadLineOutcome, ReadLineReply } from "./repl-protocol";
import { VtScreen } from "./test/vt-screen";
import type { SourceCompletion } from "./worker/complete-source";

type Observed<T> =
  | { state: "pending" }
  | { state: "resolved"; value: T }
  | { state: "rejected"; reason: unknown };

/** promise의 현재 상태를 읽는 함수를 돌려준다(끝나지 않는 promise가 시험을 멈추지 않고, reject에 핸들러가 붙는다). */
function observe<T>(promise: Promise<T>): () => Observed<T> {
  let observed: Observed<T> = { state: "pending" };
  promise.then(
    (value) => {
      observed = { state: "resolved", value };
    },
    (reason: unknown) => {
      observed = { state: "rejected", reason };
    },
  );
  return () => observed;
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 30));

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let waited = 0; waited < 2000; waited += 5) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("기다리던 상태가 되지 않았다");
}

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("있어야 할 값이 없다");
  return value;
}

const readyPayload = () => ({
  pyodideVersion: PYODIDE_VERSION,
  versionMismatch: false,
  degraded: [],
});

const openPorts: MessagePort[] = [];
const handles: ReplHandle[] = [];
const workerRpcs: Rpc[] = [];

function createFakeWorker() {
  const postMessage = vi.fn((message: unknown) => {
    openPorts.push((message as InitFrame).rpcPort);
  });
  const terminate = vi.fn();
  const errorListeners = new Set<(event: { message?: string }) => void>();
  const worker = {
    postMessage,
    terminate,
    addEventListener: (
      type: string,
      listener: (event: { message?: string }) => void,
    ) => {
      if (type === "error") errorListeners.add(listener);
    },
    removeEventListener: (
      type: string,
      listener: (event: { message?: string }) => void,
    ) => {
      if (type === "error") errorListeners.delete(listener);
    },
  } as unknown as Worker;
  return {
    worker,
    terminate,
    frame: () => postMessage.mock.calls[0]?.[0] as InitFrame,
    dispatchError(message: string) {
      for (const listener of errorListeners) listener({ message });
    },
  };
}

interface SessionOptions {
  /** 참이면 write 콜백을 `flush()`까지 미룬다(xterm의 비동기 파싱). */
  asyncWrite?: boolean;
  workerHandlers?: RpcHandlers;
  cols?: number;
}

/** 읽기 요청 하나. `promise`는 main의 응답, `state()`는 그 현재 상태다. */
interface Request {
  promise: Promise<ReadLineReply>;
  state: () => Observed<ReadLineReply>;
}

function startSession(options: SessionOptions = {}) {
  const cols = options.cols ?? 40;
  const fake = createFakeTerminal({ asyncWrite: options.asyncWrite ?? false, cols });
  // 화면을 해석하는 가상 화면을 가짜 터미널의 write 앞에 끼운다. 커서 모델도 함께 갱신한다(`Readline`이 앵커 행으로 읽는다).
  const vt = new VtScreen(cols, 24);
  const originalWrite = fake.term.write.bind(fake.term);
  fake.term.write = ((text: string, callback?: () => void) => {
    vt.write(text);
    fake.screen.cursorX = vt.cursorCol;
    fake.screen.cursorY = vt.cursorRow;
    originalWrite(text, callback);
  }) as typeof fake.term.write;

  const workers: ReturnType<typeof createFakeWorker>[] = [];
  const rpcs: Rpc[] = [];
  const statuses: string[] = [];
  const onStatus = vi.fn((status: string) => {
    statuses.push(status);
  });
  const onCrash = vi.fn<(message: string) => void>();
  const createWorkerSpy = vi.fn(() => {
    const fakeWorker = createFakeWorker();
    workers.push(fakeWorker);
    return fakeWorker.worker;
  });
  const handle = createRepl({
    terminal: fake.term,
    createWorker: createWorkerSpy,
    onStatus,
    onCrash,
  });
  handles.push(handle);

  const rpcAt = (index: number): Rpc => {
    const existing = rpcs[index];
    if (existing !== undefined) return existing;
    const rpc = createRpc(
      must(workers[index]).frame().rpcPort,
      options.workerHandlers ?? {},
    );
    workerRpcs.push(rpc);
    rpcs[index] = rpc;
    return rpc;
  };
  const flushCount = () => fake.written.filter((text) => text === "").length;
  /** 미뤄 둔 write 콜백을 배출하고 마이크로태스크를 지나가게 한다. */
  const pump = async () => {
    fake.flush();
    await tick();
    fake.flush();
    await tick();
  };

  const session = {
    fake,
    vt,
    handle,
    workers,
    statuses,
    onStatus,
    onCrash,
    createWorkerSpy,
    get rpc() {
      return rpcAt(workers.length - 1);
    },
    get worker() {
      return must(workers[workers.length - 1]);
    },
    rpcAt,
    flushCount,
    pump,
    lastStatus: () => statuses[statuses.length - 1],
    /** 마지막 worker가 `ready`를 알린다. */
    async ready() {
      session.rpc.notify("ready", readyPayload());
      await waitFor(() => session.lastStatus() === "ready");
    },
    /**
     * worker 역할 rpc로 `readLine`을 요청한다. `outcome`이 있으면 네 번째 인자로 싣는다. 기본으로 읽기가 그려질 때까지 배출한다
     * (`draw: false`이면 요청이 도착한 것만 확인하고 write 콜백은 배출하지 않는다).
     */
    async request(
      prompt = ">>> ",
      pending: string | undefined = undefined,
      outcome: ReadLineOutcome | undefined = undefined,
      draw = true,
    ): Promise<Request> {
      const before = flushCount();
      const promise =
        outcome === undefined
          ? session.rpc.call<ReadLineReply>("readLine", prompt, pending, true)
          : session.rpc.call<ReadLineReply>(
              "readLine",
              prompt,
              pending,
              true,
              outcome,
            );
      void promise.catch(() => {});
      const state = observe(promise);
      await Promise.race([
        waitFor(() => flushCount() > before),
        // 읽기를 열지 않고 응답하는 요청(대기 슬롯 실행)이나 거절된 요청은 write를 내지 않는다.
        promise.then(
          () => undefined,
          () => undefined,
        ),
      ]);
      if (draw) await pump();
      return { promise, state };
    },
    /** worker가 stdout 조각을 알리고 화면에 반영될 때까지 기다린다. */
    async output(text: string) {
      const before = fake.written.length;
      session.rpc.notify("write", text);
      await waitFor(() => fake.written.length > before);
    },
    /** 인터럽트 buffer 슬롯(마지막 worker의 프레임). */
    slots(index = workers.length - 1) {
      const buffer = must(workers[index]).frame().interruptBuffer;
      return {
        signal: Atomics.load(buffer, SIGNAL),
        ack: Atomics.load(buffer, ACK),
        seq: Atomics.load(buffer, SEQ),
      };
    },
    /** 마지막 worker의 stdin 메일박스가 전달한 텍스트. */
    mailboxText() {
      const { stdinCtrl, stdinData } = session.worker.frame();
      const length = Atomics.load(stdinCtrl, 1);
      return new TextDecoder().decode(stdinData.slice(0, length));
    },
    echoes: () => fake.written.join("").split("^C").length - 1,
  };
  return session;
}

type Session = ReturnType<typeof startSession>;

/** 결과를 기다리지 않는 `runSource` 호출. 시험이 끝나 `dispose()`될 때 거부돼도 처리되지 않은 rejection이 되지 않게 한다. */
function runQuietly(session: Session, code: string): Promise<RunResult> {
  const run = session.handle.runSource(code);
  run.catch(() => {});
  return run;
}

/** `>>> `에서 입력 중인 상태까지 만든다. 첫 요청을 돌려준다. */
async function openPrompt(session: Session, typed = ""): Promise<Request> {
  await session.ready();
  const request = await session.request();
  if (typed !== "") session.fake.type(typed);
  return request;
}

/** 열린 읽기에서 한 줄을 제출하고 main의 응답을 기다린다(이제 worker가 실행 중인 상태). */
async function submit(session: Session, request: Request, line: string) {
  session.fake.type(`${line}\r`);
  await request.promise;
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("crossOriginIsolated", true);
  // `ready` 알림마다 main driver가 남기는 버전 정보 로그를 가린다.
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  for (const rpc of workerRpcs.splice(0)) rpc.dispose();
  for (const handle of handles.splice(0)) handle.dispose();
  for (const port of openPorts.splice(0)) port.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const OK: ReadLineOutcome = { kind: "ok" };

describe.each([
  { mode: "동기", asyncWrite: false },
  { mode: "비동기", asyncWrite: true },
])("runSource 화면·정착($mode 모드)", ({ asyncWrite }) => {
  test("pri를 치던 중 runSource하면 출력 뒤 >>> pri를 다시 그리고 결말로 resolve한다, 이어 x를 제출할 수 있다", async () => {
    const session = startSession({ asyncWrite });
    const first = await openPrompt(session, "pri");
    expect(session.vt.screen()).toBe(">>> pri");

    const run = observe(session.handle.runSource("x = 1\nprint(x)"));
    // main은 열린 읽기의 응답을 줄이 아니라 `{ source }`로 보낸다. 프롬프트 행이 지워진다.
    await expect(first.promise).resolves.toEqual({ source: "x = 1\nprint(x)" });
    await session.pump();
    expect(session.vt.screen()).toBe("");
    expect(session.vt.cursor()).toEqual([0, 0]);

    await session.output("1\n");
    expect(run().state).toBe("pending");
    const second = await session.request(">>> ", undefined, OK);

    expect(run()).toEqual({ state: "resolved", value: OK });
    expect(session.vt.screen()).toBe("1\n>>> pri");
    expect(session.vt.cursor()).toEqual([1, 7]);

    // 복원된 줄은 보통 읽기다: 지우고 x를 제출하면 그 줄이 응답이 된다.
    session.fake.type("\x15x\r");
    await expect(second.promise).resolves.toBe("x");
  });

  test("커서가 입력 중간(p|ri)이면 그 위치에 복원하고, 이어 친 글자가 그 자리에 들어간다", async () => {
    const session = startSession({ asyncWrite });
    const first = await openPrompt(session, "pri");
    session.fake.type("\x1b[D\x1b[D");
    expect(session.vt.cursor()).toEqual([0, 5]);

    runQuietly(session, "print(1)");
    await first.promise;
    await session.output("1\n");
    const second = await session.request(">>> ", undefined, OK);

    expect(session.vt.screen()).toBe("1\n>>> pri");
    expect(session.vt.cursor()).toEqual([1, 5]);
    session.fake.type("X\r");
    await expect(second.promise).resolves.toBe("pXri");
  });

  test("이전 출력의 꼬리가 붙은 프롬프트(a>>> pri)는 꼬리를 남기고 행을 바꿔 출력한다", async () => {
    const session = startSession({ asyncWrite });
    await session.ready();
    await session.output("a");
    const first = await session.request();
    session.fake.type("pri");
    expect(session.vt.screen()).toBe("a>>> pri");

    runQuietly(session, "print(2)");
    await first.promise;
    await session.pump();
    // 꼬리 `a`는 남고 프롬프트·입력 부분만 지워진다. 출력은 새 행에서 시작한다.
    expect(session.vt.screen()).toBe("a");
    expect(session.vt.cursor()).toEqual([1, 0]);

    await session.output("2\n");
    await session.request(">>> ", undefined, OK);
    expect(session.vt.screen()).toBe("a\n2\n>>> pri");
  });

  test("출력이 미종결 줄로 끝나면 다음 프롬프트는 그 꼬리를 이어 그린다(b>>> pri)", async () => {
    const session = startSession({ asyncWrite });
    const first = await openPrompt(session, "pri");

    runQuietly(session, 'print("b", end="")');
    await first.promise;
    await session.output("b");
    await session.request(">>> ", undefined, OK);

    expect(session.vt.screen()).toBe("b>>> pri");
  });

  test("여러 행 입력은 전 행을 지우고 출력한 뒤 같은 모양으로 복원한다", async () => {
    const session = startSession({ asyncWrite });
    const first = await openPrompt(session);
    session.fake.type("pri");
    session.fake.keyDown({ key: "Enter", shiftKey: true });
    session.fake.type("nt");
    const before = session.vt.screen();
    expect(before.split("\n").length).toBe(2);
    const cursorBefore = session.vt.cursor();

    runQuietly(session, "print(9)");
    await first.promise;
    await session.pump();
    expect(session.vt.screen()).toBe("");

    await session.output("9\n");
    await session.request(">>> ", undefined, OK);

    expect(session.vt.screen()).toBe(`9\n${before}`);
    expect(session.vt.cursor()).toEqual([cursorBefore[0] + 1, cursorBefore[1]]);
  });

  test("실행 중 친 키는 type-ahead에 쌓였다가 복원된 커서 위치에 재생된다", async () => {
    const session = startSession({ asyncWrite });
    const first = await openPrompt(session, "pri");
    session.fake.type("\x1b[D");

    runQuietly(session, "print(1)");
    await first.promise;
    session.fake.type("X");
    await session.output("1\n");
    // 읽기가 열리기 전에는 화면에 에코되지 않는다.
    expect(session.vt.screen()).toBe("1");
    const second = await session.request(">>> ", undefined, OK);

    expect(session.vt.screen()).toBe("1\n>>> prXi");
    session.fake.type("\r");
    await expect(second.promise).resolves.toBe("prXi");
  });

  test("결말이 도착해도 복원한 줄이 그려지기 전에는 resolve하지 않고, resolve 시점에 줄이 이미 화면에 있다", async () => {
    const session = startSession({ asyncWrite });
    const first = await openPrompt(session, "pri");
    let screenAtResolve: string | undefined;
    const run = session.handle.runSource("print(1)").then((result) => {
      screenAtResolve = session.vt.screen();
      return result;
    });
    const state = observe(run);
    await first.promise;
    await session.output("1\n");

    const second = await session.request(">>> ", undefined, OK, false);
    await settle();
    if (asyncWrite) {
      // write 콜백이 아직 오지 않아 프롬프트가 그려지지 않았다.
      expect(state().state).toBe("pending");
      expect(session.vt.screen()).toBe("1");
      await session.pump();
    }
    await settle();

    expect(state()).toEqual({ state: "resolved", value: OK });
    expect(screenAtResolve).toBe("1\n>>> pri");
    void second;
  });

  test("runSource 코드는 history에 남지 않는다: 위 화살표는 그 전에 제출한 줄을 불러온다", async () => {
    const session = startSession({ asyncWrite });
    const one = await openPrompt(session);
    await submit(session, one, "one");
    const two = await session.request();
    session.fake.type("pri");

    runQuietly(session, "secret = 1");
    await two.promise;
    const third = await session.request(">>> ", undefined, OK);
    session.fake.type("\x15\x1b[A\r");

    await expect(third.promise).resolves.toBe("one");
  });

  test("error·interrupted·exit 결말도 값 그대로 resolve하고 세션은 유지되어 프롬프트를 다시 그린다", async () => {
    const outcomes: ReadLineOutcome[] = [
      { kind: "error", errorType: "ZeroDivisionError", traceback: "tb\n" },
      { kind: "interrupted", traceback: "KeyboardInterrupt\n" },
      { kind: "exit", code: 3 },
    ];
    for (const outcome of outcomes) {
      const session = startSession({ asyncWrite });
      const first = await openPrompt(session, "pri");
      const run = observe(session.handle.runSource("code"));
      await first.promise;
      await session.output("out\n");
      const second = await session.request(">>> ", undefined, outcome);

      expect(run()).toEqual({ state: "resolved", value: outcome });
      expect(session.vt.screen()).toBe("out\n>>> pri");
      expect(session.lastStatus()).toBe("ready");
      // 세션이 살아 있어 다음 줄이 평소처럼 제출된다.
      session.fake.type("\r");
      await expect(second.promise).resolves.toBe("pri");
      session.handle.dispose();
    }
  });
});

describe("runSource 실행 중 키", () => {
  test("실행 중 Ctrl+C는 ^C를 에코하고 중단을 보내며 결말 interrupted로 끝난다", async () => {
    const session = startSession();
    const first = await openPrompt(session, "pri");
    const run = observe(session.handle.runSource("while True: pass"));
    await first.promise;
    expect(session.echoes()).toBe(0);

    session.fake.type("\x03");

    expect(session.echoes()).toBe(1);
    expect(session.slots().seq).toBe(1);
    const interrupted: ReadLineOutcome = {
      kind: "interrupted",
      traceback: "KeyboardInterrupt\n",
    };
    await session.request(">>> ", undefined, interrupted);
    expect(run()).toEqual({ state: "resolved", value: interrupted });
  });

  test("실행 중 input()은 stdin 읽기로 답을 받아 메일박스에 전달한다", async () => {
    const session = startSession();
    const first = await openPrompt(session, "pri");
    runQuietly(session, "print(input())");
    await first.promise;

    const before = session.flushCount();
    session.rpc.notify("readInput", true);
    await waitFor(() => session.flushCount() > before);
    await session.pump();
    session.fake.type("abc\r");
    await waitFor(() => session.mailboxText() === "abc");

    expect(session.mailboxText()).toBe("abc");
    expect(session.echoes()).toBe(0);
  });
});

describe("runSource 대기·생애 사건", () => {
  test("loading 중 호출은 슬롯을 차지하고 첫 >>> 요청에 { source }로 실행하며, 화면을 지우지 않는다", async () => {
    const session = startSession();
    const run = observe(session.handle.runSource("print(1)"));
    expect(session.handle.busy).toBe(true);
    await expect(session.handle.runSource("print(2)")).rejects.toMatchObject({
      reason: "busy",
    });
    expect(run().state).toBe("pending");

    await session.ready();
    const first = await session.request();
    await expect(first.promise).resolves.toEqual({ source: "print(1)" });
    // 읽기를 열지 않았으므로 프롬프트가 그려지지 않았고 지운 것도 없다.
    expect(session.vt.screen()).toBe("");
    expect(run().state).toBe("pending");

    await session.output("1\n");
    const second = await session.request(">>> ", undefined, OK);
    expect(run()).toEqual({ state: "resolved", value: OK });
    expect(session.vt.screen()).toBe("1\n>>>");
    void second;
    expect(session.handle.busy).toBe(false);
  });

  test("첫 요청 시점에 미종결 꼬리가 있으면 출력 앞에 줄을 바꾼다", async () => {
    const session = startSession();
    runQuietly(session, "print(1)");
    await session.ready();
    await session.output("t");
    const first = await session.request();
    await first.promise;
    await session.output("1\n");

    expect(session.vt.screen()).toBe("t\n1");
  });

  test("대기 중 reset()은 취소하지 않고 새 worker의 첫 >>> 에서 실행한다", async () => {
    const session = startSession();
    const run = observe(session.handle.runSource("print(1)"));

    session.handle.reset();

    expect(session.workers).toHaveLength(2);
    expect(run().state).toBe("pending");
    expect(session.handle.busy).toBe(true);
    await session.ready();
    const first = await session.request();
    await expect(first.promise).resolves.toEqual({ source: "print(1)" });
    await session.request(">>> ", undefined, OK);
    expect(run()).toEqual({ state: "resolved", value: OK });
  });

  test("대기 중 load-failed는 unavailable로 거부한다", async () => {
    const session = startSession();
    const run = session.handle.runSource("print(1)");
    const observed = observe(run);

    session.rpc.notify("loadFailed", "Error: boom");
    await waitFor(() => session.lastStatus() === "load-failed");
    await settle();

    expect(observed().state).toBe("rejected");
    await expect(run).rejects.toMatchObject({ reason: "unavailable" });
    expect(session.handle.busy).toBe(false);
  });

  test("실행 중 reset()은 restarted로 resolve하고 새 세션에서 다시 실행하지 않는다", async () => {
    const session = startSession();
    const first = await openPrompt(session, "pri");
    const run = session.handle.runSource("while True: pass");
    await first.promise;

    session.handle.reset();

    await expect(run).resolves.toEqual({ kind: "restarted" });
    expect(session.handle.busy).toBe(false);
    await session.ready();
    const next = await session.request();
    // 새 세션의 첫 요청은 평소 읽기다(코드를 다시 보내지 않는다).
    session.fake.type("z\r");
    await expect(next.promise).resolves.toBe("z");
  });

  test("실행 중 크래시는 crashed로 거부하고 크래시 콜백 안에서 busy는 거짓·runSource는 unavailable이다", async () => {
    const session = startSession();
    const first = await openPrompt(session, "pri");
    const run = session.handle.runSource("while True: pass");
    const observed = observe(run);
    await first.promise;
    const seen: { busy?: boolean; rejection?: unknown } = {};
    session.onStatus.mockImplementation((status: string) => {
      session.statuses.push(status);
      if (status !== "crashed") return;
      seen.busy = session.handle.busy;
      seen.rejection = session.handle.runSource("x").catch((error: unknown) => error);
    });

    session.worker.dispatchError("worker 죽음");

    await expect(run).rejects.toMatchObject({ reason: "crashed" });
    expect(observed().state).toBe("rejected");
    expect(seen.busy).toBe(false);
    await expect(seen.rejection).resolves.toMatchObject({ reason: "unavailable" });
  });

  test("크래시 콜백 안에서 reset()해도(자동 복구) 진행 중이던 실행은 restarted가 아니라 crashed로 끝난다", async () => {
    const session = startSession();
    const first = await openPrompt(session, "pri");
    const run = session.handle.runSource("while True: pass");
    const observed = observe(run);
    await first.promise;
    session.onStatus.mockImplementation((status: string) => {
      session.statuses.push(status);
      if (status === "crashed") session.handle.reset();
    });

    session.worker.dispatchError("worker 죽음");

    await expect(run).rejects.toMatchObject({ reason: "crashed" });
    expect(observed().state).toBe("rejected");
    // 자동 복구로 새 worker가 만들어졌다.
    expect(session.workers).toHaveLength(2);
  });

  test("대기 중 크래시도 crashed로 거부한다", async () => {
    const session = startSession();
    const run = session.handle.runSource("print(1)");

    session.worker.dispatchError("부팅 중 죽음");

    await expect(run).rejects.toMatchObject({ reason: "crashed" });
    expect(session.handle.busy).toBe(false);
  });

  test("실행 중 dispose는 disposed로 거부한다", async () => {
    const session = startSession();
    const first = await openPrompt(session, "pri");
    const run = session.handle.runSource("while True: pass");
    await first.promise;

    session.handle.dispose();

    await expect(run).rejects.toMatchObject({ reason: "disposed" });
  });

  test("대기 중 dispose는 disposed로 거부한다", async () => {
    const session = startSession();
    const run = session.handle.runSource("print(1)");

    session.handle.dispose();

    await expect(run).rejects.toMatchObject({ reason: "disposed" });
  });

  test("결말이 도착한 뒤 복원한 줄이 그려지기 전에 reset·dispose되면 이미 정해진 결말로 resolve한다", async () => {
    for (const event of ["reset", "dispose"] as const) {
      const session = startSession({ asyncWrite: true });
      const first = await openPrompt(session, "pri");
      const run = session.handle.runSource("print(1)");
      await first.promise;
      await session.output("1\n");
      await session.request(">>> ", undefined, OK, false);

      if (event === "reset") session.handle.reset();
      else session.handle.dispose();

      await expect(run).resolves.toEqual(OK);
      session.handle.dispose();
    }
  });

  test("RunRejectedError·RunResult는 core의 것을 그대로 다시 내보낸다", () => {
    expect(RunRejectedError).toBe(CoreRunRejectedError);
    const result: RunResult = { kind: "restarted" };
    expect(result.kind).toBe("restarted");
  });
});

/** 거부 표 한 행. `arrange`가 상태를 만든다. `reason`이 `busy`면 `busy` 게터가 참이다. */
interface RejectionRow {
  title: string;
  reason: "busy" | "unavailable" | "disposed";
  asyncWrite?: boolean;
  workerHandlers?: RpcHandlers;
  arrange(session: Session): Promise<void>;
}

const pendingComplete = () =>
  vi.fn(() => new Promise<SourceCompletion>(() => {}));

const rejectionRows: RejectionRow[] = [
  {
    title: "블록 입력 중(... 프롬프트)",
    reason: "busy",
    async arrange(session) {
      const first = await openPrompt(session);
      await submit(session, first, "if 1:");
      await session.request("... ", "if 1:");
    },
  },
  {
    title: "Python 실행 중(제출한 줄이 실행되는 동안)",
    reason: "busy",
    async arrange(session) {
      const first = await openPrompt(session);
      await submit(session, first, "while True: pass");
    },
  },
  {
    title: "input() 대기 중",
    reason: "busy",
    async arrange(session) {
      const first = await openPrompt(session);
      await submit(session, first, "input()");
      const before = session.flushCount();
      session.rpc.notify("readInput", true);
      await waitFor(() => session.flushCount() > before);
      await session.pump();
    },
  },
  {
    title: "프롬프트가 열린 채 배경 input() 대기 중",
    reason: "busy",
    async arrange(session) {
      await openPrompt(session, "pri");
      session.rpc.notify("readInput", true);
      await settle();
    },
  },
  {
    title: "다른 runSource 진행 중",
    reason: "busy",
    async arrange(session) {
      await openPrompt(session, "pri");
      runQuietly(session, "first");
      await settle();
    },
  },
  {
    title: "다른 runSource가 loading에서 대기 중",
    reason: "busy",
    async arrange(session) {
      runQuietly(session, "first");
    },
  },
  {
    title: "결말이 도착했지만 복원한 줄이 아직 그려지지 않은 구간",
    reason: "busy",
    asyncWrite: true,
    async arrange(session) {
      const first = await openPrompt(session, "pri");
      runQuietly(session, "first");
      await first.promise;
      await session.request(">>> ", undefined, OK, false);
    },
  },
  {
    title: "프롬프트 읽기가 열렸지만 아직 그려지지 않은 구간",
    reason: "busy",
    asyncWrite: true,
    async arrange(session) {
      await session.ready();
      await session.request(">>> ", undefined, undefined, false);
    },
  },
  {
    title: "Tab complete 왕복 중",
    reason: "busy",
    workerHandlers: { complete: pendingComplete() },
    async arrange(session) {
      await openPrompt(session, "pri");
      session.fake.type("\t");
      await settle();
    },
  },
  {
    title: "상태 not-isolated",
    reason: "unavailable",
    async arrange() {},
  },
  {
    title: "상태 load-failed",
    reason: "unavailable",
    async arrange(session) {
      session.rpc.notify("loadFailed", "Error: boom");
      await waitFor(() => session.lastStatus() === "load-failed");
    },
  },
  {
    title: "상태 crashed",
    reason: "unavailable",
    async arrange(session) {
      session.worker.dispatchError("죽음");
      await waitFor(() => session.lastStatus() === "crashed");
    },
  },
  {
    title: "상태 terminated(exit())",
    reason: "unavailable",
    async arrange(session) {
      await openPrompt(session);
      session.rpc.notify("sessionTerminated");
      await waitFor(() => session.lastStatus() === "terminated");
    },
  },
  {
    title: "dispose 뒤",
    reason: "disposed",
    async arrange(session) {
      await openPrompt(session, "pri");
      session.handle.dispose();
    },
  },
];

describe("runSource 거부 표와 busy 게터", () => {
  test.each(rejectionRows.map((row) => [row.title, row] as const))(
    "%s이면 거부하고 화면을 건드리지 않으며 busy 게터가 그 판정과 같다",
    async (title, row) => {
      if (title === "상태 not-isolated") vi.stubGlobal("crossOriginIsolated", false);
      const session = startSession({
        asyncWrite: row.asyncWrite,
        workerHandlers: row.workerHandlers,
      });
      await row.arrange(session);
      const screenBefore = session.vt.screen();
      const writtenBefore = session.fake.written.length;

      // 게터는 부작용이 없고 거부 판정과 같다(`busy` 사유일 때만 참).
      expect(session.handle.busy).toBe(row.reason === "busy");
      expect(session.handle.busy).toBe(row.reason === "busy");
      const run = session.handle.runSource("print(1)");

      await expect(run).rejects.toBeInstanceOf(RunRejectedError);
      await expect(run).rejects.toMatchObject({ reason: row.reason });
      expect(session.vt.screen()).toBe(screenBefore);
      expect(session.fake.written).toHaveLength(writtenBefore);
    },
  );

  test("코드가 문자열이 아니면 TypeError로 거부한다", async () => {
    const session = startSession();
    await openPrompt(session, "pri");
    const screenBefore = session.vt.screen();

    for (const value of [undefined, null, 1, {}, ["x"]]) {
      await expect(
        session.handle.runSource(value as unknown as string),
      ).rejects.toBeInstanceOf(TypeError);
    }

    expect(session.vt.screen()).toBe(screenBefore);
    expect(session.handle.busy).toBe(false);
  });

  test("프롬프트가 열려 있으면 busy 게터는 거짓이고 runSource는 받아들여진다", async () => {
    const session = startSession();
    const first = await openPrompt(session, "pri");

    expect(session.handle.busy).toBe(false);
    const run = observe(session.handle.runSource("print(1)"));

    await expect(first.promise).resolves.toEqual({ source: "print(1)" });
    expect(run().state).toBe("pending");
    expect(session.handle.busy).toBe(true);
  });

  test("Tab 왕복이 끝나면 다시 받아들인다", async () => {
    let finish: (value: SourceCompletion) => void = () => {};
    const complete = vi.fn(
      () =>
        new Promise<SourceCompletion>((resolve) => {
          finish = resolve;
        }),
    );
    const session = startSession({ workerHandlers: { complete } });
    const first = await openPrompt(session, "pri");
    session.fake.type("\t");
    await waitFor(() => complete.mock.calls.length > 0);
    expect(session.handle.busy).toBe(true);

    finish({ completions: [], start: 0 });
    await waitFor(() => !session.handle.busy);

    runQuietly(session, "print(1)");
    await expect(first.promise).resolves.toEqual({ source: "print(1)" });
  });
});

/**
 * xterm처럼 write를 차례로 처리한다: 하나씩 화면에 반영하고 그 콜백을 부른 뒤 macrotask를 넘긴다. xterm이 write 처리를 시간 예산
 * (12ms)에서 끊어 `setTimeout`으로 넘긴 경우다 — 콜백 사이에 마이크로태스크가 돌고, 콜백 안에서 낸 write는 큐 뒤에 선다. 돌려주는 함수는
 * 큐가 빌 때까지 처리한다.
 */
function serialWrites(session: Session): () => Promise<void> {
  const queue: { text: string; callback?: () => void }[] = [];
  const inner = session.fake.term.write;
  session.fake.term.write = ((text: string, callback?: () => void) => {
    queue.push({ text, callback });
  }) as typeof session.fake.term.write;
  return async () => {
    for (let entry = queue.shift(); entry !== undefined; entry = queue.shift()) {
      inner(entry.text, entry.callback);
      await tick();
    }
  };
}

describe("runSource 정착·정리 경계(사후 리뷰)", () => {
  test("실행 중 친 Enter로 복원한 줄이 그려지자마자 제출돼도 그 읽기에서 정착한다(write 처리가 끊겨도)", async () => {
    const session = startSession();
    const first = await openPrompt(session, "pri");
    const drain = serialWrites(session);
    const run = observe(runQuietly(session, "print(1)"));
    await expect(first.promise).resolves.toEqual({ source: "print(1)" });
    await drain();
    // 활성 읽기가 없으므로 type-ahead에 쌓였다가 복원한 읽기에서 재생돼 `pri`를 제출한다.
    session.fake.type("\r");
    session.rpc.notify("write", "1\n");
    await settle();
    await drain();

    const second = session.rpc.call<ReadLineReply>("readLine", ">>> ", undefined, true, OK);
    const secondState = observe(second);
    for (let round = 0; round < 3; round += 1) {
      await settle();
      await drain();
    }

    expect(secondState()).toEqual({ state: "resolved", value: "pri" });
    // 다음 읽기(제출된 `pri`가 끝난 뒤)를 기다리지 않는다.
    expect(run()).toEqual({ state: "resolved", value: OK });
  });

  test("정착하는 순간 복원한 >>> pri가 이미 화면에 반영돼 있다(write를 차례로 처리해도)", async () => {
    const session = startSession();
    const first = await openPrompt(session, "pri");
    const drain = serialWrites(session);
    const run = runQuietly(session, "print(1)");
    let screenAtSettle: string | undefined;
    void run.then(() => {
      screenAtSettle = session.vt.screen();
    });
    await first.promise;
    await drain();
    session.rpc.notify("write", "1\n");
    await settle();
    await drain();

    void session.rpc
      .call<ReadLineReply>("readLine", ">>> ", undefined, true, OK)
      .catch(() => {});
    for (let round = 0; round < 3; round += 1) {
      await settle();
      await drain();
    }

    expect(screenAtSettle).toBe("1\n>>> pri");
  });

  test("reset() 중 새 worker 생성이 던지면 reset()은 던지지 않고 crashed·onCrash로 넘기며 실행 중이던 runSource는 restarted로 끝난다", async () => {
    const session = startSession();
    const first = await openPrompt(session, "pri");
    const run = runQuietly(session, "while True: pass");
    await first.promise;
    const order: string[] = [];
    session.onStatus.mockImplementation((status: string) => {
      session.statuses.push(status);
      order.push(`status:${status}`);
    });
    session.onCrash.mockImplementation((message: string) => {
      order.push(`crash:${message}`);
    });
    session.createWorkerSpy.mockImplementationOnce(() => {
      throw new Error("worker 생성 실패");
    });

    expect(() => session.handle.reset()).not.toThrow();

    // runner `restart()`와 같다: `loading`을 거치지 않고 `crashed` 다음에 `onCrash`.
    expect(order).toEqual(["status:crashed", "crash:Error: worker 생성 실패"]);
    await expect(run).resolves.toEqual({ kind: "restarted" });
    expect(session.handle.busy).toBe(false);
    await expect(session.handle.runSource("print(1)")).rejects.toMatchObject({
      reason: "unavailable",
    });
  });

  test("대기 중 runSource는 reset() 중 worker 생성 실패에 crashed로 거부한다", async () => {
    const session = startSession();
    const run = session.handle.runSource("print(1)");
    session.createWorkerSpy.mockImplementationOnce(() => {
      throw new Error("worker 생성 실패");
    });

    session.handle.reset();

    await expect(run).rejects.toMatchObject({ reason: "crashed" });
    expect(session.handle.busy).toBe(false);
  });

  test("worker 생성 실패 뒤 reset()은 새 세션을 만들어 복구한다", async () => {
    const session = startSession();
    await session.ready();
    session.createWorkerSpy.mockImplementationOnce(() => {
      throw new Error("worker 생성 실패");
    });
    session.handle.reset();

    session.handle.reset();

    expect(session.createWorkerSpy).toHaveBeenCalledTimes(3);
    expect(session.workers).toHaveLength(2);
    expect(session.lastStatus()).toBe("loading");
    await session.ready();
    expect(session.lastStatus()).toBe("ready");
  });

  test("worker 생성 실패의 crashed 콜백 안에서 reset()하면 새 세션이 남고 onCrash는 한 번 불린다", () => {
    const session = startSession();
    session.onStatus.mockImplementation((status: string) => {
      session.statuses.push(status);
      if (status === "crashed") session.handle.reset();
    });
    session.createWorkerSpy.mockImplementationOnce(() => {
      throw new Error("worker 생성 실패");
    });

    session.handle.reset();

    expect(session.statuses.slice(-2)).toEqual(["crashed", "loading"]);
    expect(session.workers).toHaveLength(2);
    expect(session.onCrash).toHaveBeenCalledTimes(1);
    expect(session.handle.busy).toBe(false);
  });

  test("dispose() 정리 중 worker terminate가 던져도 실행 중이던 runSource는 disposed로 거부한다", async () => {
    const session = startSession();
    const first = await openPrompt(session, "pri");
    const run = runQuietly(session, "while True: pass");
    await first.promise;
    session.worker.terminate.mockImplementationOnce(() => {
      throw new Error("terminate 실패");
    });

    expect(() => session.handle.dispose()).toThrow("terminate 실패");

    await expect(run).rejects.toMatchObject({ reason: "disposed" });
  });
});
