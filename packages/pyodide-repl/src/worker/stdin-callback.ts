/**
 * `pyodide.setStdin({ stdin })`에 넘길 동기 stdin 콜백(04-stdin-input.md 3.1). "`readInput` 알림 → 메일박스 대기"
 * 순서를 이 모듈이 소유한다(01-protocols.md 1.3). `pyodide`를 import하지 않고 `protocol/`도 import하지 않는다 —
 * `boot.ts`가 RPC 알림과 메일박스 리더를 주입한다.
 */

export interface StdinCallbackDeps {
  /** `readInput` 알림. `wait()`보다 먼저 부른다(01-protocols.md 1.3 — postMessage는 호출 즉시 큐에 들어가므로 뒤이어 정지해도 전달된다). */
  requestInput(cancelable: boolean): void;
  /** 메일박스 대기(`Atomics.wait`). 한 줄 또는 취소 표식(`null`). 오류 표식이면 `Error`를 던진다. */
  wait(): string | null;
}

/**
 * `pyodide.setStdin({ stdin })`에 넘길 동기 콜백. 항상 cancelable=true, 프롬프트 없음(main이 꼬리로 정한다).
 * pyodide는 돌려준 문자열 끝에 `\n`이 없으면 붙이고, `null`은 EOF로 해석한다(314.0.7 `LegacyReader`) —
 * 그래서 이 콜백은 `\n`을 붙이지 않는다.
 * RD-006 중간 상태: `null`(취소)을 그대로 돌려줘 `EOFError`가 된다. RD-008이 `signalInterrupt` → `checkInterrupt()`
 * 변환(04-stdin-input.md 3.1)으로 바꾸며 시그니처에 `pyodide`·`interruptBuffer`를 더한다.
 * `wait()`가 던진 오류는 그대로 전파해 `input()`에서 `OSError`가 된다(main의 `fail`).
 */
export function createStdinCallback(
  deps: StdinCallbackDeps,
): () => string | null {
  return () => {
    deps.requestInput(true);
    return deps.wait();
  };
}
