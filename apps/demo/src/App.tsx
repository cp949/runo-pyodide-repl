import { ReplView } from "./ReplView";

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
      <ReplView />
    </main>
  );
}
