// @vitest-environment jsdom
/**
 * REPL 루프(`runReplLoop`)의 순수 제어 흐름 시험(00-architecture.md 3.2).
 * protocol/RPC 구현을 import하지 않고 주입한 `readLine`·`run`으로 프롬프트와 pending 전달, 종료,
 * 실행 오류 복구, 읽기 요청 거절 정책을 고정한다.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { runReplLoop } from "./repl-loop";
import type { SubmissionResult } from "./submission-runner";

type ReadLine = (
  prompt: string,
  pending: string | undefined,
) => Promise<string | null>;
type Run = (line: string | null) => Promise<SubmissionResult>;

afterEach(() => {
  vi.restoreAllMocks();
});

/** 각본: 단계마다 `readLine`이 돌려줄 줄과 `run`이 돌려줄 결과(또는 던질 오류)를 차례로 쓴다. */
function script(
  steps: { line: string | null; result: SubmissionResult | Error }[],
) {
  const readLine = vi.fn<ReadLine>();
  const run = vi.fn<Run>();
  for (const { line, result } of steps) {
    readLine.mockResolvedValueOnce(line);
    if (result instanceof Error) run.mockRejectedValueOnce(result);
    else run.mockResolvedValueOnce(result);
  }
  return { readLine, run };
}

const READY: SubmissionResult = { prompt: ">>> ", exit: false };
const EXIT: SubmissionResult = { prompt: ">>> ", exit: true };

describe("runReplLoop", () => {
  test("첫 요청은 `>>> `·pending 없음이고, 결과의 프롬프트·pending이 다음 요청으로 넘어간다", async () => {
    const { readLine, run } = script([
      {
        line: "if True:",
        result: { prompt: "... ", exit: false, pending: "if True:" },
      },
      { line: "", result: READY },
      { line: "exit()", result: EXIT },
    ]);
    const onTerminated = vi.fn();

    await runReplLoop({ readLine, run, onTerminated, onError: vi.fn() });

    // 두 번째 결과에는 pending이 없으므로 세 번째 요청에서 이전 pending이 지워진다.
    expect(readLine.mock.calls).toEqual([
      [">>> ", undefined],
      ["... ", "if True:"],
      [">>> ", undefined],
    ]);
    expect(run.mock.calls).toEqual([["if True:"], [""], ["exit()"]]);
    expect(onTerminated).toHaveBeenCalledTimes(1);
  });

  test("exit 결과 뒤에는 종료만 알리고 readLine을 더 부르지 않는다", async () => {
    const { readLine, run } = script([{ line: "exit()", result: EXIT }]);
    const onTerminated = vi.fn();

    await runReplLoop({ readLine, run, onTerminated, onError: vi.fn() });

    expect(onTerminated).toHaveBeenCalledTimes(1);
    expect(readLine).toHaveBeenCalledTimes(1);
  });

  test("run 오류는 onError로 알리고 `>>> `·pending 없음으로 계속한다", async () => {
    const boom = new Error("boom");
    const { readLine, run } = script([
      {
        line: "if True:",
        result: { prompt: "... ", exit: false, pending: "if True:" },
      },
      { line: "bad", result: boom },
      { line: "exit()", result: EXIT },
    ]);
    const onError = vi.fn();
    const onTerminated = vi.fn();

    await runReplLoop({ readLine, run, onTerminated, onError });

    expect(onError.mock.calls).toEqual([[boom]]);
    // 오류가 난 줄은 블록 입력 중이었다: 다음 요청은 `... `가 아니라 `>>> `이고 pending이 없다.
    expect(readLine.mock.calls).toEqual([
      [">>> ", undefined],
      ["... ", "if True:"],
      [">>> ", undefined],
    ]);
    expect(onTerminated).toHaveBeenCalledTimes(1);
  });

  test("`rpc disposed` 읽기 거절은 아무것도 부르지 않고 조용히 끝난다", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const readLine = vi
      .fn<ReadLine>()
      .mockRejectedValue(new Error("rpc disposed"));
    const run = vi.fn<Run>();
    const onError = vi.fn();
    const onTerminated = vi.fn();

    await runReplLoop({ readLine, run, onTerminated, onError });

    expect(run).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(onTerminated).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  test("다른 이유의 읽기 거절은 console.error 한 번만 남기고 끝난다", async () => {
    const boom = new Error("transport broken");
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const run = vi.fn<Run>();
    const onError = vi.fn();
    const onTerminated = vi.fn();

    await runReplLoop({
      readLine: vi.fn<ReadLine>().mockRejectedValue(boom),
      run,
      onTerminated,
      onError,
    });

    expect(consoleError.mock.calls).toEqual([
      ["[repl.worker] readLine 실패", boom],
    ]);
    expect(run).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(onTerminated).not.toHaveBeenCalled();
  });

  test("`null`(입력 취소)도 분기 없이 run에 그대로 넘긴다", async () => {
    const { readLine, run } = script([{ line: null, result: EXIT }]);

    await runReplLoop({
      readLine,
      run,
      onTerminated: vi.fn(),
      onError: vi.fn(),
    });

    expect(run.mock.calls).toEqual([[null]]);
  });
});
