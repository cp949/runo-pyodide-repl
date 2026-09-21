// @vitest-environment node
/**
 * worker 콘솔 코어(`createConsole`) 시험(02-console-core.md 5.1·5.4, TRAP-02·03).
 * 실제 pyodide(node)에서 `PyodideConsole` 생성·콜백·`sys.ps1/ps2`·`runLine` 네 결과·`await_fut` 헬퍼를 확인한다.
 * sink는 `vi.fn()`이라 터미널 바이트는 보지 않는다(그건 terminal/sinks-pyodide.test.ts).
 */
import { loadPyodide, type PyodideInterface } from "pyodide";
import { beforeAll, describe, expect, test, vi } from "vitest";
import { createConsole } from "./console";

let pyodide: PyodideInterface;

beforeAll(async () => {
  pyodide = await loadPyodide();
}, 60_000);

/** 새 콘솔과 호출을 기록하는 sink. 콘솔을 만들 때마다 전역 stdout/stderr Writer가 이 sink로 다시 등록된다. */
function setup(topLevelAwait = false) {
  const sinks = { write: vi.fn(), writeErrorRaw: vi.fn() };
  const repl = createConsole(pyodide, sinks, { topLevelAwait });
  return { sinks, repl };
}

describe("createConsole", () => {
  test("배너는 Python 3.14.2로 시작하고 끝 개행이 없다", () => {
    const { repl } = setup();

    expect(repl.banner.startsWith("Python 3.14.2 (")).toBe(true);
    expect(repl.banner.includes('Type "help"')).toBe(true);
    expect(repl.banner.endsWith("\n")).toBe(false);
  });

  test("`sys.ps1`·`sys.ps2`가 설정된다", () => {
    setup();

    const prompts = pyodide.runPython("import sys; (sys.ps1, sys.ps2)");

    expect(prompts.toJs()).toEqual([">>> ", "... "]);
    prompts.destroy();
  });

  test("기본 옵션(false)에서 top-level await가 꺼져 있다", async () => {
    const { repl } = setup();

    const result = await repl.runLine("await 1");

    expect(result.kind).toBe("syntax-error");
    expect(result).toMatchObject({
      formattedError: expect.stringContaining("'await' outside function"),
    });
  });

  test("식 한 줄은 값과 함께 complete로 끝나고 `builtins._`가 갱신된다", async () => {
    const { repl } = setup();

    const result = await repl.runLine("1 + 1");

    expect(result).toEqual({ kind: "complete", value: 2, exited: false });
    expect(pyodide.runPython("_")).toBe(2);
  });

  test("문장은 값 없이 complete다", async () => {
    const { repl } = setup();

    const result = await repl.runLine("x = 3");

    expect(result).toStrictEqual({
      kind: "complete",
      value: undefined,
      exited: false,
    });
  });

  test("미완성 블록은 incomplete다", async () => {
    const { repl } = setup();

    const result = await repl.runLine("if True:");

    expect(result).toEqual({ kind: "incomplete" });
  });

  test("문법 오류는 syntax-error와 formatted_error다", async () => {
    const { repl } = setup();

    // `1 +`·`foo bar` 같은 입력은 pyodide 314.0.7에서 `_IncompleteInputError: incomplete input`으로 표시돼
    // `SyntaxError` 문자열이 없다. 평범한 `SyntaxError`를 내는 입력을 쓴다.
    const result = await repl.runLine("x = = 1");

    expect(result.kind).toBe("syntax-error");
    if (result.kind !== "syntax-error") return;
    expect(result.formattedError.includes("SyntaxError: invalid syntax")).toBe(
      true,
    );
    expect(result.formattedError.endsWith("\n")).toBe(true);
  });

  test("실행 예외는 error와 내부 프레임 없는 트레이스백이다", async () => {
    const { repl } = setup();

    const result = await repl.runLine("1/0");

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.formattedError.includes("ZeroDivisionError")).toBe(true);
    for (const internal of [
      "runcode",
      "push",
      "_runcode_with_lock",
      "await_fut",
    ]) {
      expect(result.formattedError.includes(internal)).toBe(false);
    }
  });

  test("`exit()`는 exited가 참인 complete다", async () => {
    const { repl } = setup();

    const result = await repl.runLine("exit()");

    expect(result).toMatchObject({ kind: "complete", exited: true });
  });

  test("콘솔 실행 중 stdout 조각은 write sink로 즉시 온다", async () => {
    const { repl, sinks } = setup();

    await repl.runLine('print("x", end="")');

    // 빈 `end`도 조각으로 온다. 무출력 규칙은 main sink가 지킨다.
    expect(sinks.write.mock.calls).toEqual([["x"], [""]]);
    expect(sinks.writeErrorRaw).not.toHaveBeenCalled();
  });

  test("콘솔 실행 중 stderr 조각은 writeErrorRaw sink로 온다", async () => {
    const { repl, sinks } = setup();

    await repl.runLine('import sys; print("err", file=sys.stderr)');

    expect(sinks.writeErrorRaw.mock.calls).toEqual([["err"], ["\n"]]);
    expect(sinks.write).not.toHaveBeenCalled();
  });

  test("콘솔 밖 출력은 전역 Writer로 같은 sink에 온다", () => {
    const { sinks } = setup();

    pyodide.runPython('print("bg", flush=True)');
    pyodide.runPython('import sys; sys.stderr.write("e\\n")');

    expect(sinks.write.mock.calls).toEqual([["bg\n"]]);
    expect(sinks.writeErrorRaw.mock.calls).toEqual([["e\n"]]);
  });

  test("`await_fut`는 사용자 globals에 남지 않는다", () => {
    setup();

    expect(pyodide.runPython("'await_fut' in globals()")).toBe(false);
  });
});
