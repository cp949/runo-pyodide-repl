import { ReplView } from "./ReplView";
import { RunnerView } from "./RunnerView";

/** 쿼리 `?view=runner`면 실행창을, 그 밖에는 REPL을 렌더링한다. 페이지당 xterm은 하나만 둔다(e2e 셀렉터 유지). */
const view = new URLSearchParams(globalThis.location.search).get("view");

export function App() {
  return (
    <main>
      <h1>runo-pyodide-repl</h1>
      <p>
        crossOriginIsolated:{" "}
        <output data-testid="cross-origin-isolated">
          {String(crossOriginIsolated)}
        </output>
      </p>
      {view === "runner" ? <RunnerView /> : <ReplView />}
    </main>
  );
}
