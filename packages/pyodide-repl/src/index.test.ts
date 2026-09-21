/**
 * 패키지 진입점 스모크 테스트.
 * vitest 실행 환경과 TypeScript 모듈 해석이 연결되어 있는지만 확인한다.
 */
import { describe, expect, it } from "vitest";

describe("@cp949/runo-pyodide-repl 진입점", () => {
  it("모듈을 불러올 수 있다", async () => {
    await expect(import("./index")).resolves.toBeDefined();
  });
});
