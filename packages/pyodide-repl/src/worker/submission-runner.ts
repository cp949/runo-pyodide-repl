/**
 * 제출 한 번의 실행 규칙(02-console-core.md 5.2). worker 루프가 `readLine`으로 받은 값(`string | null`)을 그대로 `run()`에
 * 넘기면 `null` 취소 → 콘솔 실행 → 화면 규칙(값 에코 `writeOutput`, 오류 `writeError`)으로 옮기고 다음 프롬프트와
 * `exit`·`pending`을 돌려준다. 한 줄 제출만 다룬다(여러 줄 분할은 RD-011). `run()` 전체를 `KeyboardInterrupt` 안전망으로
 * 감싸 사용자 코드 밖에서 새는 인터럽트가 worker 루프를 죽이지 않게 한다(TRP-009).
 */
import type { PyodideInterface } from "pyodide";
import type { ReplConsole } from "./console";

export const PS1 = ">>> ";
export const PS2 = "... ";

/**
 * 둘 다 끝 개행 없는 텍스트를 받는다(05-output.md 4.1). sink(`readline.println`)가 개행을 붙이므로 끝 개행을 붙여
 * 넘기면 프롬프트 앞에 빈 줄이 하나 더 생긴다. worker에서는 RPC `notify` 래퍼다.
 */
export interface SubmissionIO {
  writeOutput(text: string): void;
  writeError(text: string): void;
}

export interface SubmissionResult {
  prompt: string;
  exit: boolean;
  /** 블록 입력 중일 때만. `repl.pending()` 그대로(main의 자동 들여쓰기·Tab 완성이 쓴다). */
  pending?: string;
}

export interface SubmissionRunner {
  /** `null`은 입력 취소 신호다: 미완성 블록을 버리고 `>>> `로 돌아간다. worker 루프는 줄과 신호를 구분하지 않는다. */
  run(line: string | null): Promise<SubmissionResult>;
}

/** 오류 문자열은 끝 개행이 하나 붙어 온다. 그 하나만 떼고, 메시지 자체의 개행은 CPython처럼 남긴다. */
function withoutTrailingNewline(text: string): string {
  return text.endsWith("\n") ? text.slice(0, -1) : text;
}

export function createSubmissionRunner(
  pyodide: Pick<PyodideInterface, "ffi">,
  repl: Pick<ReplConsole, "runLine" | "pending" | "clearPending">,
  io: SubmissionIO,
): SubmissionRunner {
  /** 미완성 블록을 버리고 `KeyboardInterrupt`만 쓴다(3.14 REPL이 프롬프트에서 취소할 때와 같다, 트레이스백 없음). */
  function cancel(): SubmissionResult {
    repl.clearPending();
    io.writeError("KeyboardInterrupt");
    return { prompt: PS1, exit: false };
  }

  /**
   * JS↔Python 변환 중에 끊기면 `KeyboardInterrupt`가 `ConversionError`에 감싸여 `err.type`이 달라진다.
   * 메시지의 연쇄 예외 출력에서 단독 `KeyboardInterrupt` 줄로도 판별한다.
   */
  function isKeyboardInterrupt(err: unknown): boolean {
    return (
      err instanceof pyodide.ffi.PythonError &&
      (err.type === "KeyboardInterrupt" ||
        /^KeyboardInterrupt\s*$/m.test(err.message))
    );
  }

  /** 취소 처리 자체가 다시 끊기면 buffer 정리는 포기하고 출력만 낸다(SIGINT는 이미 소비됐다). */
  function recoverFromInterrupt(): SubmissionResult {
    try {
      return cancel();
    } catch (err) {
      if (!isKeyboardInterrupt(err)) throw err;
      io.writeError("KeyboardInterrupt");
      return { prompt: PS1, exit: false };
    }
  }

  return {
    async run(line) {
      try {
        // `push(null)`은 콘솔 buffer를 `JsNull`로 오염시키므로 `null` 분기가 가장 먼저다.
        if (line === null) return cancel();
        const result = await repl.runLine(line);
        switch (result.kind) {
          case "incomplete":
            return { prompt: PS2, exit: false, pending: repl.pending() };
          case "syntax-error":
          case "error":
            io.writeError(withoutTrailingNewline(result.formattedError));
            return { prompt: PS1, exit: false };
          case "complete":
            if (result.echo !== null) io.writeOutput(result.echo);
            return { prompt: PS1, exit: result.exited };
        }
      } catch (err) {
        if (!isKeyboardInterrupt(err)) throw err;
        return recoverFromInterrupt();
      }
    },
  };
}
