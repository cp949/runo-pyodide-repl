/**
 * repl에 남은 통합 시험(SIGINT 4종·`interrupt-buffer`·`stdin-callback`·`console`·`submission-runner`·`webloop-reraise`)이 core worker
 * 모듈을 직접 조립할 때 쓰는 진입점. 이 모듈들은 core 공개 export가 아니라(내부 부품이고 시험만 쓴다) 저장소 안 상대 경로로
 * core 소스를 가리킨다 — `sigint-setup.ts`의 `INTERRUPT_PRESSER_ROLE`과 같은 이유다. 패키지 배치를 바꾸면 이 파일만 고친다.
 * 실행 driver(RD-022)가 생겨 core 전용 하니스로 나누면 이 시험들의 위치를 재검토한다.
 */
export { connectInterrupts } from "../../../pyodide-core/src/worker/interrupt-buffer";
export {
  SIGINT_HANDLER_FILENAME,
  installSigintHandler,
} from "../../../pyodide-core/src/worker/sigint-handler";
export type { InterruptIdle } from "../../../pyodide-core/src/worker/sigint-handler";
export { createSinkWriter } from "../../../pyodide-core/src/worker/sink-writer";
export {
  SLEEP_SLICE_FILENAME,
  installSleepSlice,
} from "../../../pyodide-core/src/worker/sleep-slice";
export { createStdinCallback } from "../../../pyodide-core/src/worker/stdin-callback";
export { suppressWebLoopReraise } from "../../../pyodide-core/src/worker/webloop-reraise";
