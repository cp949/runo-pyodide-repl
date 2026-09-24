// @vitest-environment node
/**
 * `createRunner` 통합 시험(실제 pyodide). worker 스레드에 `runDriver`를 올리고(`test/roles/run-worker.ts`) main 역할의 `createRunner`가
 * 그 스레드를 `Worker`처럼 쓴다. 가짜 worker 시험(`runner.test.ts`)이 못 보는 것을 본다: 실제 stdin 메일박스 왕복(`input()` →
 * `readInput` 알림 → `InputProvider` → 응답 → 출력), 실제 SIGINT 폴링(`while True` + `stop()`), 폴백 terminate 뒤 새 worker 부팅.
 * 시험마다 새 worker 스레드와 새 `loadPyodide()`를 쓴다.
 *
 * 시간: `stop()` 폴백(1000ms)은 제품의 실제 타이머라 그 시험만 실시간으로 그 시간을 지난다. 판정은 이벤트(결과·상태)로 하고
 * ms 상한 단언은 없다(`docs/design/09-testing.md` 9.7).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { spawnWorkerLike } from "@repo/pyodide-testkit/thread";
import type { OutputChunk } from "./driver";
import {
  createRunner,
  type InputProvider,
  type RunnerHandle,
  type RunnerOptions,
  type RunnerStatus,
} from "./runner";

const RUN_WORKER_ROLE = new URL("../test/roles/run-worker.ts", import.meta.url);

/** 부팅·폴백 재생성이 느린 장비에서도 정지를 잡는 시험 시간 제한(판정선 아님). */
const TEST_TIMEOUT_MS = 90_000;

const runners: RunnerHandle[] = [];

beforeEach(() => {
  vi.stubGlobal("crossOriginIsolated", true);
});

afterEach(() => {
  for (const runner of runners.splice(0)) runner.dispose();
  vi.unstubAllGlobals();
});

interface Started {
  runner: RunnerHandle;
  statuses: RunnerStatus[];
  chunks: OutputChunk[];
  /** 지금까지 나온 stdout 전체. */
  stdout(): string;
  stderr(): string;
  waitStatus(status: RunnerStatus): Promise<void>;
  waitOutput(text: string): Promise<void>;
}

/** 조건이 참이 될 때까지 이벤트 루프를 돌린다(벽시계 상한 없음, 시험 시간 제한이 정지를 잡는다). */
async function until(predicate: () => boolean): Promise<void> {
  while (!predicate()) await new Promise<void>((resolve) => setImmediate(resolve));
}

async function start(options: Partial<RunnerOptions> = {}): Promise<Started> {
  const statuses: RunnerStatus[] = [];
  const chunks: OutputChunk[] = [];
  const runner = createRunner({
    createWorker: () => spawnWorkerLike(RUN_WORKER_ROLE) as unknown as Worker,
    onOutput: (chunk) => void chunks.push(chunk),
    onStatus: (status) => void statuses.push(status),
    ...options,
  });
  runners.push(runner);
  const started: Started = {
    runner,
    statuses,
    chunks,
    stdout: () =>
      chunks
        .filter((chunk) => chunk.stream === "stdout")
        .map((chunk) => chunk.text)
        .join(""),
    stderr: () =>
      chunks
        .filter((chunk) => chunk.stream === "stderr")
        .map((chunk) => chunk.text)
        .join(""),
    // 부팅 실패·크래시는 기다리던 상태가 영영 오지 않는다는 뜻이라 바로 실패시킨다.
    waitStatus: (status) =>
      until(() => {
        if (runner.status === "crashed" || runner.status === "load-failed") {
          if (status !== runner.status) {
            throw new Error(`기다리던 ${status} 대신 ${runner.status}`);
          }
        }
        return runner.status === status;
      }),
    waitOutput: (text) => until(() => started.stdout().includes(text)),
  };
  await started.waitStatus("ready");
  return started;
}

describe("createRunner + 실제 pyodide", () => {
  test(
    "input()은 prompt를 provider에 넘기고 응답한 줄을 받아 이어서 실행한다",
    async () => {
      const prompts: string[] = [];
      const provider: InputProvider = async (prompt) => {
        prompts.push(prompt);
        return "홍길동";
      };
      const started = await start({ inputProvider: provider });

      const result = await started.runner.run(
        'name = input("이름: ")\nprint(f"안녕 {name}")',
      );

      expect(result).toStrictEqual({ kind: "ok" });
      expect(prompts).toEqual(["이름: "]);
      expect(started.stdout()).toContain("안녕 홍길동");
      expect(started.statuses).toEqual([
        "loading",
        "ready",
        "running",
        "waiting-input",
        "running",
        "ready",
      ]);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "while True + stop()은 KeyboardInterrupt로 끝나 interrupted 결과와 stopped를 돌려준다",
    async () => {
      const started = await start();

      const result = started.runner.run(
        'print("시작", flush=True)\nwhile True:\n    pass',
      );
      await started.waitOutput("시작");
      const stopped = await started.runner.stop();

      expect(stopped).toBe("stopped");
      const outcome = await result;
      expect(outcome.kind).toBe("interrupted");
      expect(outcome).toMatchObject({
        traceback: expect.stringContaining("KeyboardInterrupt"),
      });
      expect(started.runner.status).toBe("ready");
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "input() 대기 중 stop()은 읽기를 취소해 KeyboardInterrupt로 끝나고 provider의 signal이 abort된다",
    async () => {
      let seen: AbortSignal | undefined;
      const started = await start({
        inputProvider: (_prompt, signal) => {
          seen = signal;
          return new Promise<string | null>(() => {});
        },
      });

      const result = started.runner.run('input("값: ")');
      await started.waitStatus("waiting-input");
      const stopped = await started.runner.stop();

      expect(stopped).toBe("stopped");
      expect(await result).toMatchObject({ kind: "interrupted" });
      expect(seen?.aborted).toBe(true);
      expect(started.runner.status).toBe("ready");
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "KeyboardInterrupt를 삼키는 루프는 stop() 폴백으로 worker가 교체되고 run은 restarted다",
    async () => {
      const started = await start();
      const source = [
        'print("시작", flush=True)',
        "while True:",
        "    try:",
        "        while True:",
        "            pass",
        "    except KeyboardInterrupt:",
        "        pass",
      ].join("\n");

      const result = started.runner.run(source);
      await started.waitOutput("시작");
      const stopped = await started.runner.stop();

      expect(stopped).toBe("restarted");
      expect(await result).toStrictEqual({ kind: "restarted" });
      await started.waitStatus("ready");
      expect(started.statuses).toEqual([
        "loading",
        "ready",
        "running",
        "restarting",
        "ready",
      ]);
      // 새 worker는 이전 상태 없이 정상 실행한다.
      expect(await started.runner.run("print('다시')")).toStrictEqual({
        kind: "ok",
      });
      expect(started.stdout()).toContain("다시");
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "reset은 worker를 교체해 이전 run의 변수가 사라진다",
    async () => {
      const started = await start();
      expect(await started.runner.run("x = 1")).toStrictEqual({ kind: "ok" });

      started.runner.reset();
      await started.waitStatus("restarting");
      await started.waitStatus("ready");
      const outcome = await started.runner.run("print(x)");

      expect(outcome).toMatchObject({ kind: "error", errorType: "NameError" });
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "provider가 없으면 input()은 읽기 취소를 받는다",
    async () => {
      const started = await start();

      const outcome = await started.runner.run("input()");

      // null 응답은 메일박스 cancel이고 worker의 stdin 콜백이 그것을 KeyboardInterrupt로 바꾼다(EOFError가 아니다).
      expect(outcome).toMatchObject({ kind: "interrupted" });
    },
    TEST_TIMEOUT_MS,
  );
});
