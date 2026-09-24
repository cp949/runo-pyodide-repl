/**
 * `pyodide.setStdin({ stdin })`에 넘길 동기 stdin 콜백(04-stdin-input.md 3.1). "`readInput` 알림 → 메일박스 대기"
 * 순서와 "취소 표식 → `KeyboardInterrupt`" 변환을 이 모듈이 소유한다(01-protocols.md 1.3). `pyodide`를 import하지 않고
 * core 프로토콜도 import하지 않는다 — `boot.ts`가 RPC 알림·메일박스 리더·SIGINT 클로저 둘을 주입한다.
 *
 * 취소 변환은 콜백 안에서 SIGINT를 쓰고 곧바로 소비한다: `signalInterrupt()`(요청 번호 +1 → SIGINT 2) →
 * `checkInterrupt()`(`pyodide.checkInterrupt()`). GIL이 풀린 콜백 안이라 `checkInterrupt()`는 `FS.ErrnoError(EINTR)`를
 * 던지고, CPython이 EINTR 뒤 신호를 처리해 `input()` 호출 지점에서 `KeyboardInterrupt`를 올린다(PEP 475).
 *
 * 이전 구현이 확인한 금지된 대안 5종(TRP-014):
 * - SIGINT(2)만 쓰고 정상 반환: 폴링 시점이 읽기 밖이라 HANG 또는 엉뚱한 프레임에서 중단된다.
 * - 일반 `Error`를 던진다: `input()`에서 `OSError`가 된다.
 * - `null`을 그대로 돌려준다: `EOFError`가 된다(취소가 아니다).
 * - `errno`만 가진 `Error`를 던진다: pyodide가 죽는다.
 * - 버퍼 없이 `FS.ErrnoError`만 던진다: CPython이 신호를 못 찾아 읽기를 무한 재시도한다.
 */

export interface StdinCallbackDeps {
  /** `readInput` 알림. `wait()`보다 먼저 부른다(01-protocols.md 1.3 — postMessage는 호출 즉시 큐에 들어가므로 뒤이어 정지해도 전달된다). */
  requestInput(cancelable: boolean): void;
  /** 메일박스 대기(`Atomics.wait`). 한 줄 또는 취소 표식(`null`). 오류 표식이면 `Error`를 던진다. */
  wait(): string | null;
  /**
   * 요청 번호를 올린 뒤 SIGINT(2)를 쓴다. `boot.ts`가 `() => signalInterrupt(interruptBuffer)`를 넣는다.
   * 번호를 올리지 않으면 핸들러가 main의 재전송으로 보고 버린다(TRP-035).
   */
  signalInterrupt(): void;
  /** `pyodide.checkInterrupt()`. SIGINT가 있으면 `FS.ErrnoError(EINTR)`를 던진다. */
  checkInterrupt(): void;
}

/**
 * `pyodide.setStdin({ stdin })`에 넘길 동기 콜백. 항상 cancelable=true, 프롬프트 없음(main이 꼬리로 정한다).
 * pyodide는 돌려준 문자열 끝에 `\n`이 없으면 붙이고, `null`은 EOF로 해석한다(314.0.7 `LegacyReader`) —
 * 그래서 이 콜백은 `\n`을 붙이지 않는다.
 * `checkInterrupt()`가 던지지 않으면(버퍼 미연결 등) 취소를 EOF로 떨어뜨린다: 경고 한 줄을 남기고 `null`을 돌려준다
 * (→ `EOFError`). 던지지 않은 SIGINT를 남겨 두면 다음 문장이 엉뚱한 지점에서 죽는다.
 * `wait()`가 던진 오류는 그대로 전파해 `input()`에서 `OSError`가 된다(main의 `fail`).
 */
export function createStdinCallback(
  deps: StdinCallbackDeps,
): () => string | null {
  return () => {
    deps.requestInput(true);
    const line = deps.wait();
    if (line !== null) return line;
    deps.signalInterrupt();
    deps.checkInterrupt();
    console.warn(
      "[repl.worker] checkInterrupt가 SIGINT를 소비하지 않아 입력 취소를 EOF로 처리한다",
    );
    return null;
  };
}
