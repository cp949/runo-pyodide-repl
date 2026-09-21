/**
 * REPL worker 생성 경로. `createRepl`의 `createWorker` 옵션(세션 리셋마다 다시 호출됨)으로 넘긴다.
 * Vite는 `new Worker(new URL(리터럴, import.meta.url), ...)` 형태를 보고 worker를 별도 ES 모듈로 번들한다.
 */
export function createWorker(): Worker {
  return new Worker(new URL("./repl.worker.ts", import.meta.url), {
    type: "module",
  });
}
