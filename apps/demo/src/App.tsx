import { useEffect } from "react";
import { createWorker } from "./create-worker";
import { ReplView } from "./ReplView";

const PYODIDE_INDEX_URL = "https://cdn.jsdelivr.net/pyodide/v314.0.7/full/";

/**
 * worker에 보내는 임시 초기화 프레임. `runReplWorker`가 프레임을 검증하므로(RD-002) 모든 필드를 갖춘다.
 * 실제 프레임(01-protocols.md 4절)은 RD-004의 `createRepl`(`createWorker`·채널 생성)이 만들어 이 임시 코드를 대체한다.
 * 버퍼 크기는 검증 대상이 아니어서 형태만 맞춘다.
 */
function createInitFrame(rpcPort: MessagePort) {
  const shared = () => new SharedArrayBuffer(16);
  return {
    kind: "init",
    rpcPort,
    interruptBuffer: new Int32Array(shared()),
    stdinCtrl: new Int32Array(shared()),
    stdinData: new Uint8Array(shared()),
    topLevelAwait: false,
    pyodide: { indexURL: PYODIDE_INDEX_URL },
  };
}

export function App() {
  useEffect(() => {
    // SharedArrayBuffer는 cross-origin isolated 페이지에서만 있다(ADR-0004). 아니면 worker를 만들지 않는다.
    if (!crossOriginIsolated) return;
    const worker = createWorker();
    const channel = new MessageChannel();
    const frame = createInitFrame(channel.port1);
    worker.postMessage(frame, [frame.rpcPort]);
    // StrictMode 이중 마운트에서도 worker와 포트가 남지 않게 정리한다.
    return () => {
      worker.terminate();
      channel.port2.close();
    };
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
      <ReplView />
    </main>
  );
}
