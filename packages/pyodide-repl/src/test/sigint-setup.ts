/**
 * SIGINT 시험의 공통 조립(node + 실제 pyodide 전용, 09-testing.md 9.1). `sigint-handler.test.ts`와
 * `sigint-handler-sleep-slice.test.ts`가 같은 콘솔·버퍼·눌림 스레드 조립을 쓴다.
 *
 * 조립 순서는 worker의 `connectInterrupts`(03-ctrl-c.md 2.6)와 같되 개별 호출이다: `installSleepSlice` →
 * `installSigintHandler` → `setInterruptBuffer`. `discard`는 부르지 않는다 — `prepare`로 이전 세션의 요청 번호를
 * 미리 만드는 시험이 폐기에 지워지면 안 된다. `connectInterrupts` 자체의 순서는 `worker/interrupt-buffer.test.ts`가 본다.
 */
import type { PyodideInterface } from "pyodide";
import {
  acknowledgeInterrupt,
  createInterruptBuffer,
  discardPendingInterrupt,
  readRequestSeq,
  signalInterrupt,
} from "../protocol/interrupt-protocol";
import { createConsole, type PyodideConsoleProxy } from "../worker/console";
import { installSigintHandler } from "../worker/sigint-handler";
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
  /** 조각 교체가 건너뛴 이유를 받는다. 기본은 `console.warn`이다. */
  warn?: (message: string) => void;
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
  // 조각 래퍼의 코드 객체를 핸들러의 절단 목록에 넘겨야 하므로 조각 교체가 핸들러보다 먼저다(`connectInterrupts`와 같다).
  const codes = sleepSlice ? installSleepSlice(pyodide, { warn }) : undefined;
  installSigintHandler(
    pyodide,
    repl.pyconsole,
    {
      ack: () => acknowledgeInterrupt(buffer),
      seq: () => readRequestSeq(buffer),
    },
    codes,
  );
  codes?.destroy();
  pyodide.setInterruptBuffer(buffer);

  // 실제 sink(readline.println)처럼 writeOutput/writeError가 끝에 개행을 붙인다.
  const { run } = createSubmissionRunner(pyodide, repl, {
    writeOutput: (text) => {
      screen.stdout += `${text}\n`;
    },
    writeError: (text) => {
      screen.stderr += `${text}\n`;
    },
  });

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

  return { run, screen, buffer, pyconsole: repl.pyconsole, presser };
}

/**
 * `afterEach`용 해체. 남은 SIGINT가 다음 시험의 Python 실행을 끊지 않도록 버퍼를 먼저 떼고 비운 뒤 핸들러를
 * 기본으로 되돌린다.
 */
export function teardownConsoleRunner(
  pyodide: PyodideInterface,
  buffer: Int32Array | undefined,
): void {
  pyodide.setInterruptBuffer(
    undefined as unknown as Parameters<
      PyodideInterface["setInterruptBuffer"]
    >[0],
  );
  if (buffer) discardPendingInterrupt(buffer);
  pyodide.runPython(
    "import signal\nsignal.signal(signal.SIGINT, signal.default_int_handler)",
  );
}
