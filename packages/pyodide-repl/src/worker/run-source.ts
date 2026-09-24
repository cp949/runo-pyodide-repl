/**
 * REPL 루프 명령 `{ source }`의 실행기(RD-022a). core `exec_in_console`(runner와 공용 컴파일·`console.runcode`·결말 분류)을 REPL
 * 콘솔에 붙인다. runner와 달리 이름공간(`pyodide.globals`)·`sys.stdin`을 바꾸지 않아 REPL 명령과 같은 세계에서 돈다. 파일명은
 * `console.filename`(`<console>`)이라 SIGINT 규칙 ①(03-ctrl-c.md 2.4)·`formattraceback` 절단이 평소 명령 실행과 같게 성립한다
 * (TRP-020). 마지막 식 값을 에코하지 않고 `builtins._`를 바꾸지 않는다(exec 모드).
 */
import type { PyodideInterface } from "pyodide";
import {
  loadExecInConsole,
  toRunOutcome,
  type RunOutcome,
} from "@cp949/runo-pyodide-core/worker";
import type { ReplConsole } from "./console";
import { TOP_LEVEL_AWAIT_FLAG } from "./top-level-await";

/**
 * `exit()`·`quit()`(site.Quitter)는 `SystemExit`를 올리기 전에 `sys.stdin`을 닫는다. 평소 명령에서는 세션이 끝나 상관없지만
 * `runSource`의 `SystemExit`는 세션을 유지하므로(확정 5) 닫힌 stdin이 다음 `input()`을 `ValueError: I/O operation on closed
 * file.`로 만든다. 닫혀 있을 때만 core runner의 `_reset_stdin`(`run-driver.py`)과 같은 모양(fd 0, `<stdin>`, 라인 버퍼)으로 새로 연다.
 * 사용자가 바꿔 둔 열린 stdin은 건드리지 않는다.
 */
const REOPEN_CLOSED_STDIN = `import io, sys
if sys.stdin is None or sys.stdin.closed:
    raw = io.FileIO(0, "r", closefd=False)
    raw.name = "<stdin>"
    sys.stdin = io.TextIOWrapper(
        io.BufferedReader(raw), encoding="utf-8", errors="strict", line_buffering=True
    )
`;

/** 사용자 globals를 오염시키지 않도록 버리는 namespace에서 돌린다. */
function reopenClosedStdin(pyodide: PyodideInterface): void {
  const namespace = pyodide.toPy({});
  try {
    pyodide.runPython(REOPEN_CLOSED_STDIN, {
      globals: namespace,
      filename: "<repl-reopen-stdin>",
    });
  } finally {
    namespace.destroy();
  }
}

export interface SourceRunner {
  /** 코드 한 덩어리를 REPL 콘솔에서 실행하고 결말을 돌려준다. worker 내부 오류는 던진다(사용자 코드의 오류는 결말이다). */
  run(source: string): Promise<RunOutcome>;
  /** Python 함수 proxy를 놓는다. 세션이 끝날 때 한 번 부른다(두 번째부터는 무동작). */
  destroy(): void;
}

/**
 * 세션마다 한 번 만든다(Python 소스를 한 번만 올리고 함수를 세션 동안 쓴다). TLA는 `run` 때마다 콘솔의 현재 컴파일러 플래그에서
 * 읽는다: `compilerFlags()`는 `_compile.compiler.flags`(pyodide 비공개 경로)를 읽고, 경로가 없으면(`compiler-flags` 저하)
 * pyodide 기본 그대로 TLA 켬으로 대체한다.
 */
export function createSourceRunner(
  pyodide: PyodideInterface,
  repl: Pick<ReplConsole, "pyconsole" | "compilerFlags">,
): SourceRunner {
  const execInConsole = loadExecInConsole(pyodide);
  let destroyed = false;
  return {
    async run(source) {
      const topLevelAwait = (repl.compilerFlags() & TOP_LEVEL_AWAIT_FLAG) !== 0;
      const outcome = toRunOutcome(
        await execInConsole(repl.pyconsole, source, topLevelAwait),
      );
      // stdin은 그 밖에는 건드리지 않는다(명령 실행과 같은 stdin 리더). `exit()`가 닫은 경우만 세션 유지에 맞게 되살린다.
      if (outcome.kind === "exit") reopenClosedStdin(pyodide);
      return outcome;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      execInConsole.destroy();
    },
  };
}
