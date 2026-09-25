/**
 * 부트스트랩 관찰기를 worker 전역에 설치하는 부수효과 모듈. `worker.ts`가 `coincident/window/worker`보다 **먼저** import한다: 관찰
 * 리스너가 coincident의 부트스트랩 리스너보다 먼저 등록돼야 메시지를 볼 수 있다(등록 순서가 성립 조건, `bootstrap-observer.ts`).
 * ESM은 import 순서대로 평가하지만 번들러는 외부 import(`coincident/window/worker`)를 파일 맨 위로 올리므로, 이 모듈은 별도 진입점
 * (`tsdown.config.ts`)이라 dist에서도 별도 파일(`dist/bootstrap-observer-install.mjs`)로 남고 `dist/worker.mjs`가 coincident보다 먼저
 * import한다(`scripts/check-dist.mjs --allow-sync-bridge`가 순서를 검사한다). `package.json` `sideEffects` 배열에 이 파일이 있어야 한다.
 */
import { createBootstrapObserver } from "./bootstrap-observer";

/** 지금 전역이 worker 전역인가. 아니면(jsdom·node 시험) 모듈 평가 때 리스너를 걸지 않는다. */
function isWorkerGlobalScope(): boolean {
  const scope = (globalThis as { WorkerGlobalScope?: unknown })
    .WorkerGlobalScope;
  return typeof scope === "function" && globalThis instanceof scope;
}

// 모듈 평가 시점에 건다(`prepare`가 아니라). 부트스트랩은 이 시점 이후에만 볼 수 있다.
export const observer = isWorkerGlobalScope()
  ? createBootstrapObserver(self)
  : undefined;
