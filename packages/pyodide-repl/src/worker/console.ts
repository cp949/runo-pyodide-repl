/**
 * worker 쪽 콘솔 코어(02-console-core.md 5.1·5.4). `PyodideConsole`을 만들어 콜백을 sink에 잇고, `sys.ps1/ps2`·배너·
 * TLA 비트를 갖추며, `push()` 결과를 Python `await_fut` 헬퍼로만 await하는 `runLine`을 제공한다.
 * 취소·여러 줄 제출·값 에코·안전망은 이 위에 RD-005의 `submission-runner`가 얹는다.
 */
import type { PyodideInterface } from "pyodide";
import type { PyProxy } from "pyodide/ffi";
import { createSinkWriter } from "./sink-writer";
import { setTopLevelAwait, type CompilerFlagsHolder } from "./top-level-await";

/** 콘솔 콜백과 전역 스트림이 같이 쓰는 sink 둘. worker에서는 RPC `notify` 래퍼다. */
export interface ConsoleSinks {
  write(text: string): void;
  writeErrorRaw(text: string): void;
}

export interface ConsoleOptions {
  /** 초기화 프레임의 `topLevelAwait`. 콘솔 생성 직후 한 번만 적용한다. */
  topLevelAwait: boolean;
}

export type SyntaxCheck = "incomplete" | "syntax-error" | "complete";

export interface ConsoleFutureProxy extends PyProxy {
  readonly syntax_check: SyntaxCheck;
  readonly formatted_error: string | undefined;
}

export interface PyodideConsoleProxy extends PyProxy, CompilerFlagsHolder {
  stdout_callback: ((text: string) => void) | undefined;
  stderr_callback: ((text: string) => void) | undefined;
  push(line: string): ConsoleFutureProxy;
}

export type RunLineResult =
  | { kind: "incomplete" }
  /** pyodide `formatted_error` 그대로(끝 개행 포함). 개행 제거는 호출부(RD-005)가 한다. */
  | { kind: "syntax-error"; formattedError: string }
  /** `exited`는 `SystemExit`(`exit()`/`quit()`)다. */
  | { kind: "complete"; value: unknown; exited: boolean }
  | { kind: "error"; formattedError: string };

export interface ReplConsole {
  /** `pyodide.console.BANNER`. 끝 개행 없음. `writeOutput`으로 낸다(sink가 개행을 붙인다, TRAP-29). */
  readonly banner: string;
  readonly pyconsole: PyodideConsoleProxy;
  /** 한 줄을 push하고 결과를 기다린다. `ConsoleFuture`는 Python `await_fut`로만 await한다. */
  runLine(source: string): Promise<RunLineResult>;
}

/** pyodide.globals에서 실행한다. `sys`가 사용자 전역에 남는 편차 22는 유지한다(10-parity-deviations.md). */
const PROMPT_SETUP = 'import sys\nsys.ps1 = ">>> "\nsys.ps2 = "... "\n';

// ConsoleFuture를 JS에서 직접 await하지 않는다(TRAP-02). 값이 None이 아니면 builtins._를 갱신한다.
// SystemExit은 [None, True]로 돌려 exit()/quit()를 구분한다.
const AWAIT_FUT_SOURCE = `
import builtins
from pyodide.ffi import to_js

async def await_fut(fut):
    try:
        res = await fut
    except SystemExit:
        return to_js([None, True], depth=1)
    if res is not None:
        builtins._ = res
    return to_js([res, False], depth=1)

await_fut
`;

/**
 * 순서: 전역 stdout/stderr Writer 등록 → `sys.ps1/ps2` → `PyodideConsole(pyodide.globals)` + 콜백 → TLA 비트 →
 * `await_fut` namespace. 동기 함수다. 세션마다 한 번 부른다.
 */
export function createConsole(
  pyodide: PyodideInterface,
  sinks: ConsoleSinks,
  options: ConsoleOptions,
): ReplConsole {
  pyodide.setStdout(createSinkWriter((text) => sinks.write(text)));
  pyodide.setStderr(createSinkWriter((text) => sinks.writeErrorRaw(text)));
  pyodide.runPython(PROMPT_SETUP);
  const consoleModule = pyodide.pyimport("pyodide.console") as PyProxy & {
    BANNER: string;
    PyodideConsole: (globals: PyProxy) => PyodideConsoleProxy;
  };
  const pyconsole = consoleModule.PyodideConsole(pyodide.globals);
  pyconsole.stdout_callback = (text) => sinks.write(text);
  pyconsole.stderr_callback = (text) => sinks.writeErrorRaw(text);
  setTopLevelAwait(pyconsole, options.topLevelAwait);
  // 별도 namespace(빈 dict)에서 정의해 사용자 globals를 오염시키지 않는다. 마지막 식의 값(함수 proxy)이 돌아온다.
  const awaitFut = pyodide.runPython(AWAIT_FUT_SOURCE, {
    globals: pyodide.toPy({}),
  }) as (fut: ConsoleFutureProxy) => Promise<[unknown, boolean]>;

  return {
    banner: consoleModule.BANNER,
    pyconsole,
    async runLine(source) {
      const fut = pyconsole.push(source);
      try {
        if (fut.syntax_check === "incomplete") return { kind: "incomplete" };
        if (fut.syntax_check === "syntax-error") {
          return {
            kind: "syntax-error",
            formattedError: fut.formatted_error ?? "",
          };
        }
        try {
          const [value, exited] = await awaitFut(fut);
          return { kind: "complete", value, exited };
        } catch {
          // 오류 문자열은 e.message가 아니라 fut.formatted_error(내부 프레임이 잘린 것)를 쓴다.
          return { kind: "error", formattedError: fut.formatted_error ?? "" };
        }
      } finally {
        fut.destroy();
      }
    },
  };
}
