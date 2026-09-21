/**
 * REPL 한 세션의 제어 흐름(00-architecture.md 3.2).
 * 통신 구현은 import하지 않고 `readLine`만 주입받는다. 따라서 RPC 종료·브라우저 worker·node 시험이 같은
 * 프롬프트 갱신 규칙을 쓴다. 여러 줄 분할, Ctrl+C 송신, 감시 타이머는 후속 RD의 책임이다.
 */
import { PS1, type SubmissionResult } from "./submission-runner";

export interface ReplLoopDeps {
  /** RPC `readLine(prompt, pending, true)`. 요청 채널이 사라지면 reject되어 루프가 끝난다. */
  readLine(prompt: string, pending: string | undefined): Promise<string | null>;
  run(line: string | null): Promise<SubmissionResult>;
  /** `exit()`·`quit()`·`SystemExit` 뒤 한 번만 부른다. */
  onTerminated(): void;
  /** 사용자 실행 밖에서 난 오류를 boot가 화면에 알리고 콘솔 상태를 정리한다. */
  onError(error: unknown): void;
}

function isRpcDisposed(error: unknown): boolean {
  return error instanceof Error && error.message === "rpc disposed";
}

/** 읽기 → 한 줄 실행 → 다음 프롬프트 갱신을 세션 종료 또는 RPC 종료까지 반복한다. */
export async function runReplLoop(deps: ReplLoopDeps): Promise<void> {
  let prompt = PS1;
  let pending: string | undefined;

  while (true) {
    let line: string | null;
    try {
      line = await deps.readLine(prompt, pending);
    } catch (error) {
      if (!isRpcDisposed(error)) {
        console.error("[repl.worker] readLine 실패", error);
      }
      return;
    }

    try {
      const result = await deps.run(line);
      if (result.exit) {
        deps.onTerminated();
        return;
      }
      prompt = result.prompt;
      pending = result.pending;
    } catch (error) {
      deps.onError(error);
      prompt = PS1;
      pending = undefined;
    }
  }
}
