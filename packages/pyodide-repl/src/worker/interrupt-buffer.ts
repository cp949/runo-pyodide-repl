/**
 * Ctrl+C 연결의 유일한 진입점(03-ctrl-c.md 2.6). 순서가 시작 코드를 지킨다: `time.sleep` 조각 교체 → SIGINT 핸들러
 * 설치 → 남은 SIGINT 폐기 → interrupt buffer 연결. 폴링은 연결 뒤에야 시작하므로 연결이 먼저이면 그 사이에 쓴 눌림을
 * pyodide 기본 핸들러가 받아 시작 코드(`signal.signal`, `eval_code`)가 `KeyboardInterrupt`로 죽는다(TRP-027).
 * 조각 교체가 핸들러보다 먼저인 것은 조각 래퍼의 코드 객체를 핸들러의 트레이스백 절단 목록에 넘겨야 해서다.
 *
 * `worker/`는 `protocol/`을 import하지 않는다. `ack`·`seq`·`discard`는 `boot.ts`가 `protocol/`의 함수를 클로저로 넣는다
 * (`stdin-callback.ts`와 같은 패턴).
 */
import type { PyodideInterface } from "pyodide";
import type { PyodideConsoleProxy } from "./console";
import {
  type InterruptIdle,
  installSigintHandler,
  type SigintHandlerDeps,
} from "./sigint-handler";
import { installSleepSlice } from "./sleep-slice";

export interface InterruptConnectDeps extends SigintHandlerDeps {
  /**
   * 연결 직전에 남은 SIGINT를 지우고, 실제로 2를 지웠을 때만 ack한다(`discardPendingInterrupt(buffer)`를 boot.ts가 넣는다).
   * ack 없이 지우면 살아 있는 송신기가 소실로 읽어 같은 번호로 다시 쓰고, 그 2가 기본 핸들러에 걸린다(TRP-027).
   */
  discard(): void;
  /** `time.sleep` 조각 교체·정지한 실행 깨우기가 건너뛴 이유. boot.ts가 console.warn을 넣는다. */
  warn(message: string): void;
}

/**
 * 순서: `installSleepSlice` → `installSigintHandler` → `deps.discard()` → `pyodide.setInterruptBuffer(buffer)`.
 * 연결 뒤 눌림은 핸들러가 받고, 사용자 프레임이 없으면 정지한 실행을 깨우거나(실행 중) 버린다(ack는 올린다).
 * 돌려주는 `interrupt_idle`은 감시 타이머가 쓰고, 호출자가 세션 끝에 destroy한다.
 */
export function connectInterrupts(
  pyodide: Pick<PyodideInterface, "runPython" | "toPy" | "setInterruptBuffer">,
  pyconsole: PyodideConsoleProxy,
  buffer: Int32Array,
  deps: InterruptConnectDeps,
): InterruptIdle {
  // 조각 교체가 실패해도(가드) 핸들러는 그대로 설치한다. 그 경우 코드 객체가 없어 절단 목록만 짧아진다.
  const codes = installSleepSlice(pyodide, { warn: deps.warn });
  const interruptIdle = installSigintHandler(pyodide, pyconsole, deps, codes);
  codes?.destroy();
  deps.discard();
  pyodide.setInterruptBuffer(buffer);
  return interruptIdle;
}
