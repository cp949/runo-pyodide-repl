// @vitest-environment node
/**
 * 제출 러너(`createSubmissionRunner`) 시험(02-console-core.md 5.2, 05-output.md 4.1).
 * 실제 pyodide(node)의 실제 `ReplConsole`을 러너에 물려 한 줄 제출·값 에코·오류 표시·끝 개행·`exit`·`null` 취소를 확인한다.
 * 실행 밖에서 새는 `KeyboardInterrupt` 안전망은 실제 SIGINT 없이 `runLine`·`clearPending`을 `KeyboardInterrupt`를 던지는
 * Python 함수로 바꿔 끼워 재현한다. 여러 줄 제출은 RD-011 범위라 다루지 않는다.
 */
import { loadPyodide, type PyodideInterface } from "pyodide";
import { beforeAll, describe, expect, test, vi } from "vitest";
import { createConsole, type ReplConsole } from "./console";
import { createSubmissionRunner } from "./submission-runner";

let pyodide: PyodideInterface;

beforeAll(async () => {
  pyodide = await loadPyodide();
}, 60_000);

/**
 * 새 콘솔과 러너. `screen`은 화면에 쌓일 텍스트다 — 콘솔 콜백(`print` 등)은 개행이 이미 들어 있어 그대로 잇고,
 * `io`(`writeOutput`/`writeError`)는 실제 sink(`readline.println`)처럼 끝에 개행을 붙인다(TRAP-29). 호출부가 끝 개행을
 * 이미 붙여 넘기면 화면에 빈 줄이 하나 더 생기므로 이 모사가 이중 개행을 잡는다.
 * `hooks`로 러너가 보는 `runLine`·`clearPending`만 바꿔 끼울 수 있다(실제 콘솔은 그대로).
 */
function setup() {
  const screen = { stdout: "", stderr: "" };
  const sinks = {
    write: vi.fn((text: string) => {
      screen.stdout += text;
    }),
    writeErrorRaw: vi.fn((text: string) => {
      screen.stderr += text;
    }),
  };
  const repl = createConsole(pyodide, sinks, { topLevelAwait: false });
  const io = {
    writeOutput: vi.fn((text: string) => {
      screen.stdout += `${text}\n`;
    }),
    writeError: vi.fn((text: string) => {
      screen.stderr += `${text}\n`;
    }),
  };
  const hooks: {
    runLine?: ReplConsole["runLine"];
    clearPending?: ReplConsole["clearPending"];
  } = {};
  const seen: Pick<ReplConsole, "runLine" | "pending" | "clearPending"> = {
    runLine: (source) => (hooks.runLine ?? repl.runLine)(source),
    pending: () => repl.pending(),
    clearPending: () => (hooks.clearPending ?? repl.clearPending)(),
  };
  const { run } = createSubmissionRunner(pyodide, seen, io);
  return { run, io, screen, hooks };
}

const READY = { prompt: ">>> ", exit: false };

describe("한 줄 제출", () => {
  test("식을 입력하면 값을 에코하고 `>>> `로 돌아온다", async () => {
    const { run, io } = setup();

    const result = await run("1 + 1");

    expect(result).toStrictEqual(READY);
    expect(io.writeOutput.mock.calls).toEqual([["2"]]);
    expect(io.writeError).not.toHaveBeenCalled();
  });

  test("블록 시작 줄은 `... `와 pending을 돌려주고 빈 줄이 블록을 실행한다", async () => {
    const { run, screen } = setup();

    expect(await run("if True:")).toStrictEqual({
      prompt: "... ",
      exit: false,
      pending: "if True:",
    });
    expect(await run("    print('x')")).toStrictEqual({
      prompt: "... ",
      exit: false,
      pending: "if True:\n    print('x')",
    });
    expect(screen.stdout).toBe("");
    expect(await run("")).toStrictEqual(READY);
    expect(screen.stdout).toBe("x\n");
  });

  test("문법 오류는 오류를 한 번 쓰고 `>>> `로 돌아온다", async () => {
    const { run, io } = setup();

    const result = await run("x = = 1");

    expect(result).toStrictEqual(READY);
    expect(io.writeError).toHaveBeenCalledTimes(1);
    expect(io.writeError.mock.calls[0]?.[0]).toContain(
      "SyntaxError: invalid syntax",
    );
    expect(io.writeOutput).not.toHaveBeenCalled();
  });

  test("EOF에서 끊긴 `1 +`는 표준 `SyntaxError: invalid syntax`로 나온다", async () => {
    const { run, io } = setup();

    await run("1 +");

    expect(io.writeError.mock.calls).toEqual([
      [
        '  File "<console>", line 1\n    1 +\n       ^\nSyntaxError: invalid syntax',
      ],
    ]);
  });

  test("빈 줄만 입력하면 아무것도 출력하지 않는다", async () => {
    const { run, io, screen } = setup();

    const result = await run("");

    expect(result).toStrictEqual(READY);
    expect(io.writeOutput).not.toHaveBeenCalled();
    expect(io.writeError).not.toHaveBeenCalled();
    expect(screen.stdout + screen.stderr).toBe("");
  });

  test("런타임 예외는 트레이스백을 쓰고 이후 입력을 계속 받는다", async () => {
    const { run, io } = setup();

    expect(await run("1/0")).toStrictEqual(READY);
    expect(io.writeError.mock.calls[0]?.[0]).toContain(
      "ZeroDivisionError: division by zero",
    );
    expect(await run("2 + 2")).toStrictEqual(READY);
    expect(io.writeOutput.mock.calls).toEqual([["4"]]);
  });

  test("`None`과 대입은 출력이 없다", async () => {
    const { run, io } = setup();

    await run("None");
    await run("x = 3");

    expect(io.writeOutput).not.toHaveBeenCalled();
    expect(io.writeError).not.toHaveBeenCalled();
  });

  test("`__repr__` 예외는 트레이스백으로 나온다", async () => {
    const { run, io } = setup();
    pyodide.runPython(
      "class BadRepr:\n    def __repr__(self):\n        raise ValueError('boom')\n",
    );

    const result = await run("BadRepr()");

    expect(result).toStrictEqual(READY);
    expect(io.writeOutput).not.toHaveBeenCalled();
    expect(io.writeError.mock.calls[0]?.[0]).toMatch(
      /^Traceback \(most recent call last\):\n[\s\S]*ValueError: boom$/,
    );
  });
});

// sink가 개행을 붙이므로 러너는 끝 개행 없는 텍스트를 넘겨야 한다. 어긋나면 프롬프트 앞에 빈 줄이 생긴다.
describe("출력 끝 개행", () => {
  test("식 값 에코 뒤에 빈 줄이 없다", async () => {
    const { run, screen } = setup();

    await run("2");

    expect(screen.stdout).toBe("2\n");
  });

  test("트레이스백 뒤에 빈 줄이 없다", async () => {
    const { run, screen } = setup();

    await run("1/0");

    expect(
      screen.stderr.endsWith("ZeroDivisionError: division by zero\n"),
    ).toBe(true);
    expect(screen.stderr.endsWith("\n\n")).toBe(false);
  });

  test("문법 오류 뒤에 빈 줄이 없다", async () => {
    const { run, screen } = setup();

    await run("x = = 1");

    expect(screen.stderr.endsWith("SyntaxError: invalid syntax\n")).toBe(true);
    expect(screen.stderr.endsWith("\n\n")).toBe(false);
  });

  test("예외 메시지 자체가 개행으로 끝나면 그 개행은 남긴다", async () => {
    const { run, screen } = setup();

    await run('raise ValueError("x\\n")');

    // CPython도 `ValueError: x` 뒤 빈 줄을 낸다. 러너는 끝 개행을 정확히 하나만 뗀다.
    expect(screen.stderr.endsWith("ValueError: x\n\n")).toBe(true);
    expect(screen.stderr.endsWith("\n\n\n")).toBe(false);
  });
});

describe("종료", () => {
  test.each([
    { code: "exit()" },
    { code: "quit()" },
    { code: "raise SystemExit" },
  ])("`$code`은 exit가 참이고 오류를 쓰지 않는다", async ({ code }) => {
    const { run, io } = setup();

    const result = await run(code);

    expect(result).toStrictEqual({ prompt: ">>> ", exit: true });
    expect(io.writeError).not.toHaveBeenCalled();
    expect(io.writeOutput).not.toHaveBeenCalled();
  });
});

describe("취소(`null`)", () => {
  test("블록 입력 중 취소하면 블록을 버리고 이어서 입력한 줄이 새로 실행된다", async () => {
    const { run, screen } = setup();
    await run("if True:");

    expect(await run(null)).toStrictEqual(READY);

    // 버리지 않았다면 `if True:\nprint(1)`이 IndentationError가 된다.
    expect(await run("print(1)")).toStrictEqual(READY);
    expect(screen.stdout).toBe("1\n");
  });

  test("취소는 `KeyboardInterrupt` 한 줄만 쓴다(트레이스백 헤더·값 에코 없음)", async () => {
    const { run, io, screen } = setup();
    await run("if True:");

    await run(null);

    expect(io.writeError.mock.calls).toEqual([["KeyboardInterrupt"]]);
    expect(io.writeOutput).not.toHaveBeenCalled();
    expect(screen.stderr).toBe("KeyboardInterrupt\n");
    expect(screen.stdout).toBe("");
  });

  test("본문 줄까지 쌓인 블록도 전체를 버린다", async () => {
    const { run, screen } = setup();
    await run("if True:");
    await run("    print(2)");

    await run(null);

    expect(await run("print(1)")).toStrictEqual(READY);
    expect(screen.stdout).toBe("1\n");
  });

  test("`>>> `에서의 취소도 같은 출력을 내고 `>>> `로 돌아온다", async () => {
    const { run, io, screen } = setup();

    expect(await run(null)).toStrictEqual(READY);

    expect(io.writeError.mock.calls).toEqual([["KeyboardInterrupt"]]);
    expect(screen.stdout).toBe("");
  });
});

/**
 * 호출하면 `KeyboardInterrupt`를 던지는 Python 함수. 사용자 코드 밖(컴파일·취소 처리)에서 새는 SIGINT를 SIGINT 없이
 * 재현한다. 사용자 globals를 더럽히지 않도록 별도 namespace에서 정의한다.
 */
function pythonFunction<T>(source: string): T {
  return pyodide.runPython(source, { globals: pyodide.toPy({}) }) as T;
}
const LEAK = "def leak(*args):\n    raise KeyboardInterrupt\nleak";

describe("실행 밖에서 새는 KeyboardInterrupt(안전망)", () => {
  test("`runLine`에서 새면 취소와 같은 출력을 내고 같은 콘솔에서 계속한다", async () => {
    const { run, io, hooks } = setup();
    hooks.runLine = pythonFunction<ReplConsole["runLine"]>(LEAK);

    expect(await run("1")).toStrictEqual(READY);

    expect(io.writeError.mock.calls).toEqual([["KeyboardInterrupt"]]);
    hooks.runLine = undefined;
    expect(await run("2 + 2")).toStrictEqual(READY);
    expect(io.writeOutput.mock.calls).toEqual([["4"]]);
  });

  test("블록 입력 중에 새면 미완성 블록을 버려 다음 입력에 붙지 않는다", async () => {
    const { run, screen, hooks } = setup();
    await run("if True:");
    hooks.runLine = pythonFunction<ReplConsole["runLine"]>(LEAK);

    expect(await run("    print(0)")).toStrictEqual(READY);

    hooks.runLine = undefined;
    expect(await run("print(1)")).toStrictEqual(READY);
    expect(screen.stdout).toBe("1\n");
    expect(screen.stderr).toBe("KeyboardInterrupt\n");
  });

  test("취소 처리(`clearPending`) 중 다시 끊겨도 던지지 않고 `KeyboardInterrupt`만 쓴다", async () => {
    const { run, io, hooks } = setup();
    hooks.clearPending = pythonFunction<ReplConsole["clearPending"]>(LEAK);

    const result = await run(null);

    expect(result).toStrictEqual(READY);
    expect(io.writeError.mock.calls).toEqual([["KeyboardInterrupt"]]);
  });

  test("복구 중 `clearPending`이 `KeyboardInterrupt`가 아닌 오류를 내면 삼키지 않고 던진다", async () => {
    const { run, io, hooks } = setup();
    hooks.runLine = pythonFunction<ReplConsole["runLine"]>(LEAK);
    hooks.clearPending = pythonFunction<ReplConsole["clearPending"]>(
      "def fail(*args):\n    raise RuntimeError('cleanup')\nfail",
    );

    await expect(run("1")).rejects.toThrow("RuntimeError: cleanup");

    expect(io.writeError).not.toHaveBeenCalled();
  });

  test("변환 중 `ConversionError`에 감싸인 `KeyboardInterrupt`도 취소로 처리한다", async () => {
    const { run, io, hooks } = setup();
    // `err.type`은 "ConversionError"지만 메시지의 연쇄 예외 출력에 `KeyboardInterrupt` 단독 줄이 있다.
    hooks.runLine = pythonFunction<ReplConsole["runLine"]>(
      [
        "from pyodide.ffi import ConversionError",
        "def leak(*args):",
        "    try:",
        "        raise KeyboardInterrupt",
        "    except KeyboardInterrupt as e:",
        "        raise ConversionError('wrapped') from e",
        "leak",
      ].join("\n"),
    );

    expect(await run("1")).toStrictEqual(READY);

    expect(io.writeError.mock.calls).toEqual([["KeyboardInterrupt"]]);
  });

  test("`KeyboardInterrupt`가 아닌 Python 오류는 삼키지 않고 던진다", async () => {
    const { run, io, hooks } = setup();
    hooks.runLine = pythonFunction<ReplConsole["runLine"]>(
      "def leak(*args):\n    raise RuntimeError('x')\nleak",
    );

    await expect(run("1")).rejects.toThrow("RuntimeError: x");

    expect(io.writeError).not.toHaveBeenCalled();
  });

  test("JS 오류도 삼키지 않고 던진다", async () => {
    const { run, hooks } = setup();
    hooks.runLine = () => {
      throw new Error("runLine 실패");
    };

    await expect(run("1")).rejects.toThrow("runLine 실패");
  });
});
