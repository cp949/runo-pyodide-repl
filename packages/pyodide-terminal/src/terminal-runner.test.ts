/**
 * `createTerminalRunner` 시험(RD-022 DELTA-06). 실제 벤더 `Readline`·실제 sink·실제 선택 복사를 가짜 터미널
 * (`@repo/pyodide-testkit/fake-terminal`)에 붙이고, core `createRunner`만 가짜로 둔다. 가짜 core는 내부 팩토리
 * `createTerminalRunnerWith`로 주입한다(공개 옵션에는 시험 전용 필드가 없다).
 * 가짜 core는 실제 `createRunner`의 계약 중 실행창이 기대는 부분만 흉내낸다: 상태 알림, `run` 슬롯(`busy`),
 * `inputProvider(prompt, signal)` 호출과 signal abort(`interrupt`·`stop`·`reset`·`dispose`), 결과·거부 그대로 전달.
 * `run()` 시작 화면 준비 시험은 실제 core가 필요해 `terminal-runner-screen.test.ts`로 옮겼다(run-accepted-hook DELTA-03).
 * 실제 core와의 결합은 마지막 절이 비격리(jsdom은 `crossOriginIsolated`가 없다) 경로로 본다. 실제 pyodide 왕복은 브라우저 L1이 본다.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  RunRejectedError,
  type OutputChunk,
  type RunResult,
  type RunnerHandle,
  type RunnerOptions,
  type RunnerStatus,
  type StopResult,
} from "@cp949/runo-pyodide-core";
import {
  createFakeTerminal,
  type FakeTerminal,
  type FakeTerminalOptions,
} from "@repo/pyodide-testkit/fake-terminal";
import { VtScreen, attachVtScreen } from "@repo/pyodide-testkit/vt-screen";
import {
  createTerminalRunner,
  createTerminalRunnerWith,
  type TerminalRunnerOptions,
} from "./terminal-runner";

/** 매크로태스크 한 번. `rewindTail`의 await 사슬(마이크로태스크 여러 번)이 끝나기를 기다린다. */
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";

/** 가짜 core `RunnerHandle`과 시험이 사건을 일으키는 조작 손잡이. */
function createFakeCore(initial: RunnerStatus = "ready") {
  let options!: RunnerOptions;
  let status: RunnerStatus = initial;
  let activeRun:
    | { resolve(result: RunResult): void; reject(error: unknown): void }
    | undefined;
  let inputController: AbortController | undefined;
  let disposed = false;
  const calls = {
    run: [] as string[],
    stop: 0,
    interrupt: 0,
    reset: 0,
    dispose: 0,
  };

  const setStatus = (next: RunnerStatus) => {
    status = next;
    options.onStatus?.(next);
  };
  const abortInput = () => inputController?.abort();

  const handle: RunnerHandle = {
    run(code) {
      calls.run.push(code);
      return new Promise<RunResult>((resolve, reject) => {
        if (disposed) {
          reject(new RunRejectedError("disposed"));
          return;
        }
        if (
          status === "not-isolated" ||
          status === "load-failed" ||
          status === "crashed"
        ) {
          reject(new RunRejectedError("unavailable"));
          return;
        }
        if (activeRun || status === "waiting-input") {
          reject(new RunRejectedError("busy"));
          return;
        }
        activeRun = { resolve, reject };
        // 실제 core처럼 슬롯을 잡은 뒤·보내기 앞에서 수락을 알린다(자체 거부 분기 뒤라 거부된 run에는 불리지 않는다).
        options.onRunAccepted?.();
        if (status === "ready") setStatus("running");
      });
    },
    stop() {
      calls.stop += 1;
      abortInput();
      return Promise.resolve<StopResult>("stopped");
    },
    interrupt() {
      calls.interrupt += 1;
      abortInput();
    },
    reset() {
      calls.reset += 1;
      abortInput();
      // 실제 core처럼 보낸 run만 restarted로 끝내고, 로딩·재시작 대기 run은 슬롯에 남겨 새 worker의 ready에서 보낸다.
      const wasSent = status === "running" || status === "waiting-input";
      const run = wasSent ? activeRun : undefined;
      if (wasSent) activeRun = undefined;
      if (status !== "not-isolated") setStatus("restarting");
      run?.resolve({ kind: "restarted" });
    },
    dispose() {
      calls.dispose += 1;
      disposed = true;
      abortInput();
      const run = activeRun;
      activeRun = undefined;
      run?.reject(new RunRejectedError("disposed"));
    },
    get status() {
      return status;
    },
    get busy() {
      return activeRun !== undefined || status === "waiting-input";
    },
  };

  return {
    handle,
    calls,
    /** `createTerminalRunnerWith`에 넘기는 core 팩토리. 옵션을 붙잡고, 첫 상태를 동기로 알린다(실제 core와 같다). */
    factory: (given: RunnerOptions): RunnerHandle => {
      options = given;
      if (initial === "not-isolated" || initial === "loading") {
        given.onStatus?.(initial);
      }
      return handle;
    },
    /** terminal이 core에 넘긴 옵션. */
    get options() {
      return options;
    },
    setStatus,
    /** worker가 준비됐다: 실제 core처럼 `ready`를 알린 뒤(콜백 안의 재호출 포함) 대기 run이 있으면 보낸다(`running`). */
    becomeReady() {
      setStatus("ready");
      if (status === "ready" && activeRun) setStatus("running");
    },
    /** 실행 중인 run을 끝낸다. */
    finishRun(result: RunResult = { kind: "ok" }) {
      const run = activeRun;
      activeRun = undefined;
      run?.resolve(result);
      if (status === "running" || status === "waiting-input")
        setStatus("ready");
    },
    /** Python이 `input()`을 부른 상황: core가 provider를 부르고 상태를 `waiting-input`으로 바꾼다. */
    requestInput(prompt = ""): {
      result: Promise<string | null>;
      controller: AbortController;
    } {
      if (!options.inputProvider) throw new Error("inputProvider가 없다");
      const controller = new AbortController();
      inputController = controller;
      setStatus("waiting-input");
      const result = options.inputProvider(prompt, controller.signal);
      void result.finally(() => {
        if (inputController === controller) inputController = undefined;
        if (status === "waiting-input")
          setStatus(activeRun ? "running" : "ready");
      });
      return { result, controller };
    },
    /** stdout·stderr 조각이 도착했다. */
    output(chunk: OutputChunk) {
      options.onOutput(chunk);
    },
  };
}

type FakeCore = ReturnType<typeof createFakeCore>;

interface SetupOptions {
  terminal?: FakeTerminalOptions;
  /** 미리 만든 가짜 터미널. `terminal` 옵션 대신 쓴다(옵션 콜백이 터미널을 봐야 할 때). */
  fake?: FakeTerminal;
  initial?: RunnerStatus;
  runner?: Partial<TerminalRunnerOptions>;
}

/** 실제 `Readline`·sink·선택 복사 + 가짜 core로 실행창을 만든다. */
function setup(setupOptions: SetupOptions = {}) {
  const fake: FakeTerminal =
    setupOptions.fake ?? createFakeTerminal(setupOptions.terminal);
  const core: FakeCore = createFakeCore(setupOptions.initial ?? "ready");
  const statuses: RunnerStatus[] = [];
  const handle = createTerminalRunnerWith(
    {
      terminal: fake.term,
      createWorker: () => {
        throw new Error("가짜 core는 worker를 만들지 않는다");
      },
      onStatus: (status) => statuses.push(status),
      ...setupOptions.runner,
    },
    core.factory,
  );
  /** 화면에 쓰인 원문 전체. */
  const screen = () => fake.written.join("");
  /** `input()` 요청을 시작하고 읽기가 그려질 때까지 기다린다. 읽기 Promise는 객체에 담아 돌려준다(pending-traps/09). */
  const startInput = async (prompt = "") => {
    const request = core.requestInput(prompt);
    await tick();
    return request;
  };
  return { fake, core, handle, statuses, screen, startInput };
}

/** `navigator.clipboard.writeText` 대역. jsdom에는 클립보드가 없다. */
function stubClipboard() {
  const writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
  return writeText;
}

afterEach(() => {
  Reflect.deleteProperty(navigator, "clipboard");
  localStorage.clear();
});

describe("키 정책: 읽기 밖 입력은 무시한다(typeAhead: false)", () => {
  test("running 중 친 문자는 화면에 나타나지 않고 다음 input() 읽기에도 들어가지 않는다", async () => {
    const { fake, core, handle, screen, startInput } = setup();
    void handle.run("code");
    expect(handle.status).toBe("running");

    fake.type("abc");
    expect(screen()).not.toContain("abc");

    const { result } = await startInput();
    fake.type("\r");
    await expect(result).resolves.toBe("");
    core.finishRun();
  });

  test("running 중 붙여넣기(다중 문자·개행 포함)도 버려진다", async () => {
    const { fake, core, handle, screen, startInput } = setup();
    void handle.run("code");

    fake.paste("hello\nworld");
    expect(screen()).not.toContain("hello");

    const { result } = await startInput();
    fake.type("\r");
    await expect(result).resolves.toBe("");
    core.finishRun();
  });

  test("ready에서 친 문자도 버려진다", async () => {
    const { fake, core, screen, startInput } = setup();

    fake.type("abc");
    fake.paste("xyz");
    expect(screen()).toBe("");

    core.setStatus("running");
    const { result } = await startInput();
    fake.type("\r");
    await expect(result).resolves.toBe("");
  });

  test("waiting-input 중에는 한 줄을 편집하고 Enter로 전달한다", async () => {
    const { fake, screen, startInput } = setup();
    const { result } = await startInput("이름: ");

    fake.type("ab");
    fake.type("\x7f"); // Backspace
    fake.type("c\r");

    await expect(result).resolves.toBe("ac");
    // 프롬프트(직전 출력 꼬리가 아니라 core가 넘긴 prompt 인자는 무시하고 자체 꼬리를 쓴다)와 입력이 화면에 그려졌다.
    expect(screen()).toContain("ac");
  });

  test("Enter로 제출한 입력줄은 history에 남지 않아 다음 읽기에서 ↑로 되살아나지 않는다", async () => {
    const { fake, startInput } = setup();
    const first = await startInput();
    fake.type("first\r");
    await first.result;
    await tick();

    const second = await startInput();
    fake.type("\x1b[A"); // ↑
    fake.type("\r");

    await expect(second.result).resolves.toBe("");
  });

  test("history를 localStorage에 저장하지 않는다(persist: false)", async () => {
    const { fake, startInput } = setup();
    const { result } = await startInput();

    fake.type("secret\r");
    await result;

    expect(localStorage.getItem("history")).toBeNull();
  });
});

describe("Ctrl+C: 상태별 분기 4종", () => {
  test("선택이 있으면 복사하고 선택을 지우며 실행은 중단하지 않는다", async () => {
    const writeText = stubClipboard();
    const onCopy = vi.fn();
    const { fake, core, handle, screen } = setup({ runner: { onCopy } });
    void handle.run("code");
    fake.select("복사할 글");

    const passedToXterm = fake.keyDown({ key: "c", ctrlKey: true });
    await tick();

    expect(passedToXterm).toBe(false);
    expect(writeText).toHaveBeenCalledWith("복사할 글");
    expect(onCopy).toHaveBeenCalledWith({ ok: true, chars: 5 });
    expect(fake.clearSelectionCalls).toBe(1);
    expect(core.calls.interrupt).toBe(0);
    expect(screen()).not.toContain("^C");
  });

  test("running이면 ^C를 표시하고 interrupt를 보낸다", async () => {
    const { fake, core, handle, screen } = setup();
    void handle.run("code");
    expect(handle.status).toBe("running");

    fake.type("\x03");

    expect(screen()).toContain("^C");
    expect(core.calls.interrupt).toBe(1);
  });

  test("running 중 ^C 표시는 꼬리에 남아 다음 input() 프롬프트에 이어 그려진다", async () => {
    const { fake, core, handle, startInput } = setup();
    void handle.run("code");
    core.output({ stream: "stdout", text: "t" });
    fake.type("\x03");

    const { result } = await startInput();
    fake.type("x\r");

    await expect(result).resolves.toBe("x");
    // `t^C`가 프롬프트다(tty 로컬 에코 흉내, REPL과 같다).
    expect(fake.written.join("")).toContain("t^Cx");
  });

  test("waiting-input이고 읽기가 열려 있으면 벤더가 읽기를 취소하고 interrupt는 따로 보내지 않는다", async () => {
    const { fake, core, screen, startInput } = setup();
    const { result } = await startInput("x: ");
    expect(core.handle.status).toBe("waiting-input");

    fake.type("ab");
    fake.type("\x03");

    await expect(result).resolves.toBeNull();
    expect(core.calls.interrupt).toBe(0);
    expect(screen()).not.toContain("^C");
  });

  test("waiting-input이지만 읽기가 아직 그려지기 전이면 runner.interrupt로 읽기를 취소한다", async () => {
    const { fake, core } = setup({ terminal: { asyncWrite: true } });
    // write 콜백이 오기 전이라 벤더에 활성 읽기가 없다. 이 구간의 Ctrl+C는 핸들러로 온다.
    const { result } = core.requestInput("x: ");
    await tick();
    expect(core.handle.status).toBe("waiting-input");

    fake.type("\x03");

    expect(core.calls.interrupt).toBe(1);
    await expect(result).resolves.toBeNull();
    fake.flush();
  });

  test("inputProvider를 직접 준 waiting-input에서도 Ctrl+C는 runner.interrupt로 읽기를 취소한다", async () => {
    let seenSignal: AbortSignal | undefined;
    const inputProvider = vi.fn((_prompt: string, signal: AbortSignal) => {
      seenSignal = signal;
      return new Promise<string | null>(() => {});
    });
    const { fake, core } = setup({ runner: { inputProvider } });
    core.requestInput("x: ");

    fake.type("\x03");

    expect(core.calls.interrupt).toBe(1);
    expect(seenSignal?.aborted).toBe(true);
  });

  test("ready에서는 아무 일도 하지 않는다(^C 표시 없음·interrupt 없음)", () => {
    const { fake, core, screen } = setup();

    fake.type("\x03");

    expect(core.handle.status).toBe("ready");
    expect(core.calls.interrupt).toBe(0);
    expect(screen()).toBe("");
  });

  test("loading·restarting·crashed 같은 그 밖의 상태에서도 무동작이다", () => {
    const { fake, core, screen } = setup();
    for (const status of ["loading", "restarting", "crashed"] as const) {
      core.setStatus(status);
      fake.type("\x03");
    }

    expect(core.calls.interrupt).toBe(0);
    expect(screen()).toBe("");
  });
});

describe("clear()", () => {
  test("화면을 지우는 시퀀스를 쓴다", () => {
    const { handle, screen } = setup();

    handle.clear();

    expect(screen()).toContain("\x1b[2J");
  });

  test("sink 꼬리를 비워 지운 뒤 input() 프롬프트가 지워진 출력을 되살리지 않는다", async () => {
    const { fake, core, handle, startInput } = setup();
    core.output({ stream: "stdout", text: "abc" });
    handle.clear();
    const before = fake.written.length;

    await startInput();

    expect(fake.written.slice(before).join("")).not.toContain("abc");
  });

  test("입력을 기다리는 중(읽기가 열린 동안)에는 아무것도 하지 않는다", async () => {
    const { fake, handle, startInput } = setup();
    await startInput("x: ");
    const before = fake.written.length;

    handle.clear();

    expect(fake.written).toHaveLength(before);
  });
});

describe("출력 연결", () => {
  test("stdout은 그대로, stderr는 빨강으로 화면에 쓰고 onOutput에도 알린다", () => {
    const onOutput = vi.fn();
    const { core, screen } = setup({ runner: { onOutput } });

    core.output({ stream: "stdout", text: "out" });
    core.output({ stream: "stderr", text: "err" });

    expect(screen()).toBe(`out${RED}err${RESET}`);
    expect(onOutput).toHaveBeenNthCalledWith(1, {
      stream: "stdout",
      text: "out",
    });
    expect(onOutput).toHaveBeenNthCalledWith(2, {
      stream: "stderr",
      text: "err",
    });
  });

  test("input()의 프롬프트는 직전 출력의 꼬리로 그려진다", async () => {
    const { fake, core, startInput } = setup();
    core.output({ stream: "stdout", text: "이름: " });
    const { result } = await startInput("이름: ");

    fake.type("홍\r");

    await expect(result).resolves.toBe("홍");
    // Enter 때 프롬프트와 입력이 한 조각으로 다시 그려진다.
    expect(fake.written).toContain("이름: 홍");
  });

  test("pyodide 로드 실패 메시지를 빨강 한 줄로 낸다", () => {
    const { core, screen } = setup();

    core.options.onLoadFailed?.("네트워크 오류");

    expect(screen()).toBe(`${RED}pyodide 로드 실패: 네트워크 오류${RESET}\r\n`);
  });
});

describe("input() 대기 중 배경 출력(RD-022b)", () => {
  /** 화면을 `VtScreen`으로 해석하는 가짜 터미널로 실행창을 만들고 실행 중 `input("x: ")` 읽기에 `ab`를 친 상태로 둔다. */
  async function setupWaitingInput() {
    const fake = createFakeTerminal();
    const vt = new VtScreen(80, 24);
    attachVtScreen(fake, vt);
    const context = setup({ fake });
    void context.handle.run("code");
    context.core.output({ stream: "stdout", text: "x: " });
    const request = await context.startInput("x: ");
    fake.type("ab");
    return { ...context, vt, request };
  }

  test("stdout 행은 입력줄 위에 쓰이고 프롬프트·입력은 그 아래에 다시 그려지며 Enter 값은 그대로다", async () => {
    const { fake, core, vt, request } = await setupWaitingInput();
    expect(vt.screen()).toBe("x: ab");

    core.output({ stream: "stdout", text: "tick\n" });
    expect(vt.screen()).toBe("tick\nx: ab");

    fake.type("c\r");
    await expect(request.result).resolves.toBe("abc");
    expect(vt.lines()).toEqual(["tick", "x: abc"]);
    core.finishRun();
  });

  test("stderr 행도 같은 경로로 입력줄 위에 쓰이고 onOutput에는 조각 그대로 알린다", async () => {
    const onOutput = vi.fn();
    const fake = createFakeTerminal();
    const vt = new VtScreen(80, 24);
    attachVtScreen(fake, vt);
    const { core, handle, startInput } = setup({ fake, runner: { onOutput } });
    void handle.run("code");
    core.output({ stream: "stdout", text: "x: " });
    const { result } = await startInput("x: ");
    fake.type("ab");

    core.output({ stream: "stderr", text: "warn\n" });

    expect(vt.screen()).toBe("warn\nx: ab");
    expect(onOutput).toHaveBeenLastCalledWith({
      stream: "stderr",
      text: "warn\n",
    });
    fake.type("\r");
    await expect(result).resolves.toBe("ab");
    core.finishRun();
  });

  test("개행 없는 조각은 프롬프트 앞 접두가 되고 Enter 뒤 다음 input() 프롬프트에 섞이지 않는다", async () => {
    const { fake, core, vt, request, startInput } = await setupWaitingInput();

    core.output({ stream: "stdout", text: "tick" });
    expect(vt.screen()).toBe("tickx: ab");

    fake.type("\r");
    await expect(request.result).resolves.toBe("ab");
    core.output({ stream: "stdout", text: "y: " });
    const second = await startInput("y: ");
    // `lines()`는 행 끝 공백을 자른다. 다음 프롬프트는 `y: `뿐이다(`tick`은 꼬리에 들어가지 않았다).
    expect(vt.lines()).toEqual(["tickx: ab", "y:"]);
    fake.type("\r");
    await expect(second.result).resolves.toBe("");
    core.finishRun();
  });
});

describe("상태·크래시 전달", () => {
  test("core 상태 알림을 onStatus로 그대로 전달하고 status 게터는 core 상태를 읽는다", () => {
    const { core, handle, statuses } = setup();

    core.setStatus("running");
    core.setStatus("waiting-input");
    core.setStatus("ready");

    expect(statuses).toEqual(["running", "waiting-input", "ready"]);
    expect(handle.status).toBe("ready");
  });

  test("onCrash와 crashed 상태를 그대로 전달한다", () => {
    const onCrash = vi.fn();
    const { core, handle, statuses } = setup({ runner: { onCrash } });
    core.options.onCrash?.("worker 죽음");
    core.setStatus("crashed");

    expect(onCrash).toHaveBeenCalledWith("worker 죽음");
    expect(statuses).toContain("crashed");
    expect(handle.status).toBe("crashed");
  });

  test("core에 넘기는 옵션(filename·topLevelAwait·pyodide·createWorker)을 그대로 전달한다", () => {
    const createWorker = vi.fn(() => ({}) as Worker);
    const { core } = setup({
      runner: {
        createWorker,
        filename: "app.py",
        topLevelAwait: true,
        pyodide: { indexURL: "https://example.test/pyodide/" },
      },
    });

    expect(core.options.createWorker).toBe(createWorker);
    expect(core.options.filename).toBe("app.py");
    expect(core.options.topLevelAwait).toBe(true);
    expect(core.options.pyodide).toEqual({
      indexURL: "https://example.test/pyodide/",
    });
  });

  test("stop·reset은 core로 넘기고 결과를 그대로 돌려준다", async () => {
    const { core, handle } = setup();

    await expect(handle.stop()).resolves.toBe("stopped");
    handle.reset();

    expect(core.calls.stop).toBe(1);
    expect(core.calls.reset).toBe(1);
  });
});

describe("inputProvider 옵션", () => {
  test("주면 core에 그대로 넘기고 xterm 읽기는 열지 않는다", async () => {
    const inputProvider = vi.fn(() => new Promise<string | null>(() => {}));
    const { fake, core, screen } = setup({ runner: { inputProvider } });
    expect(core.options.inputProvider).toBe(inputProvider);

    core.requestInput("x: ");
    await tick();
    fake.type("abc\r");

    expect(inputProvider).toHaveBeenCalledWith("x: ", expect.any(AbortSignal));
    // 읽기가 없으므로 아무것도 그려지지 않고 입력은 버려진다.
    expect(screen()).toBe("");
  });

  test("주지 않으면 기본 provider(xterm 읽기)를 core에 넘긴다", () => {
    const { core } = setup();

    expect(typeof core.options.inputProvider).toBe("function");
  });
});

describe("입력 읽기의 signal abort", () => {
  test("abort되면 진행 중 읽기를 cancelRead로 끝내고 null을 돌려주며 입력줄 뒤에 줄바꿈을 낸다", async () => {
    const { fake, startInput } = setup();
    const { result, controller } = await startInput("x: ");
    fake.type("ab");
    const before = fake.written.length;

    controller.abort();

    await expect(result).resolves.toBeNull();
    // 벤더 settle은 입력줄을 강조 없이 다시 그린 뒤 개행한다(재그리기 조각은 단언하지 않는다).
    const after = fake.written.slice(before);
    expect(after.filter((text) => text === "\r\n")).toHaveLength(1);
    expect(after.at(-1)).toBe("\r\n");
  });

  // 이슈 13: 재그리기 콜백 전 abort하면 벤더가 화면에 아무것도 쓰지 않아 아직 그리지 않은 접두가 사라진다. 호출자가 복원한다.
  describe("재그리기 대기 중 abort의 접두 복원(이슈 13)", () => {
    /** `x: ab`가 그려진 입력 읽기를 열고, 배경 출력 `tick`(개행 없음)의 재그리기 write 콜백은 배출하지 않은 채 둔다. */
    const openWithPendingPrefix = async () => {
      const fake = createFakeTerminal({ asyncWrite: true });
      const vt = new VtScreen(80, 24);
      attachVtScreen(fake, vt);
      const context = setup({ fake });
      void context.handle.run("code");
      context.core.output({ stream: "stdout", text: "x: " });
      const request = context.core.requestInput("x: ");
      for (let round = 0; round < 3; round += 1) {
        await tick();
        fake.flush();
      }
      fake.type("ab");
      fake.flush();
      expect(vt.screen()).toBe("x: ab");
      return { ...context, vt, request };
    };

    test("아직 그리지 않은 접두 tick이 화면에 남고 뒤이은 트레이스백이 같은 행에 붙지 않는다", async () => {
      const { fake, core, vt, request } = await openWithPendingPrefix();
      core.output({ stream: "stdout", text: "tick" });
      // 입력줄은 지워졌고 접두는 재그리기 콜백을 기다린다.
      expect(vt.screen()).toBe("");

      request.controller.abort();
      await expect(request.result).resolves.toBeNull();
      core.output({ stream: "stderr", text: "Traceback\n" });
      fake.flush();
      await tick();
      fake.flush();

      expect(vt.lines()).toEqual(["tick", "Traceback"]);
      core.finishRun();
    });

    test("대조: 재그리기가 끝난 뒤 abort하면 접두가 이미 그려진 행에 있고 다시 쓰지 않는다", async () => {
      const { fake, core, vt, request } = await openWithPendingPrefix();
      core.output({ stream: "stdout", text: "tick" });
      fake.flush();
      expect(vt.screen()).toBe("tickx: ab");

      request.controller.abort();
      await expect(request.result).resolves.toBeNull();
      core.output({ stream: "stderr", text: "Traceback\n" });
      fake.flush();

      expect(vt.lines()).toEqual(["tickx: ab", "Traceback"]);
      core.finishRun();
    });
  });

  // 커서가 감긴 입력의 중간 행에 있을 때 abort하면 뒤 출력이 입력 마지막 행 위에 겹치던 결함(readline-read-end DELTA-03).
  describe("abort 뒤 출력 위치: 벤더 settle·그리기 전 대체 개행", () => {
    const THIRTY = "abcdefghijklmnopqrstuvwxyz0123";
    const HOME = "\x1b[H";

    /** 열 20 화면에서 `x: ` 읽기에 30자를 쳐 두 행으로 감긴 입력을 만든다. */
    const openWrappedInput = async () => {
      const fake = createFakeTerminal({ asyncWrite: true, cols: 20, rows: 10 });
      const vt = new VtScreen(20, 10);
      attachVtScreen(fake, vt);
      const context = setup({ fake });
      void context.handle.run("code");
      context.core.output({ stream: "stdout", text: "x: " });
      const request = context.core.requestInput("x: ");
      for (let round = 0; round < 3; round += 1) {
        await tick();
        fake.flush();
      }
      fake.type(THIRTY);
      fake.flush();
      expect(vt.lines()).toEqual(["x: abcdefghijklmnopq", "rstuvwxyz0123"]);
      return { ...context, vt, request };
    };

    /** stop으로 읽기를 끊고 트레이스백 한 줄을 낸 뒤 화면을 배출한다. */
    const stopAndPrintTraceback = async (
      context: Awaited<ReturnType<typeof openWrappedInput>>,
    ) => {
      await context.handle.stop();
      await expect(context.request.result).resolves.toBeNull();
      context.core.output({ stream: "stderr", text: "Traceback\n" });
      for (let round = 0; round < 3; round += 1) {
        context.fake.flush();
        await tick();
      }
    };

    test("커서가 첫 행에 있어도 입력 두 행이 온전히 남고 트레이스백은 그 아래 행에 쓰인다", async () => {
      const context = await openWrappedInput();
      context.fake.type(HOME);
      context.fake.flush();
      expect(context.vt.cursor()[0]).toBe(0);

      await stopAndPrintTraceback(context);

      expect(context.vt.lines()).toEqual([
        "x: abcdefghijklmnopq",
        "rstuvwxyz0123",
        "Traceback",
      ]);
      context.core.finishRun();
    });

    test("읽기가 그려지기 전(write 콜백 대기) abort면 꼬리 뒤에 개행해 트레이스백이 꼬리 행에 붙지 않는다", async () => {
      const fake = createFakeTerminal({ asyncWrite: true });
      const vt = new VtScreen(80, 24);
      attachVtScreen(fake, vt);
      const { core, handle } = setup({ fake });
      void handle.run("code");
      core.output({ stream: "stdout", text: "x: " });
      const request = core.requestInput("x: ");
      // 짧은 꼬리는 flush를 기다리지 않으므로 몇 틱 뒤 읽기는 write 콜백만 기다린다(배출하지 않는다).
      await tick();
      await tick();

      await handle.stop();
      await expect(request.result).resolves.toBeNull();
      core.output({ stream: "stderr", text: "Traceback\n" });
      for (let round = 0; round < 3; round += 1) {
        fake.flush();
        await tick();
      }

      expect(vt.lines()).toEqual(["x:", "Traceback"]);
      core.finishRun();
    });

    test("대조: 커서가 입력 끝이면 입력 두 행 아래에 트레이스백이 쓰인다", async () => {
      const context = await openWrappedInput();

      await stopAndPrintTraceback(context);

      expect(context.vt.lines()).toEqual([
        "x: abcdefghijklmnopq",
        "rstuvwxyz0123",
        "Traceback",
      ]);
      context.core.finishRun();
    });
  });

  test("abort 뒤 친 키는 죽은 읽기에 들어가지 않고, 다음 읽기는 그 키를 받지 않는다", async () => {
    const { fake, startInput } = setup();
    const first = await startInput();
    first.controller.abort();
    await first.result;

    fake.type("zz\r");
    const second = await startInput();
    fake.type("y\r");

    await expect(second.result).resolves.toBe("y");
  });

  test("이미 abort된 signal로 불리면 읽기를 열지 않고 null을 돌려준다", async () => {
    const { fake, core } = setup();
    const controller = new AbortController();
    controller.abort();
    const before = fake.written.length;

    const result = await core.options.inputProvider!("x: ", controller.signal);

    expect(result).toBeNull();
    expect(fake.written).toHaveLength(before);
  });

  test("읽기가 정상으로 끝난 뒤의 abort는 줄바꿈을 더 쓰지 않는다(리스너 제거)", async () => {
    const { fake, startInput } = setup();
    const { result, controller } = await startInput();
    fake.type("a\r");
    await result;
    const before = fake.written.length;

    controller.abort();

    expect(fake.written).toHaveLength(before);
  });

  test("긴 꼬리를 정리(flush 대기)하는 사이 abort되면 읽기를 열지 않아 이어 친 키가 죽은 읽기에 들어가지 않는다", async () => {
    const { fake, core } = setup({ terminal: { asyncWrite: true } });
    // 꼬리가 폭의 절반 이상이면 `rewindTail`이 write 콜백(flush)을 기다린다.
    core.output({ stream: "stdout", text: "x".repeat(50) });
    const { result, controller } = core.requestInput("x: ");
    await tick();

    controller.abort();
    fake.flush();
    await tick();
    fake.flush();
    await expect(result).resolves.toBeNull();
    const before = fake.written.length;
    fake.type("q\r");

    // 읽기가 열리지 않았으므로 키는 버려지고 아무것도 그려지지 않는다.
    expect(fake.written).toHaveLength(before);
  });

  test("dispose 뒤 도착한 flush 콜백은 해제된 터미널의 buffer를 읽지 않는다(TRP-004)", async () => {
    const { fake, core, handle } = setup({ terminal: { asyncWrite: true } });
    core.output({ stream: "stdout", text: "x".repeat(50) });
    core.requestInput("x: ");
    await tick();

    handle.dispose();
    fake.term.dispose();
    fake.flush();
    await tick();

    expect(fake.disposedBufferReads).toBe(0);
  });

  test("Ctrl+C로 사용자가 취소한 읽기는 줄바꿈을 한 번만 쓴다(벤더가 쓴 것)", async () => {
    const { fake, startInput } = setup();
    const { result } = await startInput();
    const before = fake.written.length;

    fake.type("\x03");

    await expect(result).resolves.toBeNull();
    expect(
      fake.written.slice(before).filter((text) => text === "\r\n"),
    ).toHaveLength(1);
  });
});

describe("비격리", () => {
  let precondition: boolean;
  beforeEach(() => {
    precondition = globalThis.crossOriginIsolated !== true;
  });

  test("가짜 core가 not-isolated를 알리면 경고 안내를 노랑 한 줄로 낸 뒤 onStatus로 알린다", () => {
    const fake = createFakeTerminal();
    let writtenAtStatus = -1;
    const statuses: RunnerStatus[] = [];
    setup({
      fake,
      initial: "not-isolated",
      runner: {
        onStatus: (status) => {
          statuses.push(status);
          writtenAtStatus = fake.written.length;
        },
      },
    });

    expect(fake.written).toHaveLength(1);
    expect(fake.written[0]).toContain(YELLOW);
    expect(fake.written[0]).toContain("cross-origin isolation");
    expect(fake.written[0]?.endsWith(`${RESET}\r\n`)).toBe(true);
    expect(statuses).toEqual(["not-isolated"]);
    // 안내가 상태 알림보다 먼저다(알림 시점에 이미 안내가 쓰여 있다).
    expect(writtenAtStatus).toBe(1);
  });

  test("실제 core createRunner는 jsdom(비격리)에서 worker 없이 not-isolated가 되고 run은 unavailable로 거부된다", async () => {
    expect(precondition).toBe(true);
    const fake = createFakeTerminal();
    const createWorker = vi.fn(() => {
      throw new Error("worker를 만들면 안 된다");
    });
    const onStatus = vi.fn();
    const handle = createTerminalRunner({
      terminal: fake.term,
      createWorker,
      onStatus,
    });

    expect(handle.status).toBe("not-isolated");
    expect(onStatus).toHaveBeenCalledWith("not-isolated");
    expect(fake.written.join("")).toContain("cross-origin isolation");
    const before = fake.written.length;
    await expect(handle.run("1")).rejects.toBeInstanceOf(RunRejectedError);
    await expect(handle.run("1")).rejects.toMatchObject({
      reason: "unavailable",
    });
    expect(fake.written).toHaveLength(before);
    expect(createWorker).not.toHaveBeenCalled();
    handle.dispose();
  });

  test("옵션이 틀려 core가 던지면 붙인 Readline·선택 복사를 정리하고 그대로 던진다", () => {
    const fake = createFakeTerminal({ withElement: true });
    const removeSpy = vi.spyOn(fake.term.element!, "removeEventListener");

    expect(() =>
      createTerminalRunner({
        terminal: fake.term,
        createWorker: () => ({}) as Worker,
        filename: "",
      }),
    ).toThrow();

    expect(removeSpy).toHaveBeenCalledWith("mousedown", expect.any(Function));
    // Readline이 떼어졌으므로 입력이 와도 아무 일도 없다.
    fake.type("abc");
    expect(fake.written).toEqual([]);
  });
});

describe("dispose()", () => {
  test("runner를 dispose하고 Readline을 떼되 Terminal은 dispose하지 않는다", () => {
    const { fake, core, handle } = setup();
    const terminalDispose = vi.spyOn(fake.term, "dispose");

    handle.dispose();

    expect(core.calls.dispose).toBe(1);
    expect(terminalDispose).not.toHaveBeenCalled();
    // Readline이 떼어져 있어 키·붙여넣기가 무시된다(핸들러 없음). Ctrl+C도 핸들러를 부르지 않는다.
    core.setStatus("running");
    fake.type("\x03");
    expect(core.calls.interrupt).toBe(0);
    // 파괴되지 않은 터미널은 계속 쓸 수 있다.
    expect(() => fake.term.write("still alive")).not.toThrow();
  });

  test("두 번 불러도 안전하다", () => {
    const { core, handle } = setup();

    handle.dispose();
    handle.dispose();

    expect(core.calls.dispose).toBe(1);
  });

  test("열린 읽기는 null로 끝나고 화면에 줄바꿈을 더 쓰지 않는다", async () => {
    const { fake, handle, startInput } = setup();
    const { result } = await startInput("x: ");
    const before = fake.written.length;

    handle.dispose();

    await expect(result).resolves.toBeNull();
    expect(fake.written).toHaveLength(before);
  });

  test("dispose 뒤 run은 disposed로 거부되고 화면을 건드리지 않는다", async () => {
    const { fake, handle } = setup({ runner: { clearOnRun: true } });
    handle.dispose();
    fake.screen.cursorX = 3;

    await expect(handle.run("x")).rejects.toMatchObject({ reason: "disposed" });

    expect(fake.written).toEqual([]);
  });

  test("dispose 뒤 run은 해제된 터미널의 buffer를 읽지 않는다", async () => {
    const { fake, handle } = setup();
    handle.dispose();
    fake.term.dispose();

    await expect(handle.run("x")).rejects.toMatchObject({ reason: "disposed" });

    expect(fake.disposedBufferReads).toBe(0);
  });

  test("dispose 뒤 clear·setCopyOnSelect는 아무 일도 하지 않는다", () => {
    const { fake, handle } = setup();
    handle.dispose();

    handle.clear();
    handle.setCopyOnSelect(true);

    expect(fake.written).toEqual([]);
  });

  test("선택 복사 리스너를 뗀다", () => {
    const writeText = stubClipboard();
    const { fake, handle } = setup({ terminal: { withElement: true } });
    handle.dispose();
    fake.select("abc");

    fake.term.element!.dispatchEvent(
      new MouseEvent("mousedown", { button: 0 }),
    );
    document.dispatchEvent(new MouseEvent("mouseup"));

    expect(writeText).not.toHaveBeenCalled();
  });
});

describe("선택 복사", () => {
  test("드래그 선택 자동 복사는 기본으로 켜져 있고 setCopyOnSelect(false)로 끈다", async () => {
    const writeText = stubClipboard();
    const { fake, handle } = setup({ terminal: { withElement: true } });
    const drag = () => {
      fake.term.element!.dispatchEvent(
        new MouseEvent("mousedown", { button: 0 }),
      );
      document.dispatchEvent(new MouseEvent("mouseup"));
    };
    fake.select("abc");

    drag();
    expect(writeText).toHaveBeenCalledTimes(1);

    handle.setCopyOnSelect(false);
    drag();
    expect(writeText).toHaveBeenCalledTimes(1);
  });

  test("copyOnSelect: false 옵션이면 처음부터 자동 복사하지 않는다", () => {
    const writeText = stubClipboard();
    const { fake } = setup({
      terminal: { withElement: true },
      runner: { copyOnSelect: false },
    });
    fake.select("abc");

    fake.term.element!.dispatchEvent(
      new MouseEvent("mousedown", { button: 0 }),
    );
    document.dispatchEvent(new MouseEvent("mouseup"));

    expect(writeText).not.toHaveBeenCalled();
  });
});
