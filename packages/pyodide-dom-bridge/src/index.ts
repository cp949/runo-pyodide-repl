/**
 * dom-bridge main 진입점(`@cp949/runo-pyodide-dom-bridge`). coincident `Worker`를 만들고 worker 쪽 `domBridge()` 플러그인이 쓸 수
 * 있는지 판정한다. 소비자는 Vite가 번들할 수 있게 worker 생성을 직접 쓴다:
 *
 *   const { Worker } = createBridgeMain();
 *   const createWorker = () => new Worker(new URL("./app.worker.ts", import.meta.url), { type: "module" });
 *
 * 만들 때 coincident가 부트스트랩 메시지를 동기로 보내므로 core init 프레임보다 항상 먼저 도착한다. coincident 옵션
 * (`serviceWorker` 등)은 통과시키지 않는다.
 */
import coincidentMain from "coincident/window/main";

/** main에서 만드는 Worker. `proxy`에 main 함수를 등록하면 worker가 `proxy.<name>(...)`으로 호출한다. */
export interface BridgeMainWorker extends Worker {
  proxy: Record<string, unknown>;
}

export interface BridgeMain {
  /** coincident가 확장한 `Worker` 생성자. */
  Worker: new (
    scriptURL: string | URL,
    options?: WorkerOptions,
  ) => BridgeMainWorker;
  /** 동기 DOM 호출이 되는 환경인가(growable SharedArrayBuffer). */
  native: boolean;
}

let cached: BridgeMain | undefined;

/** coincident main을 옵션 없이 한 번만 부르고 결과를 공유한다. */
export function createBridgeMain(): BridgeMain {
  if (cached === undefined) {
    const { Worker, native } = coincidentMain();
    cached = { Worker, native };
  }
  return cached;
}

/** growable `SharedArrayBuffer`(`maxByteLength`)를 만들 수 있는가. coincident가 `native`를 정하는 조건과 같다. */
function canCreateGrowableSharedArrayBuffer(): boolean {
  try {
    const Growable = SharedArrayBuffer as unknown as new (
      length: number,
      options: { maxByteLength: number },
    ) => SharedArrayBuffer;
    new Growable(4, { maxByteLength: 8 });
    return true;
  } catch {
    return false;
  }
}

/**
 * dom-bridge를 쓸 수 있는 페이지인가: `crossOriginIsolated === true`이고 growable SharedArrayBuffer 생성이 된다. worker를 만들기
 * 전에 걸러 조기 실패시키는 데 쓴다. 기능 탐지만 하고 UA는 판별하지 않는다(검증은 Chromium에서만 했다).
 */
export function isDomBridgeSupported(): boolean {
  return (
    globalThis.crossOriginIsolated === true &&
    canCreateGrowableSharedArrayBuffer()
  );
}
