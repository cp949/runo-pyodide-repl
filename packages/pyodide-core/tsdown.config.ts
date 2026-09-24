import { readFile } from "node:fs/promises";
import { defineConfig } from "tsdown";

/** `import text from "./x.py?raw"`를 문자열 모듈로 만든다. vite의 `?raw`와 같은 의미(rolldown에는 없다). */
function rawTextPlugin() {
  return {
    name: "raw-text",
    async load(id: string) {
      if (!id.endsWith("?raw")) return null;
      const text = await readFile(id.slice(0, -"?raw".length), "utf8");
      return { code: `export default ${JSON.stringify(text)};`, moduleType: "js" as const };
    },
  };
}

export default defineConfig({
  // worker.ts는 '@cp949/runo-pyodide-repl/worker' 서브패스로 노출한다.
  entry: ["src/index.ts", "src/worker.ts"],
  format: ["esm"],
  dts: true,
  // `pyodide`는 타입으로만 쓴다(런타임에는 worker가 CDN에서 불러온다). devDependency라 기본으로는 `.d.mts`에 타입이 통째로
  // 인라인돼 소비자(repl)의 `pyodide` 타입과 서로 다른 선언이 된다(TS2719). 외부로 남겨 소비자의 `pyodide`를 해석하게 한다.
  external: ["pyodide", /^pyodide\//],
  plugins: [rawTextPlugin()],
});
