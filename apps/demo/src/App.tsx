import { ReplView } from "./ReplView";
import { RunnerView } from "./RunnerView";

/** 쿼리 `?view=runner`면 실행창을, 그 밖에는 REPL을 렌더링한다. 페이지당 xterm은 하나만 둔다(e2e 셀렉터 유지). */
const params = new URLSearchParams(globalThis.location.search);
const view = params.get("view");
/** 쿼리 `?fit=1`일 때만 xterm이 컨테이너 크기를 따른다(RD-024). 기본은 xterm 기본 80×24로 e2e 기준선을 유지한다. */
const fit = params.get("fit") === "1";

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
      {view === "runner" ? <RunnerView fit={fit} /> : <ReplView fit={fit} />}
    </main>
  );
}
