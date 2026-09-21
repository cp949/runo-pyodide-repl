import { defineConfig } from "tsdown";

export default defineConfig({
  // worker.ts는 '@cp949/runo-pyodide-repl/worker' 서브패스로 노출한다.
  entry: ["src/index.ts", "src/worker.ts"],
  format: ["esm"],
  dts: true,
});
