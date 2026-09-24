/**
 * 실행 driver의 worker 쪽(RD-022). 앱의 worker 파일이 `runWorker({ driver: runDriver })`로 쓴다. main이 RPC `runCode(source)`로
 * 코드 한 덩어리를 보내면 새 globals에서 `CodeRunner(exec, filename)` + `console.runcode`로 실행하고 결말(`RunOutcome`)을
 * 돌려준다. REPL의 `ConsoleFuture`·`runsource` 경로를 거치지 않으므로 `sigint-handler.py`의 `runcode` 래퍼·`formattraceback`
 * 교체·SIGINT 규칙 ①이 그대로 성립한다(가설 시험 `run-driver-pyodide.test.ts`). 결과 분류와 stderr 쓰기는 `run-driver.py`가 한다.
 *
 * 세션은 `run(ctx)`가 끝나지 않는 Promise로 산다: REPL과 달리 제어 흐름이 없고 요청(`runCode`)마다 일한다. 종료는 main이
 * worker를 끝낼 때다. `restarted`는 main이 만드는 결말이라 여기에는 없다.
 */
import type { PyodideInterface } from "pyodide";
import type { PyProxy } from "pyodide/ffi";
import {
  parseRunDriverOptions,
  type RunDriverOptions,
} from "../protocol/run-driver-options";
import {
  createCoreConsole,
  installStdioWriters,
  type PyodideConsoleProxy,
} from "./core-console";
import type { WorkerDriver, WorkerDriverSession } from "./driver";
import RUN_DRIVER_SOURCE from "./run-driver.py?raw";

export type { RunDriverOptions } from "../protocol/run-driver-options";

/**
 * `runCode`가 코드가 실행됐을 때의 결말로 돌려주는 값. `errorType`은 처리되지 않은 예외의 클래스 이름이고 `SyntaxError`의
 * 하위 클래스(`IndentationError`·`TabError`)는 `"SyntaxError"`로 통일한다(구체 이름은 `traceback`에 있다). 처리되지 않은
 * `KeyboardInterrupt`는 출처와 무관하게 `interrupted`다. `SystemExit`는 CPython 규칙(`None` → 0, `int` → 그 값, 그 밖 → 1 +
 * stderr에 `str(코드)`)으로 `exit`이다. `code`가 int32 범위 밖이면 OS가 보는 값(하위 8비트)으로 줄인다.
 */
export type RunOutcome =
  | { kind: "ok" }
  | { kind: "error"; errorType: string; traceback: string }
  | { kind: "interrupted"; traceback: string }
  | { kind: "exit"; code: number };

export interface RunSession extends WorkerDriverSession {
  /** `run()`이 돌려준 Promise를 끝낸다(시험용). 프로덕션에서는 main이 worker를 종료할 때까지 세션이 살아 있다. */
  end(): void;
}

/** Python `run_code`가 돌려주는 `[kind, error_type, traceback, code]`(None은 JS `undefined`). */
type RawOutcome = [
  string,
  string | undefined,
  string | undefined,
  number | bigint | undefined,
];

type RunCodePy = PyProxy &
  ((
    console: PyodideConsoleProxy,
    source: string,
    filename: string,
    topLevelAwait: boolean,
  ) => Promise<RawOutcome>);

/** driver Python이 만든 결말을 검증하며 `RunOutcome`으로 바꾼다. 형식이 어긋나면 던진다(RPC 오류로 나간다). */
function toOutcome([kind, errorType, traceback, code]: RawOutcome): RunOutcome {
  switch (kind) {
    case "ok":
      return { kind };
    case "error":
      if (typeof errorType === "string" && typeof traceback === "string") {
        return { kind, errorType, traceback };
      }
      break;
    case "interrupted":
      if (typeof traceback === "string") return { kind, traceback };
      break;
    case "exit":
      if (typeof code === "number") return { kind, code };
      break;
  }
  throw new Error(`실행 driver 결과 형식 오류 — kind: ${kind}`);
}

export function createRunSession(options: RunDriverOptions): RunSession {
  let running = false;
  let runCodePy: RunCodePy | undefined;
  let pyconsole: PyodideConsoleProxy | undefined;
  let end!: () => void;
  const ended = new Promise<void>((resolve) => {
    end = resolve;
  });

  return {
    handlers: {
      async runCode(source: unknown): Promise<RunOutcome> {
        if (typeof source !== "string") {
          throw new TypeError("runCode 인자 오류 — source: 문자열 필요");
        }
        // 재진입 거부는 main의 `busy` 검사가 놓친 경우의 방어다. 첫 await 전에 동기로 판정한다.
        if (running) throw new Error("runCode 재진입 거부 — 이미 실행 중이다");
        if (!runCodePy || !pyconsole) throw new Error("콘솔이 아직 없다");
        running = true;
        try {
          return toOutcome(
            await runCodePy(
              pyconsole,
              source,
              options.filename,
              options.topLevelAwait,
            ),
          );
        } finally {
          running = false;
        }
      },
    },
    createConsole({ pyodide, sinks }) {
      installStdioWriters(pyodide, sinks);
      pyconsole = createCoreConsole(pyodide, sinks, {
        filename: options.filename,
      });
      runCodePy = loadRunCode(pyodide);
      return pyconsole;
    },
    // 요청 단위로 일하는 세션이라 제어 흐름이 없다: 끝나라는 신호까지 산다(끝나면 core가 감시 타이머를 멈춘다).
    run: () => ended,
    // 실행 중이 아니면 대상 Python 코드가 없다(03-ctrl-c.md 2.5). 실행 뒤 남은 asyncio task·타이머 콜백이 도는 동안도 참이다.
    atPrompt: () => !running,
    end,
  };
}

/** driver Python을 별도 namespace(빈 dict)에서 정의해 사용자 globals를 오염시키지 않는다. 함수는 세션 동안 쓴다. */
function loadRunCode(pyodide: PyodideInterface): RunCodePy {
  const namespace = pyodide.toPy({}) as PyProxy & { get(name: string): unknown };
  try {
    pyodide.runPython(RUN_DRIVER_SOURCE, {
      globals: namespace,
      filename: "<run-driver>",
    });
    return namespace.get("run_code") as RunCodePy;
  } finally {
    namespace.destroy();
  }
}

export const runDriver: WorkerDriver<RunDriverOptions> = {
  parseOptions: parseRunDriverOptions,
  createSession: createRunSession,
};
