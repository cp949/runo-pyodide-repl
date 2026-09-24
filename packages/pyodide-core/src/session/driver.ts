/**
 * main 쪽 core 세션(`startCoreSession`)과 driver의 경계. core 세션은 worker 생성·초기화 프레임·RPC 핸들러 합성·`readInput`
 * 처리·"Python 실행 중" 게이트·종료 수명 주기를 소유하고, driver는 화면 상호작용(REPL의 줄 읽기·입력 읽기·출력 그리기)을 낸다.
 * 이 모양은 REPL이 쓰는 것만 담는다(RD-020, 실행 driver는 RD-022). 공개 API로 문서화하기 전의 내부 계약이다.
 */
import type { RpcHandlers } from "../protocol/rpc";

/** Python이 쓴 stdout·stderr 원문 한 조각. 줄 끝 처리·색은 소비자가 정한다(core는 원문을 그대로 넘긴다). */
export interface OutputChunk {
  stream: "stdout" | "stderr";
  text: string;
}

/** core 세션이 알리는 상태. `loading`·`not-isolated`는 세션 밖(앱 계층)이 발행한다. */
export type SessionStatus = "ready" | "load-failed" | "terminated" | "crashed";

/** main 쪽 driver. 세션 하나마다 새로 만든다(상태는 세션이 소유한다). */
export interface MainDriver {
  /**
   * 초기화 프레임의 `driver` 필드로 실린다(`InitFrame.driver`). core는 모양을 모르고, worker 쪽 driver가
   * `WorkerDriver.parseOptions`로 검증한다. 예: REPL은 `{ topLevelAwait }`.
   */
  readonly options: unknown;
  /**
   * driver가 받는 RPC 핸들러(worker → main). core 핸들러(`write`·`writeErrorRaw`·`readInput`·`sessionTerminated`·`ready`·
   * `loadFailed`·`crashed`)와 이름이 겹치면 세션 생성 시 예외다(`composeRpcHandlers`, 늦은 등록 API 없음).
   */
  readonly handlers: RpcHandlers;
  /**
   * 대상 Python 코드가 없어 Ctrl+C를 보낼 곳이 없는 구간인가(REPL: 프롬프트 입력 대기·취소 직후). core 게이트
   * `pythonRunning = alive && inputReadsPending === 0 && !isIdle()`이 이 값을 합성한다.
   */
  isIdle(): boolean;
  /**
   * `input()`·`sys.stdin` 읽기 한 건. 줄이면 문자열, 취소면 `null`. core가 결과를 메일박스에 싣는다(`deliver`·`cancel`).
   * 내부 seam이다: 공개 `InputProvider` 모양(`prompt`·`signal`)은 RD-022.
   */
  readInput(cancelable: boolean): Promise<string | null>;
  /**
   * `readInput`이 던진 오류가 "이 세션의 읽기가 끝나 응답 없이 버린다"는 뜻인가(REPL: `ReadCancelledError`). 참이면 core는
   * 메일박스에 아무것도 쓰지 않는다. core가 터미널 라이브러리를 import하지 않도록 판정을 driver가 낸다.
   */
  isReadCancelled(error: unknown): boolean;
  /** `readInput` 알림이 도착한 순간(읽기 시작 전). REPL은 여기서 취소 직후 방어 구간을 내린다. */
  inputRequested?(): void;
  /** `readInput` 응답(`deliver`·`cancel`·`fail`)이 끝나 worker가 재개하는 순간. */
  inputResumed?(): void;
  /** `ready` 알림 도착(상태 알림 앞). */
  onReady?(pyodideVersion: string): void;
  /** `loadFailed` 알림 도착(게이트를 닫은 뒤, 상태 알림 앞). REPL은 여기서 빨강 한 줄을 쓴다. */
  onLoadFailed?(message: string): void;
  /**
   * `terminate()`가 core 정리(송신기 취소·`rpc.dispose()`·`worker.terminate()`) 앞에서 부른다. 열린 읽기를 끝내고 자원을
   * 정리한다. core의 `ended`는 이미 참이다.
   */
  terminate?(): void;
}
