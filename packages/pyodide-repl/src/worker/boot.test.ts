// @vitest-environment node
/**
 * worker 부팅 시퀀스(`bootReplWorker`) 시험(01-protocols.md 5절 S1, 00-architecture.md 3.1·3.2).
 * 실제 `MessageChannel` 양 끝에 worker 역할(`bootReplWorker`)과 main 역할(`createRpc` + 기록 핸들러)을 두고
 * 실제 pyodide(node)로 `ready` → 배너 → 각본형 `readLine` REPL 실행 순서, 종료, 실행 밖 오류 정책, 로드 실패 경로를
 * 확인한다. 알림과 `readLine` 요청은 한 타임라인(`events`)에 도착 순서대로 기록해 "출력이 다음 프롬프트 요청보다 먼저
 * 온다"를 순서까지 고정한다. CDN 동적 import(`loadPyodideFromCdn`)는 브라우저 전용이라 npm `loadPyodide`를 주입한다.
 */
import { loadPyodide, type PyodideInterface } from "pyodide";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import {
  ACK,
  SIGNAL,
  createInterruptBuffer,
  createMailboxWriter,
  createStdinMailbox,
  PYODIDE_VERSION,
} from "@cp949/runo-pyodide-core";
import {
  type InitFrame,
  signalInterrupt,
  createRpc,
} from "@cp949/runo-pyodide-core/worker";
import { bootReplWorker } from "./boot";

let pyodide: PyodideInterface;

beforeAll(async () => {
  pyodide = await loadPyodide();
}, 60_000);

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.restoreAllMocks();
  // 부팅이 `connectInterrupts`로 프레임의 버퍼를 연결한다. 공유 인스턴스에 남으면 다음 시험의 실행이 그 버퍼를 폴링한다.
  pyodide.setInterruptBuffer(
    undefined as unknown as Parameters<
      PyodideInterface["setInterruptBuffer"]
    >[0],
  );
});

const NOTIFICATIONS = [
  "write",
  "writeErrorRaw",
  "writeOutput",
  "writeError",
  "ready",
  "loadFailed",
  "sessionTerminated",
  "readInput",
  "crashed",
];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * worker 역할이 받을 초기화 프레임과, main 역할이 받은 알림·요청 기록(`[이름, ...인자]`, 도착 순서).
 * `script`는 `readLine` 요청에 차례로 답할 값이다. 항목이 함수면 그 요청이 도착한 때 호출해 반환값으로 답한다
 * (`writer.deliver`를 미리 걸어 두는 부작용을 그 시점에 넣는 용도). 각본이 끝난 뒤의 요청은 오류로 답한다(기록은 남는다).
 * `writer`는 main 쪽 메일박스 쓰기다. worker가 `Atomics.wait`로 정지하기 전에 `deliver`해 두면(선전달) 시험 스레드가
 * worker와 같은 스레드여도 멈추지 않는다 — STATE가 이미 READY면 `Atomics.wait`가 즉시 돌아온다.
 */
function createMainSide(script: unknown[] = []) {
  const channel = new MessageChannel();
  const mailbox = createStdinMailbox();
  const writer = createMailboxWriter(mailbox);
  const frame: InitFrame = {
    kind: "init",
    rpcPort: channel.port1,
    interruptBuffer: createInterruptBuffer(),
    stdinCtrl: mailbox.ctrl,
    stdinData: mailbox.data,
    driver: { topLevelAwait: false },
    pyodide: { indexURL: "unused-in-node/" },
  };
  const events: unknown[][] = [];
  const rpc = createRpc(
    channel.port2,
    Object.fromEntries([
      ...NOTIFICATIONS.map((name) => [
        name,
        (...args: unknown[]) => {
          events.push([name, ...args]);
        },
      ]),
      [
        "readLine",
        (...args: unknown[]) => {
          events.push(["readLine", ...args]);
          if (script.length === 0) throw new Error("각본 밖 readLine 요청");
          const next = script.shift();
          return typeof next === "function" ? (next as () => unknown)() : next;
        },
      ],
    ]),
  );
  cleanups.push(() => {
    rpc.dispose();
    channel.port1.close();
    channel.port2.close();
  });
  // complete 시험이 main 쪽에서 직접 `rpc.call("complete", ...)`을 보내야 하므로 rpc도 내놓는다.
  /** 알림은 `MessagePort`를 타므로 `await bootReplWorker` 뒤에도 늦게 도착할 수 있다. 50ms 간격으로 최대 5초 기다린다. */
  async function waitFor(predicate: () => boolean): Promise<void> {
    for (let waited = 0; waited < 5000; waited += 50) {
      if (predicate()) return;
      await sleep(50);
    }
    throw new Error("기다리던 알림이 오지 않았다");
  }
  return { frame, events, waitFor, writer, rpc };
}

const PROMPT_REQUEST = ["readLine", ">>> ", undefined, true];

/** 고정 버전 pyodide 부팅의 `ready` 페이로드: 저하 지점 없음, 버전 일치, `details` 없음. */
const CLEAN_READY = {
  pyodideVersion: PYODIDE_VERSION,
  versionMismatch: false,
  degraded: [],
};

/** 각본 `["1 + 1", "exit()"]`이 눌림의 영향 없이 끝났을 때의 알림·요청 타임라인. */
const CLEAN_SESSION = [
  ["ready", CLEAN_READY],
  ["writeOutput", expect.stringMatching(/^Python 3\.14\.2 \(.*[^\n]$/s)],
  PROMPT_REQUEST,
  ["writeOutput", "2"],
  PROMPT_REQUEST,
  ["sessionTerminated"],
];

describe("bootReplWorker", () => {
  test("배너 뒤 readLine 요청에 답하면 출력이 다음 요청보다 먼저 오고 exit()로 끝난다", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const { frame, events, waitFor } = createMainSide([
      "1 + 1",
      "if True:",
      "    print(1)",
      "",
      "1 +",
      "1/0",
      'print("t", end="")',
      "exit()",
    ]);

    await bootReplWorker(frame, { loadPyodide: () => loadPyodide() });
    await waitFor(() => events.some((e) => e[0] === "sessionTerminated"));

    // 배너는 개행을 더해 보내지 않는다(TRAP-29). 빈 조각(`write ""`)은 main sink가 거른다(여기서는 알림 그대로 기록).
    expect(events).toEqual([
      ["ready", CLEAN_READY],
      ["writeOutput", expect.stringMatching(/^Python 3\.14\.2 \(.*[^\n]$/s)],
      PROMPT_REQUEST,
      ["writeOutput", "2"],
      PROMPT_REQUEST,
      ["readLine", "... ", "if True:", true],
      ["readLine", "... ", "if True:\n    print(1)", true],
      ["write", "1"],
      ["write", "\n"],
      PROMPT_REQUEST,
      [
        "writeError",
        '  File "<console>", line 1\n    1 +\n       ^\nSyntaxError: invalid syntax',
      ],
      PROMPT_REQUEST,
      [
        "writeError",
        expect.stringMatching(
          /^Traceback \(most recent call last\):\n[\s\S]*ZeroDivisionError: division by zero$/,
        ),
      ],
      PROMPT_REQUEST,
      ["write", "t"],
      ["write", ""],
      PROMPT_REQUEST,
      ["sessionTerminated"],
    ]);
    const traceback = String(
      events.find(
        (e) => e[0] === "writeError" && String(e[1]).includes("ZeroDivision"),
      )?.[1],
    );
    for (const internal of ["runcode", "push", "await_fut", "__repl_run"]) {
      expect(traceback.includes(internal)).toBe(false);
    }
    expect(consoleError).not.toHaveBeenCalled();
  }, 30_000);

  test("sessionTerminated 뒤에는 readLine 요청이 더 오지 않는다", async () => {
    const { frame, events, waitFor } = createMainSide(["exit()"]);

    await bootReplWorker(frame, { loadPyodide: () => loadPyodide() });
    await waitFor(() => events.some((e) => e[0] === "sessionTerminated"));
    const count = events.length;
    await sleep(200);

    expect(events).toHaveLength(count);
    expect(events.filter((e) => e[0] === "readLine")).toHaveLength(1);
  }, 30_000);

  test("run이 예상 밖 오류를 던지면 repl 내부 오류를 알리고 콘솔을 정리한 뒤 다음 프롬프트로 계속한다", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    // 문자열이 아닌 입력은 콘솔 `push`가 `KeyboardInterrupt`가 아닌 TypeError를 던진다 — 러너가 삼키지 않는 오류의
    // 실제 경로다. 콘솔 buffer에 그 값이 남으므로 `clearPending()`이 없으면 다음 줄도 같은 오류로 실패한다.
    const { frame, events, waitFor } = createMainSide([42, "1 + 1", "exit()"]);

    await bootReplWorker(frame, { loadPyodide: () => loadPyodide() });
    await waitFor(() => events.some((e) => e[0] === "sessionTerminated"));

    expect(events.slice(2)).toEqual([
      PROMPT_REQUEST,
      [
        "writeError",
        expect.stringMatching(/^repl 내부 오류: [\s\S]*TypeError/),
      ],
      PROMPT_REQUEST,
      ["writeOutput", "2"],
      PROMPT_REQUEST,
      ["sessionTerminated"],
    ]);
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError.mock.calls[0]?.[0]).toBe("[repl.worker] 루프 오류");
  }, 30_000);

  test("부팅 시퀀스(루프 포함)의 잡히지 않은 예외는 crashed 알림으로 나가고 이후 readLine 요청은 오지 않는다", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    // writeError 전송 자체가 실패하는(예: 알림 핸들러 예외 재발생) 상황을 흉내 낸다. onError가 이 알림을 그대로 던지면
    // repl-loop의 run 오류 처리가 삼키지 못하고 boot의 새 catch-all로 샌다(RD-010).
    const { frame, events, waitFor } = createMainSide([42, "exit()"]);
    const realPostMessage = frame.rpcPort.postMessage.bind(frame.rpcPort);
    vi.spyOn(frame.rpcPort, "postMessage").mockImplementation((message) => {
      const m = message as { kind?: string; name?: string };
      if (m.kind === "ntf" && m.name === "writeError") {
        throw new Error("포트 전송 실패");
      }
      realPostMessage(message);
    });

    await bootReplWorker(frame, { loadPyodide: () => loadPyodide() });
    await waitFor(() => events.some((e) => e[0] === "crashed"));

    expect(events.find((e) => e[0] === "crashed")).toEqual([
      "crashed",
      { message: "Error: 포트 전송 실패" },
    ]);
    expect(events.filter((e) => e[0] === "readLine")).toHaveLength(1);
    expect(events.some((e) => e[0] === "sessionTerminated")).toBe(false);
    expect(consoleError).toHaveBeenCalledWith(
      "[repl.worker] 루프 오류",
      expect.anything(),
    );
  }, 30_000);

  test("compiler-flags가 저하된 pyodide도 부팅되고 ready의 degraded에 그 식별자만 실려 REPL이 계속 동작한다", async () => {
    const { frame, events, waitFor } = createMainSide(["1 + 1", "exit()"]);

    await bootReplWorker(frame, {
      loadPyodide: async () => {
        const instance = await loadPyodide();
        // `_compile.compiler.flags` 경로만 없앤다(안쪽 컴파일러는 그대로). 새 인스턴스라 다른 시험에 새지 않는다.
        instance.runPython(
          [
            "import types",
            "import pyodide.console as pc",
            "_orig_init = pc.PyodideConsole.__init__",
            "def _init(self, *args, **kwargs):",
            "    _orig_init(self, *args, **kwargs)",
            "    inner = self._compile",
            "    class Compiler:",
            "        compiler = types.SimpleNamespace()",
            "        def __call__(self, *a, **k):",
            "            return inner(*a, **k)",
            "    self._compile = Compiler()",
            "pc.PyodideConsole.__init__ = _init",
          ].join("\n"),
        );
        return instance;
      },
    });
    await waitFor(() => events.some((e) => e[0] === "sessionTerminated"));

    expect(events[0]).toEqual([
      "ready",
      {
        pyodideVersion: PYODIDE_VERSION,
        versionMismatch: false,
        degraded: ["compiler-flags"],
      },
    ]);
    expect(events).toContainEqual(["writeOutput", "2"]);
  }, 60_000);

  test("로더가 던지면 loadFailed만 오고 ready·배너·readLine 요청은 오지 않는다", async () => {
    const { frame, events, waitFor } = createMainSide(["1 + 1"]);

    await bootReplWorker(frame, {
      loadPyodide: async () => {
        throw new Error("boom");
      },
    });
    await waitFor(() => events.length >= 1);
    await sleep(100);

    expect(events).toEqual([["loadFailed", "Error: boom"]]);
  });

  test("콘솔 생성이 던져도 loadFailed로 알리고 루프에 들어가지 않는다", async () => {
    const { frame, events, waitFor } = createMainSide(["1 + 1"]);
    // loadPyodide는 성공하지만 콘솔 모듈을 가져오는 pyimport가 실패하는 가짜.
    const broken = new Proxy(pyodide, {
      get(target, key) {
        if (key === "pyimport") {
          return () => {
            throw new Error("no console");
          };
        }
        return Reflect.get(target, key) as unknown;
      },
    });

    await bootReplWorker(frame, { loadPyodide: async () => broken });
    await waitFor(() => events.length >= 1);
    await sleep(100);

    expect(events).toEqual([["loadFailed", "Error: no console"]]);
  });

  test('input("x: ")과 sys.stdin.readline()은 출력 → readInput 알림 → 메일박스 값 순서로 읽고 값이 REPL 변수에 들어간다', async () => {
    const { frame, events, waitFor, writer } = createMainSide([
      // 선전달: 각 줄이 `input()`을 부르기 전에 값을 메일박스에 넣어 둔다(두 번째는 첫 값이 소비된 뒤라 IDLE이다).
      () => {
        void writer.deliver("abc");
        return 'x = input("x: ")';
      },
      "x",
      () => {
        void writer.deliver("def");
        return "import sys; y = sys.stdin.readline()";
      },
      "y",
      "exit()",
    ]);
    let setStdinSpy: ReturnType<typeof vi.spyOn<PyodideInterface, "setStdin">>;

    await bootReplWorker(frame, {
      loadPyodide: async () => {
        const instance = await loadPyodide();
        // 배선이 빠진 회귀에서 `input()`이 node의 실제 stdin을 동기로 읽으면 스레드가 막혀 `waitFor`·시험 timeout도
        // 돌지 못하고 스위트 전체가 멈춘다. 기본 stdin을 즉시 오류로 바꿔 두면 `OSError`로 실패한다(부팅이 덮어쓴다).
        instance.setStdin({ error: true });
        setStdinSpy = vi.spyOn(instance, "setStdin");
        return instance;
      },
    });
    await waitFor(() => events.some((e) => e[0] === "sessionTerminated"));

    // 각 읽기가 자기 값을 읽는다: `input()`은 `'abc'`, `readline()`은 tty처럼 개행이 붙은 `'def\n'`(repr).
    expect(events.slice(2)).toEqual([
      PROMPT_REQUEST,
      ["write", "x: "],
      ["readInput", true],
      PROMPT_REQUEST,
      ["writeOutput", "'abc'"],
      PROMPT_REQUEST,
      ["readInput", true],
      PROMPT_REQUEST,
      ["writeOutput", "'def\\n'"],
      PROMPT_REQUEST,
      ["sessionTerminated"],
    ]);
    // 옵션은 `stdin`뿐이다(기본 `isatty: false`·`autoEOF: true`를 그대로 쓴다, DELTA-01 시험의 전제).
    expect(setStdinSpy!).toHaveBeenCalledTimes(1);
    expect(Object.keys(setStdinSpy!.mock.calls[0]![0]!)).toEqual(["stdin"]);
  }, 30_000);

  test("메일박스 취소 표식은 `input()` 호출 지점의 KeyboardInterrupt가 되고 다음 프롬프트로 이어진다", async () => {
    const { frame, events, waitFor, writer } = createMainSide([
      // 선전달: `input()`이 정지하기 전에 취소 표식을 써 둔다(STATE가 CANCELLED면 `Atomics.wait`가 즉시 돌아온다).
      () => {
        void writer.cancel();
        return 'x = input("x: ")';
      },
      "exit()",
    ]);

    await bootReplWorker(frame, {
      loadPyodide: async () => {
        const instance = await loadPyodide();
        // 배선이 빠진 회귀에서 node의 실제 stdin을 동기로 읽으면 스위트가 멈춘다. 즉시 오류로 바꿔 둔다(부팅이 덮어쓴다).
        instance.setStdin({ error: true });
        return instance;
      },
    });
    await waitFor(() => events.some((e) => e[0] === "sessionTerminated"));

    // 프롬프트 출력 → readInput 알림 → 취소 트레이스백 → 다음 프롬프트. `EOFError`도 `OSError`도 아니다.
    expect(events.slice(2)).toEqual([
      PROMPT_REQUEST,
      ["write", "x: "],
      ["readInput", true],
      [
        "writeError",
        'Traceback (most recent call last):\n  File "<console>", line 1, in <module>\nKeyboardInterrupt',
      ],
      PROMPT_REQUEST,
      ["sessionTerminated"],
    ]);
    // 콜백이 쓴 SIGINT는 그 자리에서 소비됐고 ack·요청 번호가 하나씩 올랐다.
    expect([...frame.interruptBuffer]).toEqual([0, 1, 1, 0]);
  }, 30_000);

  test("setStdin이 던지면 loadFailed만 오고 ready·배너·readLine 요청은 오지 않는다(setStdin은 ready 전에 건다)", async () => {
    const { frame, events, waitFor } = createMainSide(["1 + 1"]);
    vi.spyOn(pyodide, "setStdin").mockImplementation(() => {
      throw new Error("bad stdin");
    });

    await bootReplWorker(frame, { loadPyodide: async () => pyodide });
    await waitFor(() => events.length >= 1);
    await sleep(100);

    expect(events).toEqual([["loadFailed", "Error: bad stdin"]]);
  });

  test("SIGINT 핸들러 설치·프레임 버퍼 연결은 setStdin·ready 알림보다 먼저다", async () => {
    const { frame, events, waitFor } = createMainSide(["exit()"]);
    const postMessage = vi.spyOn(frame.rpcPort, "postMessage");
    let setInterruptBufferSpy: ReturnType<
      typeof vi.spyOn<PyodideInterface, "setInterruptBuffer">
    >;
    let setStdinSpy: ReturnType<typeof vi.spyOn<PyodideInterface, "setStdin">>;

    await bootReplWorker(frame, {
      loadPyodide: async () => {
        const instance = await loadPyodide();
        setInterruptBufferSpy = vi.spyOn(instance, "setInterruptBuffer");
        setStdinSpy = vi.spyOn(instance, "setStdin");
        return instance;
      },
    });
    await waitFor(() => events.some((e) => e[0] === "sessionTerminated"));

    // 세 호출의 호출 전역 순번(invocationCallOrder)을 비교한다. `ready`는 포트로 나간 알림 메시지에서 찾는다.
    const readyIndex = postMessage.mock.calls.findIndex(
      ([message]) => (message as { name?: string }).name === "ready",
    );
    expect(readyIndex).toBeGreaterThanOrEqual(0);
    const connectOrder = setInterruptBufferSpy!.mock.invocationCallOrder[0]!;
    const stdinOrder = setStdinSpy!.mock.invocationCallOrder[0]!;
    const readyOrder = postMessage.mock.invocationCallOrder[readyIndex]!;
    expect(connectOrder).toBeLessThan(stdinOrder);
    expect(stdinOrder).toBeLessThan(readyOrder);
    // main이 쓰는 버퍼와 같은 것을 연결해야 눌림이 worker에 닿는다.
    expect(setInterruptBufferSpy!).toHaveBeenCalledTimes(1);
    expect(setInterruptBufferSpy!.mock.calls[0]![0]).toBe(
      frame.interruptBuffer,
    );
  }, 30_000);

  test("부팅 전에 쓰인 눌림은 시작 코드를 죽이지 않고 폐기·ack된다", async () => {
    const { frame, events, waitFor } = createMainSide(["1 + 1", "exit()"]);
    signalInterrupt(frame.interruptBuffer); // SEQ 1, SIGNAL 2
    // 연결 단계가 끝난 시점을 그 다음 단계인 `setStdin` 호출에서 잡는다.
    let atSetStdin: number[] | undefined;

    await bootReplWorker(frame, {
      loadPyodide: async () => {
        const instance = await loadPyodide();
        const setStdin = instance.setStdin.bind(instance);
        vi.spyOn(instance, "setStdin").mockImplementation((...args) => {
          atSetStdin = [...frame.interruptBuffer];
          setStdin(...args);
        });
        return instance;
      },
    });
    await waitFor(() => events.some((e) => e[0] === "sessionTerminated"));

    expect(events).toEqual(CLEAN_SESSION);
    // [SIGNAL, ACK, SEQ, 예약]: 눌림이 지워졌고 ack됐다. 첫 `readLine` 뒤 루프의 폐기에 미루지 않고 연결 단계에서 끝난다.
    expect(atSetStdin).toEqual([0, 1, 1, 0]);
    expect([...frame.interruptBuffer]).toEqual([0, 1, 1, 0]);
  }, 30_000);

  test("readLine 응답 뒤 남은 SIGINT는 실행 전에 폐기되고 ack된다", async () => {
    const { frame, events, waitFor } = createMainSide([
      // 읽는 동안 쓰인 눌림은 대상 코드가 없다(TRP-009). `readLine` 요청이 도착한 때 쓰고 줄을 돌려준다.
      () => {
        signalInterrupt(frame.interruptBuffer);
        return "1 + 1";
      },
      "exit()",
    ]);

    await bootReplWorker(frame, { loadPyodide: () => loadPyodide() });
    await waitFor(() => events.some((e) => e[0] === "sessionTerminated"));

    expect(events).toEqual(CLEAN_SESSION);
    expect([...frame.interruptBuffer]).toEqual([0, 1, 1, 0]);
  }, 30_000);

  test("readLine 응답 뒤 남은 SIGINT는 핸들러가 무시할 번호여도 실행 전에 지우고 ack한다", async () => {
    const { frame, events, waitFor } = createMainSide([
      // 이미 처리한 번호의 재전송 잔여를 흉내 낸다: 요청 번호는 두고 SIGNAL만 2로 쓴다. 핸들러는 같은 번호를 ack 없이
      // 무시하므로 폴링에 맡기면 ack 없이 지워져 송신기가 소실로 오판한다(TRP-027). 루프의 폐기가 지우면서 ack해야 한다.
      () => {
        Atomics.store(frame.interruptBuffer, SIGNAL, 2);
        return "1 + 1";
      },
      "exit()",
    ]);

    await bootReplWorker(frame, { loadPyodide: () => loadPyodide() });
    await waitFor(() => events.some((e) => e[0] === "sessionTerminated"));

    expect(events).toEqual(CLEAN_SESSION);
    expect([...frame.interruptBuffer]).toEqual([0, 1, 0, 0]);
  }, 30_000);

  test("부팅한 worker에서 실행 중 눌림은 핸들러 프레임 없는 KeyboardInterrupt 트레이스백으로 끝나고 ack된다", async () => {
    const { frame, events, waitFor } = createMainSide([
      // 프로그램이 스스로 눌림을 써 같은 스레드에서 결정적으로 만든다(sigint-handler.test.ts와 같은 방식).
      'exec("press()\\nfor _ in range(10**7): pass")',
      "exit()",
    ]);

    await bootReplWorker(frame, {
      loadPyodide: async () => {
        const instance = await loadPyodide();
        instance.globals.set("press", () =>
          signalInterrupt(frame.interruptBuffer),
        );
        return instance;
      },
    });
    await waitFor(() => events.some((e) => e[0] === "sessionTerminated"));

    // `exec` 실행은 프레임이 정확히 둘이다(`<console>` + `<string>`). 핸들러 프레임은 절단돼 나오지 않는다.
    expect(events.find((e) => e[0] === "writeError")).toEqual([
      "writeError",
      expect.stringMatching(
        /^Traceback \(most recent call last\):\n {2}File "<console>", line 1, in <module>\n {2}File "<string>", line [12], in <module>\nKeyboardInterrupt$/,
      ),
    ]);
    // 핸들러가 프레임 버퍼의 요청 번호를 읽고 ack했다.
    expect([...frame.interruptBuffer]).toEqual([0, 1, 1, 0]);
  }, 30_000);

  test("버퍼 연결이 던지면 loadFailed만 오고 ready·배너·readLine 요청은 오지 않는다", async () => {
    const { frame, events, waitFor } = createMainSide(["1 + 1"]);
    vi.spyOn(pyodide, "setInterruptBuffer").mockImplementation(() => {
      throw new Error("bad interrupt buffer");
    });

    await bootReplWorker(frame, { loadPyodide: async () => pyodide });
    await waitFor(() => events.length >= 1);
    await sleep(100);

    expect(events).toEqual([["loadFailed", "Error: bad interrupt buffer"]]);
  });

  test("루프가 끝나면 감시 타이머를 끈다(clearInterval이 setInterval의 id로 불린다)", async () => {
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
    const { frame, events, waitFor } = createMainSide(["exit()"]);

    await bootReplWorker(frame, { loadPyodide: () => loadPyodide() });
    await waitFor(() => events.some((e) => e[0] === "sessionTerminated"));

    // 감시 타이머는 tickMs 기본값 20으로 건다. 다른 setInterval 호출과 섞여도 간격으로 골라낸다.
    const watchCallIndex = setIntervalSpy.mock.calls.findIndex(
      ([, ms]) => ms === 20,
    );
    expect(watchCallIndex).toBeGreaterThanOrEqual(0);
    const timerId = setIntervalSpy.mock.results[watchCallIndex]?.value;
    expect(clearIntervalSpy).toHaveBeenCalledWith(timerId);
  }, 30_000);

  test("정지한 실행(asyncio.run 대기) 중 눌림은 감시 타이머가 200ms 안에 깨운다", async () => {
    let pressedAt: number | undefined;
    const { frame, events, waitFor } = createMainSide([
      "import asyncio",
      () => {
        // 타이머가 깨운다는 것을 보이기 위해 main의 재전송 송신기는 전혀 쓰지 않는다: signalInterrupt 한 번뿐이다.
        // 100ms 뒤에 쓰는 것은 readLine 응답 직후 루프의 discardPendingInterrupt(실행 전 폐기, TRP-009)가 이 눌림을
        // 지우지 않도록, 대기가 실제로 시작된 뒤에 누른 것으로 만들기 위해서다.
        setTimeout(() => {
          pressedAt = performance.now();
          signalInterrupt(frame.interruptBuffer);
        }, 100);
        return "asyncio.run(asyncio.sleep(5))";
      },
      "exit()",
    ]);

    await bootReplWorker(frame, { loadPyodide: () => loadPyodide() });
    await waitFor(
      () => events.filter((e) => e[0] === "readLine").length >= 3,
    );
    const elapsedMs = performance.now() - (pressedAt as number);
    await waitFor(() => events.some((e) => e[0] === "sessionTerminated"));

    expect(elapsedMs).toBeLessThan(200);
    // 우리 프레임(핸들러·run_sync 래퍼)도 webloop 프레임도 남지 않는다(03-ctrl-c.md 2.4 깨우기 세부).
    expect(events.find((e) => e[0] === "writeError")).toEqual([
      "writeError",
      'Traceback (most recent call last):\n  File "<console>", line 1, in <module>\nKeyboardInterrupt',
    ]);
    // 깨운 쪽이 타이머든(핸들러 규칙 ③과의 경합) 어느 쪽이든 정확히 한 번만 소비·ack된다.
    expect([...frame.interruptBuffer]).toEqual([0, 1, 1, 0]);
  }, 30_000);

  test("프롬프트가 열려 있는 동안 남은 SIGINT는 감시 타이머가 100ms 안에 버리고, 다음 실행에는 새지 않는다", async () => {
    let pressedAt: number | undefined;
    let resolveNext: ((line: string) => void) | undefined;
    const { frame, events, waitFor } = createMainSide([
      // readLine 요청이 도착한 시점(atPrompt=true, 아직 응답 전)에 SIGINT를 쓴다. 대상 코드가 없는 낡은 눌림이라
      // 감시 타이머가 그 틱에서 버려야 한다(03-ctrl-c.md 2.5 프롬프트 유휴 폐기).
      () =>
        new Promise<string>((resolve) => {
          resolveNext = resolve;
          pressedAt = performance.now();
          signalInterrupt(frame.interruptBuffer);
        }),
      "exit()",
    ]);

    const booted = bootReplWorker(frame, { loadPyodide: () => loadPyodide() });
    await waitFor(() => frame.interruptBuffer[ACK] === 1);
    const elapsedMs = performance.now() - (pressedAt as number);
    expect(elapsedMs).toBeLessThan(100);
    expect(frame.interruptBuffer[SIGNAL]).toBe(0);

    resolveNext?.("1 + 1");
    await booted;
    await waitFor(() => events.some((e) => e[0] === "sessionTerminated"));

    // 버려진 SIGINT는 다음 실행으로 새지 않는다: writeOutput("2")(값 에코)만 오고 writeError는 없다.
    expect(events.slice(2)).toEqual(CLEAN_SESSION.slice(2));
  }, 30_000);

  test("프롬프트 대기 중(atPrompt)에만 complete가 실제 후보를 계산하고, 대기 전·실행 중에는 빈 응답이다(RD-015)", async () => {
    let resolveSecondLine: ((line: string) => void) | undefined;
    const { frame, events, waitFor, rpc } = createMainSide([
      "import asyncio; import os",
      () =>
        new Promise<string>((resolve) => {
          resolveSecondLine = resolve;
        }),
      "exit()",
    ]);

    void bootReplWorker(frame, { loadPyodide: () => loadPyodide() });
    // 콘솔 생성 전(ready 전, completer가 아직 없다): 빈 응답. createRpc는 부팅 함수의 첫 await 전에 handlers를
    // 등록하므로 pyodide 로드가 끝나기 전에 온 요청도 즉시(빈 값으로) 답한다.
    await expect(rpc.call("complete", "os.pa", undefined)).resolves.toEqual({
      completions: [],
      start: 0,
    });

    // 두 번째 readLine이 열려 있는 동안(atPrompt=true, 아직 응답 전): 실제 후보.
    await waitFor(
      () => events.filter((e) => e[0] === "readLine").length >= 2,
    );
    const duringPrompt = await rpc.call<{ completions: string[]; start: number }>(
      "complete",
      "os.pa",
      undefined,
    );
    expect(duringPrompt.completions.length).toBeGreaterThan(0);
    expect(duringPrompt.completions).toContain("os.path");

    // asyncio.sleep으로 실행 중(atPrompt=false)에 보낸 complete는 빈 응답이다. WebLoop의 협조적 양보 덕에 실행
    // 중에도 이벤트 루프가 살아 있어 이 요청이 처리된다(RD-009 sleep-await).
    resolveSecondLine?.("asyncio.run(asyncio.sleep(1))");
    await sleep(50);
    await expect(rpc.call("complete", "os.pa", undefined)).resolves.toEqual({
      completions: [],
      start: 0,
    });

    await waitFor(
      () => events.filter((e) => e[0] === "readLine").length >= 3,
    );
    await waitFor(() => events.some((e) => e[0] === "sessionTerminated"));
  }, 30_000);
});
