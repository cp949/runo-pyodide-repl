import { defineConfig } from "tsdown";

export default defineConfig({
  // worker.ts는 '@cp949/runo-pyodide-dom-bridge/worker' 서브패스로 노출한다(worker 파일의 첫 정적 import).
  entry: ["src/index.ts", "src/worker.ts"],
  format: ["esm"],
  dts: true,
});
