import { useEffect } from "react";
import { createWorker } from "./create-worker";

const PYODIDE_INDEX_URL = "https://cdn.jsdelivr.net/pyodide/v314.0.7/full/";

/**
 * worker에 보내는 초기화 프레임. RD-001은 worker가 프레임을 받는지만 본다.
 * 실제 프레임(01-protocols.md 4절)은 RD-002의 `init-frame.ts`와 RD-003의 `createRepl`이 만든다.
 */
function createInitFrame() {
  return {
    kind: "init",
    // SharedArrayBuffer는 cross-origin isolated 페이지에서만 있다. 뷰가 worker까지 넘어가는지 함께 본다.
    interruptBuffer: crossOriginIsolated
      ? new Int32Array(new SharedArrayBuffer(16))
      : null,
    topLevelAwait: false,
    pyodide: { indexURL: PYODIDE_INDEX_URL },
  };
}

export function App() {
  useEffect(() => {
    const worker = createWorker();
    worker.postMessage(createInitFrame());
    // StrictMode 이중 마운트에서도 worker가 남지 않게 정리한다.
    return () => worker.terminate();
  }, []);

  return (
    <main>
      <h1>runo-pyodide-repl</h1>
      <p>
        crossOriginIsolated:{" "}
        <output data-testid="cross-origin-isolated">
          {String(crossOriginIsolated)}
        </output>
      </p>
    </main>
  );
}
