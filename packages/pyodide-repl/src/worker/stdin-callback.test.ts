// @vitest-environment node
/**
 * `createStdinCallback`을 실제 pyodide(node)의 `setStdin({ stdin })`에 걸어 보는 경계 시험(09-testing.md 9.1).
 * 주입한 `requestInput`·`wait`가 어떤 순서·인자로 불리는지, pyodide가 돌려준 줄을 `input()`·`sys.stdin`의
 * 다섯 읽기 경로에서 어떻게 해석하는지, `wait()`의 `null`·예외가 Python에 어떤 예외로 도착하는지를 고정한다.
 * 스레드·메일박스는 쓰지 않는다(그 왕복은 `thread-scenario.test.ts`가 본다).
 */
import { loadPyodide, type PyodideInterface } from "pyodide";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { createSinkWriter } from "./sink-writer";
import { createStdinCallback } from "./stdin-callback";

let pyodide: PyodideInterface;

beforeAll(async () => {
  pyodide = await loadPyodide();
}, 60_000);

afterEach(() => {
  // 다음 시험이 각본 없이 읽으면 `OSError`로 실패하게 한다(이전 시험의 각본이 남아 조용히 통과하는 것을 막는다).
  pyodide.setStdin({ error: true });
  pyodide.setStdout();
  // `setStdin`은 `sys.stdin` 객체를 바꾸지 않는다. `read(3)`처럼 줄 일부만 읽으면 남은 `\n`이 `TextIOWrapper`에
  // 남아 다음 시험의 첫 읽기가 콜백 없이 `"\n"`을 돌려주므로, 시험마다 새 스트림으로 갈아 끼운다.
  pyodide.runPython(
    'import sys\nsys.stdin = open(0, encoding="utf-8", closefd=False)',
  );
});

afterAll(() => {
  pyodide.setStdin();
  pyodide.setStdout();
});

/** `wait()` 각본 한 칸: 문자열은 한 줄, `null`은 취소 표식, `Error`는 던진다. */
type Step = string | null | Error;

/**
 * 각본대로 답하는 콜백을 `setStdin`에 건다. 반환값은 호출 기록(`"request:<cancelable>"`·`"wait"`)이다.
 * 각본이 소진된 뒤의 읽기는 던진다 — 기대보다 많이 읽는 코드가 EOF로 조용히 끝나지 않게 한다.
 */
function installStdin(script: Step[]): string[] {
  const calls: string[] = [];
  let next = 0;
  pyodide.setStdin({
    stdin: createStdinCallback({
      requestInput: (cancelable) => {
        calls.push(`request:${cancelable}`);
      },
      wait: () => {
        calls.push("wait");
        const step = script[next++];
        if (step === undefined) throw new Error("stdin 각본이 소진됐다");
        if (step instanceof Error) throw step;
        return step;
      },
    }),
  });
  return calls;
}

/** Python 코드를 실행하고 그 안에서 `result`에 담은 값을 JSON으로 돌려받는다. */
function runResult(code: string): unknown {
  const json = pyodide.runPython(
    `import json, sys\n${code}\njson.dumps(result)`,
  ) as string;
  return JSON.parse(json);
}

/** `wait` 호출 수 = pyodide가 콜백을 다시 부른 횟수. */
function countWaits(calls: string[]): number {
  return calls.filter((call) => call === "wait").length;
}

describe("stdin 콜백", () => {
  test("`input()`은 각본 한 줄을 그대로 돌려준다", () => {
    installStdin(["abc"]);

    expect(pyodide.runPython("input()")).toBe("abc");
  });

  test('`input("x: ")`의 프롬프트는 stdout으로 나가고 콜백에는 넘어오지 않는다', () => {
    const out: string[] = [];
    pyodide.setStdout(createSinkWriter((text) => out.push(text)));
    const calls = installStdin(["abc"]);

    const value = pyodide.runPython('input("x: ")');

    expect(value).toBe("abc");
    expect(out.join("")).toBe("x: ");
    // `requestInput`은 인자 `true`만 받고 프롬프트 문자열은 어느 호출에도 없다.
    expect(calls).toEqual(["request:true", "wait"]);
  });

  test('`sys.stdin.readline()`은 tty처럼 개행이 붙은 "abc\\n"이다', () => {
    installStdin(["a", "b"]);

    // 콜백은 개행 없이 돌려주고 pyodide가 붙인다. 콜백이 붙였다면 두 번째 줄이 빈 줄이 됐을 것이다.
    expect(
      runResult("result = [sys.stdin.readline(), sys.stdin.readline()]"),
    ).toEqual(["a\n", "b\n"]);
  });

  test("`sys.stdin.read(3)`은 한 줄 뒤 돌아온다", () => {
    const calls = installStdin(["abc"]);

    expect(runResult("result = sys.stdin.read(3)")).toBe("abc");
    expect(countWaits(calls)).toBe(1);
  });

  test('`sys.stdin.readlines(1)`은 ["abc\\n"]이다', () => {
    const calls = installStdin(["abc"]);

    expect(runResult("result = sys.stdin.readlines(1)")).toEqual(["abc\n"]);
    expect(countWaits(calls)).toBe(1);
  });

  test('`for line in sys.stdin`의 첫 줄은 "abc\\n"이고 `break`로 나온다', () => {
    const calls = installStdin(["abc"]);

    expect(
      runResult(`
for line in sys.stdin:
    result = line
    break
`),
    ).toBe("abc\n");
    expect(countWaits(calls)).toBe(1);
  });

  test("다섯 경로 모두 콜백 호출 수가 소비한 줄 수와 같다", () => {
    const calls = installStdin(["abc", "abc", "abc", "abc", "abc"]);

    // `read(3)`은 줄의 `\n`을 Python 버퍼에 남기므로 마지막에 둔다(앞에 두면 남은 `\n`이 다음 경로의 첫 줄이 된다).
    runResult(`
input()
sys.stdin.readline()
sys.stdin.readlines(1)
for line in sys.stdin:
    break
sys.stdin.read(3)
result = None
`);

    expect(countWaits(calls)).toBe(5);
  });

  test("요청 알림이 `wait()`보다 먼저다(읽기마다)", () => {
    // "readInput 알림 → wait()" 순서는 이 모듈이 소유한다(01-protocols.md 1.3). 뒤집으면 main이 알림을 못 받은 채
    // worker가 정지해 교착한다. 변이 검사의 검출 시험이다.
    const calls = installStdin(["a", "b"]);

    pyodide.runPython("input()\ninput()");

    expect(calls).toEqual(["request:true", "wait", "request:true", "wait"]);
  });

  // RD-006 중간 상태: main에 취소 표식을 쓰는 경로가 아직 없어 이 시험은 `null`이 그대로 EOF가 되는 현재 동작을
  // 고정한다. RD-008이 `null` → `KeyboardInterrupt` 변환을 넣으면 이 시험을 그 기대로 바꾼다.
  test("`wait()`가 `null`이면 `input()`은 `EOFError`다(RD-006 중간 상태, RD-008이 `KeyboardInterrupt`로 바꾼다)", () => {
    installStdin([null]);

    expect(
      runResult(`
try:
    input()
    result = "예외 없음"
except EOFError:
    result = "eof"
`),
    ).toBe("eof");
  });

  test("`wait()`가 던지면 `input()`에서 `OSError`가 난다", () => {
    installStdin([new Error("main 읽기 실패")]);

    expect(
      runResult(`
try:
    input()
    result = "예외 없음"
except OSError:
    result = "oserror"
except BaseException as e:
    result = type(e).__name__
`),
    ).toBe("oserror");
  });

  test("`sys.stdin.isatty()`는 거짓이고 `input()`은 non-tty 경로다", () => {
    installStdin([]);

    expect(pyodide.runPython("import sys\nsys.stdin.isatty()")).toBe(false);
  });
});
