/**
 * Ctrl+C 연결의 유일한 진입점(03-ctrl-c.md 2.6). 순서가 시작 코드를 지킨다: SIGINT 핸들러 설치 → 남은 SIGINT 폐기 →
 * interrupt buffer 연결. 폴링은 연결 뒤에야 시작하므로 연결이 먼저이면 그 사이에 쓴 눌림을 pyodide 기본 핸들러가 받아
 * 시작 코드(`signal.signal`, `eval_code`)가 `KeyboardInterrupt`로 죽는다(TRP-027).
 *
 * `worker/`는 `protocol/`을 import하지 않는다. `ack`·`seq`·`discard`는 `boot.ts`가 `protocol/`의 함수를 클로저로 넣는다
 * (`stdin-callback.ts`와 같은 패턴).
 */
import type { PyodideInterface } from "pyodide";
import type { PyodideConsoleProxy } from "./console";
import { installSigintHandler, type SigintHandlerDeps } from "./sigint-handler";

export interface InterruptConnectDeps extends SigintHandlerDeps {
  /**
   * 연결 직전에 남은 SIGINT를 지우고, 실제로 2를 지웠을 때만 ack한다(`discardPendingInterrupt(buffer)`를 boot.ts가 넣는다).
   * ack 없이 지우면 살아 있는 송신기가 소실로 읽어 같은 번호로 다시 쓰고, 그 2가 기본 핸들러에 걸린다(TRP-027).
   */
  discard(): void;
}

/**
 * 순서: `installSigintHandler` → `deps.discard()` → `pyodide.setInterruptBuffer(buffer)`.
 * 연결 뒤 눌림은 핸들러가 받고, 사용자 프레임이 없으면 버린다(ack는 올린다).
 */
export function connectInterrupts(
  pyodide: Pick<PyodideInterface, "runPython" | "toPy" | "setInterruptBuffer">,
  pyconsole: PyodideConsoleProxy,
  buffer: Int32Array,
  deps: InterruptConnectDeps,
): void {
  installSigintHandler(pyodide, pyconsole, deps);
  deps.discard();
  pyodide.setInterruptBuffer(buffer);
}
