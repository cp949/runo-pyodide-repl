// @vitest-environment node
/**
 * Ctrl+C 연결(`connectInterrupts`) 시험(03-ctrl-c.md 2.6, TRP-027). 순서 — SIGINT 핸들러 설치 → 남은 SIGINT 폐기 →
 * interrupt buffer 연결 — 이 부팅 중 눌림으로부터 시작 코드를 지킨다. 폴링은 버퍼를 연결한 뒤에야 시작하므로 연결이
 * 먼저이면 그 사이에 쓴 눌림을 pyodide 기본 핸들러가 받아 시작 코드가 `KeyboardInterrupt`로 죽는다.
 * 실제 pyodide(node)를 mock 없이 쓴다. `setInterruptBuffer`는 폴링이 시작되는 순간을 만들려고 원본 호출 직전에 훅을
 * 끼워 감쌀 뿐 원본을 그대로 부른다.
 */
import { loadPyodide, type PyodideInterface } from "pyodide";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { ACK, SIGNAL, createInterruptBuffer } from "@cp949/runo-pyodide-core";
import {
  acknowledgeInterrupt,
  discardPendingInterrupt,
  readRequestSeq,
  signalInterrupt,
} from "@cp949/runo-pyodide-core/worker";
import {
  CONSOLE_TRACEBACK,
  INTERRUPT_PRESSER_ROLE,
  type PresserCommand,
} from "../test/sigint-setup";
import { spawnRole } from "@repo/pyodide-testkit/thread";
import { createConsole } from "./console";
import {
  SLEEP_SLICE_FILENAME,
  connectInterrupts,
  suppressWebLoopReraise,
  warnDegraded,
  type ReportDegraded,
} from "../test/core-internals";
import { loadSplitPaste } from "./multiline";
import { createSubmissionRunner } from "./submission-runner";

let pyodide: PyodideInterface;

beforeAll(async () => {
  pyodide = await loadPyodide();
}, 60_000);

/** 이 시험이 연결한 버퍼. `afterEach`가 떼고 비운다. */
let connected: Int32Array | undefined;

afterEach(() => {
  // 스파이를 먼저 풀어 원본으로 버퍼를 뗀다. 남은 SIGINT가 다음 시험의 실행을 끊지 않도록 비우고 핸들러를 기본으로 되돌린다.
  vi.restoreAllMocks();
  pyodide.setInterruptBuffer(
    undefined as unknown as Parameters<
      PyodideInterface["setInterruptBuffer"]
    >[0],
  );
  if (connected) discardPendingInterrupt(connected);
  connected = undefined;
  pyodide.runPython(
    "import signal\nsignal.signal(signal.SIGINT, signal.default_int_handler)",
  );
});

/** 폴링이 여러 번 일어나는 짧은 바쁜 루프(약 25ms). 폴링이 대기 중인 SIGINT를 읽으면 핸들러가 돈다. */
const BUSY = "for _ in range(10**6): pass";

/** 새 콘솔·새 버퍼와 `boot.ts`가 넣는 네 클로저. `discard`는 호출 순서를 보려고 `vi.fn`으로 감싼다. */
function setup() {
  const { pyconsole } = createConsole(
    pyodide,
    { write: () => {}, writeErrorRaw: () => {} },
    { topLevelAwait: false },
  );
  const buffer = createInterruptBuffer();
  connected = buffer;
  const discard = vi.fn(() => discardPendingInterrupt(buffer));
  const report = vi.fn<ReportDegraded>();
  const deps = {
    ack: () => acknowledgeInterrupt(buffer),
    seq: () => readRequestSeq(buffer),
    discard,
    report,
  };
  return { pyconsole, buffer, deps, discard, report };
}

/** 원본 `setInterruptBuffer`를 부르기 직전에 `hook`을 실행한다. 폴링이 시작되는 순간에 무슨 일이 일어나는지를 만든다. */
function beforeConnect(hook: () => void) {
  const original = pyodide.setInterruptBuffer.bind(pyodide);
  return vi
    .spyOn(pyodide, "setInterruptBuffer")
    .mockImplementation((buffer) => {
      hook();
      original(buffer);
    });
}

describe("connectInterrupts", () => {
  test("폴링이 시작될 때 SIGINT 핸들러가 이미 설치돼 있다", () => {
    const { pyconsole, buffer, deps } = setup();
    let handlerAtConnect: unknown;
    beforeConnect(() => {
      handlerAtConnect = pyodide.runPython(
        "import signal\nsignal.getsignal(signal.SIGINT).__name__",
      );
    });

    connectInterrupts(pyodide, pyconsole, buffer, deps);

    expect(handlerAtConnect).toBe("sigint_handler");
  });

  test("폴링이 시작되는 순간 쓰인 눌림을 핸들러가 받아 버리고 시작 코드가 죽지 않는다", () => {
    const { pyconsole, buffer, deps } = setup();
    beforeConnect(() => signalInterrupt(buffer));

    connectInterrupts(pyodide, pyconsole, buffer, deps);
    // 연결 직후 도는 Python 실행이 그 눌림을 폴링으로 읽는다. 사용자 프레임(`<console>`)이 없어 핸들러가 버린다.
    expect(() => pyodide.runPython(BUSY)).not.toThrow();

    expect(Atomics.load(buffer, ACK)).toBe(1);
    expect(Atomics.load(buffer, SIGNAL)).toBe(0);
  });

  test("연결 전에 쓰인 SIGINT는 지우고 ack한다", () => {
    const { pyconsole, buffer, deps } = setup();
    signalInterrupt(buffer);

    connectInterrupts(pyodide, pyconsole, buffer, deps);

    // 실행 전에 슬롯을 본다: 폴링이 아니라 연결 절차가 지운 것이어야 한다. [SIGNAL, ACK, SEQ, 예약]
    expect([...buffer]).toEqual([0, 1, 1, 0]);
    expect(() => pyodide.runPython(BUSY)).not.toThrow();
    expect(Atomics.load(buffer, ACK)).toBe(1);
  });

  test("연결 전에 눌림이 없으면 ack는 그대로다", () => {
    const { pyconsole, buffer, deps } = setup();

    connectInterrupts(pyodide, pyconsole, buffer, deps);

    expect([...buffer]).toEqual([0, 0, 0, 0]);
  });

  // 조각 교체는 핸들러보다 먼저여야 한다: 래퍼의 코드 객체를 핸들러의 절단 목록에 넘겨야 트레이스백에서 우리 프레임이
  // 잘린다(절단 결과는 아래 회귀 시험이 실제 배선으로 본다).
  test("연결이 time.sleep 조각 교체까지 한다", () => {
    const { pyconsole, buffer, deps, report } = setup();

    connectInterrupts(pyodide, pyconsole, buffer, deps);

    expect(
      pyodide.runPython("import time\ntime.sleep.__code__.co_filename"),
    ).toBe(SLEEP_SLICE_FILENAME);
    expect(report).not.toHaveBeenCalled();
  });

  // `installSigintHandler`에 조각 래퍼의 코드 객체(`extraOwnCodes`)를 안 넘기면 `formattraceback`이 그 프레임을
  // 우리 것으로 못 알아봐 화면에 `<sleep-slice>` 줄이 샌다. `sigint-handler-sleep-slice.test.ts`는 `sigint-setup.ts`로
  // **스스로** 조립하므로 이 배선 누락에 영향받지 않는다 — 실제 `connectInterrupts`를 거치는 이 시험만 잡는다.
  test("연결 뒤 sleep 중 눌림의 트레이스백에 sleep-slice 프레임이 없다", async () => {
    const screen = { stdout: "", stderr: "" };
    const repl = createConsole(
      pyodide,
      {
        write: (text) => {
          screen.stdout += text;
        },
        writeErrorRaw: (text) => {
          screen.stderr += text;
        },
      },
      { topLevelAwait: false },
    );
    const buffer = createInterruptBuffer();
    connected = buffer;
    // boot.ts와 같은 순서: WebLoop 재보고 억제 → connectInterrupts. 억제가 없으면 Task 밖으로 나간 KeyboardInterrupt가
    // 처리되지 않은 Promise 거부로 남는다(03-ctrl-c.md 2.8).
    suppressWebLoopReraise(pyodide, { report: warnDegraded });
    connectInterrupts(pyodide, repl.pyconsole, buffer, {
      ack: () => acknowledgeInterrupt(buffer),
      seq: () => readRequestSeq(buffer),
      discard: () => discardPendingInterrupt(buffer),
      report: warnDegraded,
    });
    const { run } = createSubmissionRunner(
      pyodide,
      repl,
      {
        writeOutput: (text) => {
          screen.stdout += `${text}\n`;
        },
        writeError: (text) => {
          screen.stderr += `${text}\n`;
        },
      },
      { splitPaste: loadSplitPaste(pyodide) },
    );
    // 눌림 스레드가 Python이 sleep에 들어간 뒤에 쓰도록 시작 표시를 둔다. 같은 스레드 `press()`는 pyodide 폴링이
    // sleep 진입 전에 소비할 수 있어(약 50 바이트코드마다) 중단 지점이 흔들린다.
    const ctl = new Int32Array(new SharedArrayBuffer(4));
    pyodide.globals.set("started", () => {
      Atomics.store(ctl, 0, 1);
      Atomics.notify(ctl, 0);
    });
    const presser = spawnRole(INTERRUPT_PRESSER_ROLE, { buffer, ctl });
    presser.post({ kind: "press", offsets: [200] } satisfies PresserCommand);

    expect(await run("import time; started(); time.sleep(5)")).toEqual({
      prompt: ">>> ",
      exit: false,
    });
    expect(await presser.next()).toMatchObject({ kind: "pressed", count: 1 });

    expect(screen.stderr).toBe(CONSOLE_TRACEBACK);
  }, 20_000);

  test("폐기가 버퍼 연결보다 먼저다", () => {
    const { pyconsole, buffer, deps, discard } = setup();
    const setInterruptBuffer = vi.spyOn(pyodide, "setInterruptBuffer");

    connectInterrupts(pyodide, pyconsole, buffer, deps);

    expect(setInterruptBuffer).toHaveBeenCalledWith(buffer);
    // 폴링이 시작된 뒤에 지우면 폴링이 ack 없이 SIGNAL을 지울 수 있다(TRP-027).
    expect(discard.mock.invocationCallOrder[0]).toBeLessThan(
      setInterruptBuffer.mock.invocationCallOrder[0]!,
    );
  });
});
