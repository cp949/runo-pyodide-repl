import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // 기본은 jsdom이다. node + 실제 pyodide 시험은 파일 상단에 `// @vitest-environment node`를 둔다(09-testing.md).
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
    // `exit()`의 `SystemExit`은 asyncio Task가 WebLoop로 다시 던져(`run_handle`이 핸들러 없이 재발생) JS unhandled
    // rejection이 된다. RD-009의 webloop 재보고 억제(03-ctrl-c.md 2.8)가 들어오면 이 필터를 제거한다.
    onUnhandledError(error) {
      if (error.name === "PythonError" && /^SystemExit\b/m.test(error.message))
        return false;
    },
  },
});
