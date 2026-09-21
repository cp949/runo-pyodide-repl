/**
 * RD-003 임시 읽기 루프(`runEchoLoop`) 시험.
 * 읽은 줄을 `[read] <줄>`로 되찍고 다시 읽는다. React StrictMode의 mount → cleanup 순서에서 dispose로 끝난 읽기를
 * 오류로 보고하지 않고, 그 밖의 읽기 오류는 삼키지 않는지를 본다. RD-005에서 worker의 REPL 루프가 대체한다.
 */
import { describe, expect, test } from "vitest";
import { runEchoLoop } from "./echo-loop";

/**
 * 준비한 결과를 차례로 돌려주는 readLine과 받은 프롬프트 기록을 만든다.
 * 결과가 바닥나면 마지막에 준 오류로 reject해 루프가 끝나게 한다.
 */
function createReadLine(results: (string | Error)[]) {
  const prompts: string[] = [];
  const readLine = (prompt: string): Promise<string> => {
    prompts.push(prompt);
    const next = results.shift();
    if (next === undefined) return Promise.reject(new Error("결과 소진"));
    return typeof next === "string"
      ? Promise.resolve(next)
      : Promise.reject(next);
  };
  return { readLine, prompts };
}

describe("runEchoLoop", () => {
  test("읽은 줄마다 [read] <JSON 문자열>을 출력하고 같은 프롬프트로 다시 읽는다", async () => {
    const { readLine, prompts } = createReadLine([
      "abc",
      "b\nc",
      new Error("disposed"),
    ]);
    const printed: string[] = [];

    await runEchoLoop({
      readLine,
      print: (text) => printed.push(text),
      isDisposed: () => true,
    });

    // 줄바꿈이 든 줄도 한 줄로 보이도록 JSON 문자열로 되찍는다.
    expect(printed).toEqual(['[read] "abc"', '[read] "b\\nc"']);
    expect(prompts).toEqual([">>> ", ">>> ", ">>> "]);
  });

  test("dispose로 끝난 읽기(reject)는 오류 없이 루프를 끝낸다", async () => {
    const { readLine } = createReadLine([new Error("disposed")]);

    await expect(
      runEchoLoop({ readLine, print: () => {}, isDisposed: () => true }),
    ).resolves.toBeUndefined();
  });

  test("dispose와 무관한 읽기 오류는 그대로 던진다", async () => {
    const failure = new Error("이미 읽는 중");
    const { readLine } = createReadLine([failure]);

    await expect(
      runEchoLoop({ readLine, print: () => {}, isDisposed: () => false }),
    ).rejects.toBe(failure);
  });
});
