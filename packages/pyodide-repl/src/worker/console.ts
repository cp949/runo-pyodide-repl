/**
 * worker 쪽 콘솔 코어(02-console-core.md 5.1·5.4). `PyodideConsole`을 만들어 콜백을 sink에 잇고, `sys.ps1/ps2`·배너·
 * TLA 비트를 갖추며, `push()` 결과를 Python `await_fut` 헬퍼로만 await하는 `runLine`을 제공한다.
 * 값 에코 문자열(`repr()` 전체)과 EOF에서 끊긴 문법 오류의 표준 문구 정규화도 Python 헬퍼가 만든다.
 * 취소·안전망은 이 위에 RD-005의 `submission-runner`가 얹는다.
 */
import type { PyodideInterface } from "pyodide";
import type { PyProxy } from "pyodide/ffi";
import { createSinkWriter } from "./sink-writer";
import { setTopLevelAwait, type CompilerFlagsHolder } from "./top-level-await";
import HELPERS_SOURCE from "./console-helpers.py?raw";

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
  /** 접근할 때마다 새 proxy다. 쓴 뒤 `destroy()`한다(02-console-core.md 5.1). */
  readonly buffer: PyProxy & {
    readonly length: number;
    clear(): void;
    toJs(): string[];
  };
}

export type RunLineResult =
  | { kind: "incomplete" }
  /** 표준 문구로 정규화한 문법 오류(끝 개행 포함). 개행 제거는 호출부(러너)가 한다. */
  | { kind: "syntax-error"; formattedError: string }
  /** `echo`는 값의 `repr()` 전체다. 값이 `None`이거나 `exited`면 null. `exited`는 `SystemExit`(`exit()`/`quit()`)다. */
  | { kind: "complete"; echo: string | null; exited: boolean }
  /** 실행 예외 또는 `repr` 예외의 트레이스백(끝 개행 포함, 내부 프레임 없음). */
  | { kind: "error"; formattedError: string };

export interface ReplConsole {
  /** `pyodide.console.BANNER`. 끝 개행 없음. `writeOutput`으로 낸다(sink가 개행을 붙인다, TRAP-29). */
  readonly banner: string;
  readonly pyconsole: PyodideConsoleProxy;
  /** 한 줄을 push하고 결과를 기다린다. `ConsoleFuture`는 Python `await_fut`로만 await한다. */
  runLine(source: string): Promise<RunLineResult>;
  /** 블록 입력 중이면 콘솔 buffer의 줄들을 `\n`으로 이은 텍스트, 아니면 undefined. */
  pending(): string | undefined;
  /** 미완성 블록을 버린다(`buffer.clear()`). 블록이 없어도 안전하다. */
  clearPending(): void;
}

/** `formatted_error`의 마지막 줄이 이것이면 재컴파일로 정규화한다. */
export const INCOMPLETE_INPUT_MARKER =
  "_IncompleteInputError: incomplete input";
/** codeop이 최종 컴파일에서 끄는 두 비트: ALLOW_INCOMPLETE_INPUT(0x4000) | DONT_IMPLY_DEDENT(0x200). */
export const INCOMPLETE_INPUT_FLAGS = 0x4200;

/** pyodide.globals에서 실행한다. `sys`가 사용자 전역에 남는 편차 22는 유지한다(10-parity-deviations.md). */
const PROMPT_SETUP = 'import sys\nsys.ps1 = ">>> "\nsys.ps2 = "... "\n';

// ConsoleFuture를 JS에서 직접 await하지 않는다(TRAP-02). 결과는 [echo, exited, error] 세 값이다(None은 JS의 undefined).
// SystemExit은 [None, True, None]으로 돌려 exit()/quit()를 구분한다. 값이 None이 아니면 repr() 전체를 echo로 만들고
// 성공한 뒤에만 builtins._를 갱신한다. repr가 예외를 내면 error에 트레이스백을 담고 _는 건드리지 않는다.
// format_syntax_error는 pyrepl처럼 끝 개행을 붙여(없으면 캐럿 줄이 사라진다) codeop의 최종 컴파일과 같은 플래그로 재컴파일한다.
// retrieve_exception은 await하지 않는 문법 오류 future의 예외를 회수한다. 그대로 두면 사이클 GC 때 asyncio가
// "ConsoleFuture exception was never retrieved"를 sys.stderr로 내 터미널에 끼어든다(JS에서 부르면 예외 proxy를 destroy해야 해 Python에 둔다).

/** `await_fut`가 돌려주는 세 값. Python `None`은 JS `undefined`로 온다. */
type AwaitFutResult = [
  echo: string | undefined,
  exited: boolean,
  error: string | undefined,
];

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
  // 별도 namespace(빈 dict)에서 정의해 사용자 globals를 오염시키지 않는다. 함수는 세션 동안 쓰므로 proxy를 유지한다.
  const namespace = pyodide.toPy({}) as PyProxy & {
    get(name: string): unknown;
  };
  pyodide.runPython(HELPERS_SOURCE, {
    globals: namespace,
    filename: "<console-helpers>",
  });
  const awaitFut = namespace.get("await_fut") as (
    fut: ConsoleFutureProxy,
  ) => Promise<AwaitFutResult>;
  const formatSyntaxError = namespace.get("format_syntax_error") as (
    source: string,
    flags: number,
  ) => string | undefined;
  const retrieveException = namespace.get("retrieve_exception") as (
    fut: ConsoleFutureProxy,
  ) => void;

  function pending(): string | undefined {
    const buffer = pyconsole.buffer;
    try {
      return buffer.length > 0 ? buffer.toJs().join("\n") : undefined;
    } finally {
      buffer.destroy();
    }
  }

  /**
   * pyodide는 EOF에서 끊긴 문법 오류를 `_IncompleteInputError: incomplete input`으로 표시한다. 3.14 REPL은
   * `SyntaxError: invalid syntax`이므로 그 경우만 재컴파일한 문구로 바꾼다. 재컴파일이 오류 없이 끝나거나 실패하면 원문이다.
   * `pending`은 push 전에 읽은 buffer(push가 끝나면 buffer는 비워진다)다.
   */
  function normalizeSyntaxError(
    raw: string,
    pendingBefore: string | undefined,
    source: string,
  ): string {
    const lines = raw.replace(/\n$/, "").split("\n");
    if (lines[lines.length - 1] !== INCOMPLETE_INPUT_MARKER) return raw;
    const whole =
      pendingBefore === undefined ? source : `${pendingBefore}\n${source}`;
    try {
      return (
        formatSyntaxError(
          whole,
          pyconsole._compile.compiler.flags & ~INCOMPLETE_INPUT_FLAGS,
        ) ?? raw
      );
    } catch {
      return raw;
    }
  }

  return {
    banner: consoleModule.BANNER,
    pyconsole,
    pending,
    clearPending() {
      const buffer = pyconsole.buffer;
      try {
        buffer.clear();
      } finally {
        buffer.destroy();
      }
    },
    async runLine(source) {
      const pendingBefore = pending();
      const fut = pyconsole.push(source);
      try {
        if (fut.syntax_check === "incomplete") return { kind: "incomplete" };
        if (fut.syntax_check === "syntax-error") {
          retrieveException(fut);
          return {
            kind: "syntax-error",
            formattedError: normalizeSyntaxError(
              fut.formatted_error ?? "",
              pendingBefore,
              source,
            ),
          };
        }
        try {
          const [echo, exited, error] = await awaitFut(fut);
          if (error !== undefined)
            return { kind: "error", formattedError: error };
          return { kind: "complete", echo: echo ?? null, exited };
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
