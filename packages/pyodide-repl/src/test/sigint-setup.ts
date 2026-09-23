/**
 * SIGINT 시험의 공통 조립(node + 실제 pyodide 전용, 09-testing.md 9.1). `sigint-handler.test.ts`와
 * `sigint-handler-sleep-slice.test.ts`가 같은 콘솔·버퍼·눌림 스레드 조립을 쓴다.
 *
 * 조립 순서는 worker의 `connectInterrupts`(03-ctrl-c.md 2.6)와 같되 개별 호출이다: `installSleepSlice` →
 * `installSigintHandler` → `setInterruptBuffer`. `discard`는 부르지 않는다 — `prepare`로 이전 세션의 요청 번호를
 * 미리 만드는 시험이 폐기에 지워지면 안 된다. `connectInterrupts` 자체의 순서는 `worker/interrupt-buffer.test.ts`가 본다.
 */
import type { PyodideInterface } from "pyodide";
import type { PyProxy } from "pyodide/ffi";
import {
  acknowledgeInterrupt,
  createInterruptBuffer,
  discardPendingInterrupt,
  readRequestSeq,
  SIGNAL,
  signalInterrupt,
} from "../protocol/interrupt-protocol";
import { createConsole, type PyodideConsoleProxy } from "../worker/console";
import { loadSplitPaste } from "../worker/multiline";
import {
  type InterruptIdle,
  installSigintHandler,
} from "../worker/sigint-handler";
import { installSleepSlice } from "../worker/sleep-slice";
import {
  createSubmissionRunner,
  type SubmissionRunner,
} from "../worker/submission-runner";
import { suppressWebLoopReraise } from "../worker/webloop-reraise";
import type { PresserCommand, PresserEvent } from "./roles/interrupt-presser";
import { spawnRole } from "./thread";

/**
 * 상한 있는 바쁜 루프(약 0.23초). 핸들러가 잘못돼 SIGINT가 버려져도 시험이 멈추지 않고 단언에서 실패한다.
 * `while True: pass`는 눌림이 소실되면 vitest가 멈출 수 없는 무한 루프가 된다.
 */
export const BUSY = "for _ in range(10**7): pass";

/** `started()`가 참을 돌려주는 최대 시간(ms). `while started(): pass`가 눌림 소실 때 이 시간 뒤에는 끝난다. */
export const STARTED_LIMIT_MS = 5000;

/** 사용자 프로그램 소스를 한 줄 `exec(...)` 제출로 만든다. JSON 문자열은 Python 문자열 리터럴로도 유효하다. */
export const execSource = (program: string) =>
  `exec(${JSON.stringify(program)})`;

/** `<console>` 한 줄 실행이 `KeyboardInterrupt`로 끝났을 때의 정확한 출력. 소스 줄·우리 프레임이 없다. */
export const CONSOLE_TRACEBACK =
  'Traceback (most recent call last):\n  File "<console>", line 1, in <module>\nKeyboardInterrupt\n';

/** [SIGINT, ack, 요청 번호, 예약]. 슬롯 배치는 프로토콜 규약이라 인덱스 그대로 본다. */
export const slots = (buffer: Int32Array) => Array.from(buffer);

export interface SetupOptions {
  topLevelAwait?: boolean;
  /** 핸들러를 설치하기 전에 버퍼를 만진다(이전 세션이 남긴 요청 번호 등). */
  prepare?: (buffer: Int32Array) => void;
  /** 기본 `true`. 거짓이면 `time.sleep` 조각 교체를 하지 않는다(대조·가드 시험용). */
  sleepSlice?: boolean;
  /** 조각 교체·정지한 실행 깨우기가 건너뛴 이유를 받는다. 기본은 `console.warn`이다. */
  warn?: (message: string) => void;
}

/** `wakeAfter`의 결과. `woke`는 `interruptIdle()`이 깨울 것을 찾았는지다. */
export interface WakeOutcome {
  woke: boolean;
}

/** 눌림 스레드 조종기. `presser()`가 돌려준다. */
export interface Presser {
  /** 눌림을 예약한다. 바로 돌아오고, 눌림 스레드가 `started()`를 기다린 뒤 쓴다. */
  press(
    command: Omit<Extract<PresserCommand, { kind: "press" }>, "kind">,
  ): void;
  /** 시작 표시를 지운다(라운드 반복용). */
  reset(): Promise<void>;
  /** 눌림을 다 쓴 뒤의 보고를 기다린다. */
  done(): Promise<PresserEvent>;
}

export interface ConsoleRunner {
  /** 한 줄 제출. `createSubmissionRunner`의 `run`이다. */
  run: SubmissionRunner["run"];
  /** 이 조립이 모은 화면 바이트. sink가 붙이는 개행까지 그대로다. */
  screen: { stdout: string; stderr: string };
  buffer: Int32Array;
  pyconsole: PyodideConsoleProxy;
  /** 눌림 스레드를 띄운다. 시험이 끝나면 종료된다. */
  presser: () => Presser;
  /** 설치가 돌려준 Python `interrupt_idle`. `teardownConsoleRunner`가 destroy한다. */
  interruptIdle: InterruptIdle;
  /**
   * `ms` 뒤에 감시 타이머(03-ctrl-c.md 2.5)의 한 틱을 흉내낸다: `signalInterrupt` → `interruptIdle()` → 깨웠으면
   * SIGINT를 소비하고(`compareExchange(2 → 0)`) 소비에 성공했을 때만 ack. 깨우지 못했으면 SIGINT를 남겨 재개한
   * 사용자 스택의 폴링이 받게 한다. JSPI로 정지한 동안에는 JS 이벤트 루프가 비어 같은 스레드 타이머로 충분하다.
   */
  wakeAfter: (ms: number) => Promise<WakeOutcome>;
}

/** `wakeAfter`가 건 타이머와 설치가 돌려준 proxy. `teardownConsoleRunner`가 치운다. */
const pendingWakes: ReturnType<typeof setTimeout>[] = [];
const liveInterruptIdles: InterruptIdle[] = [];

// 설치는 pyodide 모듈 전역 `pyodide.ffi.run_sync`·`pyodide.webloop.run_sync`를 래퍼로 바꾼다. 파일 하나가 pyodide
// 인스턴스를 공유하므로 되돌리지 않으면 setup마다 래퍼가 겹쌓인다. 첫 설치 전 값을 모듈 속성에 한 번 붙잡아 두고
// 해체가 그것으로 되돌린다.
const SAVE_RUN_SYNC = `import pyodide.ffi

if not hasattr(pyodide.ffi, '_test_original_run_sync'):
    pyodide.ffi._test_original_run_sync = pyodide.ffi.run_sync
`;
const RESTORE_RUN_SYNC = `import pyodide.ffi
import pyodide.webloop

original = getattr(pyodide.ffi, '_test_original_run_sync', None)
if original is not None:
    pyodide.ffi.run_sync = original
    pyodide.webloop.run_sync = original
`;

/** 사용자 globals를 오염시키지 않도록 버리는 namespace에서 돌린다. */
function runInScratch(
  pyodide: Pick<PyodideInterface, "runPython" | "toPy">,
  source: string,
): void {
  const namespace = pyodide.toPy({}) as PyProxy;
  try {
    pyodide.runPython(source, {
      globals: namespace,
      filename: "<sigint-setup>",
    });
  } finally {
    namespace.destroy();
  }
}

/** `installSigintHandler` 전에 부른다. 첫 설치 전의 `run_sync`를 한 번만 붙잡아 둔다(이미 있으면 유지). */
export function saveRunSync(
  pyodide: Pick<PyodideInterface, "runPython" | "toPy">,
): void {
  runInScratch(pyodide, SAVE_RUN_SYNC);
}

/** `afterEach`에서 부른다. `saveRunSync`가 붙잡은 값으로 래퍼 층을 걷어낸다. 저장한 적이 없으면 아무것도 하지 않는다. */
export function restoreRunSync(
  pyodide: Pick<PyodideInterface, "runPython" | "toPy">,
): void {
  runInScratch(pyodide, RESTORE_RUN_SYNC);
}

/**
 * 콘솔 + interrupt buffer + SIGINT 핸들러 + 제출 러너를 조립한다. Python 전역 `press`·`resend`·`started`를 심어
 * 시나리오가 같은 스레드에서 눌림을 만들거나 눌림 스레드에 시작을 알릴 수 있게 한다.
 */
export function setupConsoleRunner(
  pyodide: PyodideInterface,
  {
    topLevelAwait = false,
    prepare,
    sleepSlice = true,
    warn = (message: string) => console.warn(message),
  }: SetupOptions = {},
): ConsoleRunner {
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
    { topLevelAwait },
  );
  // KeyboardInterrupt를 잡고 계속 도는 프로그램·`except` 밖으로 새는 눌림 시험이 WebLoop 재보고로 처리되지 않은
  // Promise 거부를 남기지 않도록 worker와 같은 순서로 설치한다(03-ctrl-c.md 2.8).
  suppressWebLoopReraise(pyodide, { warn: (message) => console.warn(message) });
  const buffer = createInterruptBuffer();
  prepare?.(buffer);
  saveRunSync(pyodide);
  // 조각 래퍼의 코드 객체를 핸들러의 절단 목록에 넘겨야 하므로 조각 교체가 핸들러보다 먼저다(`connectInterrupts`와 같다).
  const codes = sleepSlice ? installSleepSlice(pyodide, { warn }) : undefined;
  const interruptIdle = installSigintHandler(
    pyodide,
    repl.pyconsole,
    {
      ack: () => acknowledgeInterrupt(buffer),
      seq: () => readRequestSeq(buffer),
      warn,
    },
    codes,
  );
  liveInterruptIdles.push(interruptIdle);
  codes?.destroy();
  pyodide.setInterruptBuffer(buffer);

  // 실제 sink(readline.println)처럼 writeOutput/writeError가 끝에 개행을 붙인다.
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

  // 실행 중인 Python에서 부르는 JS 콜백. `press`는 main이 Ctrl+C마다 쓰는 것, `resend`는 main의 재전송(같은 요청 번호로
  // SIGINT 슬롯만 다시 쓴다)이다.
  pyodide.globals.set("press", () => signalInterrupt(buffer));
  pyodide.globals.set("resend", () => {
    Atomics.compareExchange(buffer, 0, 0, 2);
  });
  // 눌림 스레드에 "Python이 시나리오에 들어갔다"를 알린다. 참을 돌려주는 동안 `while started(): pass`가 돈다.
  const ctl = new Int32Array(new SharedArrayBuffer(4));
  let firstCallAt: number | undefined;
  pyodide.globals.set("started", () => {
    Atomics.store(ctl, 0, 1);
    Atomics.notify(ctl, 0);
    firstCallAt ??= performance.now();
    return performance.now() - firstCallAt < STARTED_LIMIT_MS;
  });

  function presser(): Presser {
    const role = spawnRole("interrupt-presser", { buffer, ctl });
    return {
      press(command): void {
        role.post({ kind: "press", ...command } satisfies PresserCommand);
      },
      async reset(): Promise<void> {
        firstCallAt = undefined;
        role.post({ kind: "reset" } satisfies PresserCommand);
        await role.next();
      },
      done: () => role.next<PresserEvent>(),
    };
  }

  function wakeAfter(ms: number): Promise<WakeOutcome> {
    return new Promise<WakeOutcome>((resolve) => {
      pendingWakes.push(
        setTimeout(() => {
          signalInterrupt(buffer);
          const woke = interruptIdle();
          // 깨웠을 때만 소비한다. 소비에 성공한 틱만 ack한다(03-ctrl-c.md 2.2의 ack 지점 ②).
          if (woke && Atomics.compareExchange(buffer, SIGNAL, 2, 0) === 2) {
            acknowledgeInterrupt(buffer);
          }
          resolve({ woke });
        }, ms),
      );
    });
  }

  return {
    run,
    screen,
    buffer,
    pyconsole: repl.pyconsole,
    presser,
    interruptIdle,
    wakeAfter,
  };
}

/**
 * `afterEach`용 해체. 남은 SIGINT가 다음 시험의 Python 실행을 끊지 않도록 버퍼를 먼저 떼고 비운 뒤 핸들러를
 * 기본으로 되돌린다. 아직 터지지 않은 `wakeAfter` 타이머와 살아 있는 `interrupt_idle` proxy도 함께 치운다.
 */
export function teardownConsoleRunner(
  pyodide: PyodideInterface,
  buffer: Int32Array | undefined,
): void {
  for (const timer of pendingWakes.splice(0)) clearTimeout(timer);
  for (const idle of liveInterruptIdles.splice(0)) idle.destroy();
  pyodide.setInterruptBuffer(
    undefined as unknown as Parameters<
      PyodideInterface["setInterruptBuffer"]
    >[0],
  );
  if (buffer) discardPendingInterrupt(buffer);
  pyodide.runPython(
    "import signal\nsignal.signal(signal.SIGINT, signal.default_int_handler)",
  );
  // Python을 돌리므로 버퍼를 뗀 뒤에 되돌린다.
  restoreRunSync(pyodide);
}
