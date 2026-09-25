/**
 * core의 시험 전용 하위 경로(`@cp949/runo-pyodide-core/test-utils`, `development` 조건)가 terminal 시험에서 해석되는지와
 * 공용 가짜 worker로 실제 `createRunner`를 돌릴 수 있는지 보는 최소 스모크(run-accepted-hook DELTA-02).
 * 화면 준비 시험(DELTA-03)이 같은 경로를 쓰면 그 시험이 이 역할을 겸하므로 그때 합칠 수 있다.
 */
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createFakeTerminal } from "@repo/pyodide-testkit/fake-terminal";
import { createFakeWorkerFactory } from "@cp949/runo-pyodide-core/test-utils";
import { createTerminalRunner } from "./terminal-runner";

const factory = createFakeWorkerFactory();
beforeEach(() => {
  vi.stubGlobal("crossOriginIsolated", true);
});
afterEach(() => {
  factory.dispose();
  vi.unstubAllGlobals();
});

test("공용 가짜 worker로 실제 createRunner를 돌려 run이 worker에 전달된다", async () => {
  const fake = createFakeTerminal();
  const handle = createTerminalRunner({
    terminal: fake.term,
    createWorker: factory.createWorker,
  });
  factory.workers[0]!.ready();
  await vi.waitFor(() => expect(handle.status).toBe("ready"));

  const result = handle.run("print(1)");
  await vi.waitFor(() => expect(factory.workers[0]!.pending).toHaveLength(1));
  factory.workers[0]!.pending[0]!.resolve({ kind: "ok" });

  await expect(result).resolves.toEqual({ kind: "ok" });
  handle.dispose();
});
