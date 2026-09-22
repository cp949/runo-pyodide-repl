/**
 * REPL 한 세션의 제어 흐름(00-architecture.md 3.2).
 * 통신·프로토콜 구현은 import하지 않고 `readLine`·`setAtPrompt`·`discardPendingInterrupt`만 주입받는다. 따라서 RPC
 * 종료·브라우저 worker·node 시험이 같은 프롬프트 갱신 규칙을 쓴다. 여러 줄 분할(붙여넣기·Shift+Enter·히스토리
 * 재호출)은 `submission-runner.ts`의 `run()`이 처리하고 이 루프는 결과의 `prompt`·`pending`만 그대로 옮긴다.
 */
import { PS1, type SubmissionResult } from "./submission-runner";

export interface ReplLoopDeps {
  /** RPC `readLine(prompt, pending, true)`. 요청 채널이 사라지면 reject되어 루프가 끝난다. */
  readLine(prompt: string, pending: string | undefined): Promise<string | null>;
  /**
   * `readLine` 요청 직전 `true`, 응답 직후(`null`에도)·`discardPendingInterrupt` 전 `false`. 감시 타이머(03-ctrl-c.md
   * 2.5)의 프롬프트 유휴 폐기가 읽는다. `readLine`이 reject로 끝나면 되돌리지 않는다(루프 종료 뒤 타이머도 꺼진다).
   */
  setAtPrompt(value: boolean): void;
  /**
   * `readLine` 응답 직후·`run` 전에 부른다(`null`에도). 읽는 동안이나 Enter 직후 쓴 SIGINT는 대상 코드가 없어 다음 문장의
   * 컴파일·실행을 끊는다(TRP-009). `boot.ts`가 `discardPendingInterrupt(buffer)`를 넣는다.
   */
  discardPendingInterrupt(): void;
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
    deps.setAtPrompt(true);
    try {
      line = await deps.readLine(prompt, pending);
    } catch (error) {
      if (!isRpcDisposed(error)) {
        console.error("[repl.worker] readLine 실패", error);
      }
      return;
    }
    deps.setAtPrompt(false);

    // 읽기가 끝난 순간부터 `run`이 시작하기 전까지 도착한 눌림을 비운다. `run` 안(사용자 코드 실행)의 눌림은 비우지 않는다.
    deps.discardPendingInterrupt();

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
