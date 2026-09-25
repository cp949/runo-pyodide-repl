/**
 * dom-bridge worker 진입점(`@cp949/runo-pyodide-dom-bridge/worker`). worker 파일의 **첫 정적 import**여야 한다: coincident는 이
 * 모듈이 평가될 때 부트스트랩 메시지 리스너를 한 번 건다. main이 보낸 부트스트랩은 worker 생성 직후 도착하므로, 이 import가 늦으면
 * 메시지를 놓치고 `coincident()`가 영원히 대기한다(`prepare`가 관찰기로 이를 알아채 명시 오류로 실패한다).
 *
 *   import { domBridge } from "@cp949/runo-pyodide-dom-bridge/worker"; // 첫 줄
 *   import { runWorker, runDriver } from "@cp949/runo-pyodide-core/worker";
 *   runWorker({ driver: runDriver, plugins: [domBridge()] });
 *
 * Python에는 `from runo.browser import window, document`로 노출한다(`window`는 `parent`·`top`·`opener`를 막은 얕은 guard).
 */
import coincident from "coincident/window/worker";
import type { WorkerPlugin } from "@cp949/runo-pyodide-core/worker";
import { createBootstrapObserver } from "./bootstrap-observer";
import { createDomBridgePlugin } from "./dom-bridge-plugin";
import type { WorkerBridge } from "./worker-bridge";

export type { WorkerBridge } from "./worker-bridge";

/** 지금 전역이 worker 전역인가. 아니면(jsdom·node 시험) 모듈 평가 때 리스너를 걸지 않는다. */
function isWorkerGlobalScope(): boolean {
  const scope = (globalThis as { WorkerGlobalScope?: unknown })
    .WorkerGlobalScope;
  return typeof scope === "function" && globalThis instanceof scope;
}

// 모듈 평가 시점에 건다(`prepare`가 아니라). 부트스트랩은 이 시점 이후에만 볼 수 있다.
const observer = isWorkerGlobalScope()
  ? createBootstrapObserver(self)
  : undefined;

let bridgePromise: Promise<WorkerBridge> | undefined;

/**
 * coincident 브리지(`proxy`·`window`·`native`). 같은 worker에서 `coincident()`를 여러 번 부르면 내부 상태가 새로 만들어져 안전을
 * 보장할 수 없으므로 한 번만 부르고 결과를 공유한다. `ffi`(임의 코드 평가 등)는 CSP 때문에 노출하지 않는다.
 */
export function bridge(): Promise<WorkerBridge> {
  bridgePromise ??= coincident().then(({ proxy, window, native }) => ({
    proxy,
    window,
    native,
  }));
  return bridgePromise;
}

/** `runWorker({ plugins })`에 넘기는 dom-bridge 플러그인(`name: "dom-bridge"`). */
export function domBridge(): WorkerPlugin {
  return createDomBridgePlugin({
    receivedBootstrap: () => observer?.received === true,
    bridge,
  });
}
