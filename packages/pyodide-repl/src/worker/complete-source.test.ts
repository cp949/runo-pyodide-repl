// @vitest-environment node
/**
 * worker Tab 완성 헬퍼(`loadCompleteSource`, RD-015, 01-protocols.md 1.2) 시험. 실제 pyodide(node) +
 * `pyodide.console.PyodideConsole`로 `complete-source.py`의 후처리(정렬·내부 이름 제외·예외 삼킴·경고 억제)와
 * `KeyboardInterrupt` 전파, 코드포인트 `start`를 확인한다(`console.test.ts`·`multiline.test.ts` 패턴).
 */
import { loadPyodide, type PyodideInterface } from "pyodide";
import { beforeAll, describe, expect, test } from "vitest";
import { createConsole, type PyodideConsoleProxy } from "./console";
import { loadCompleteSource, type CompleteSource } from "./complete-source";

let pyodide: PyodideInterface;
let pyconsole: PyodideConsoleProxy;
let completer: CompleteSource;

beforeAll(async () => {
  pyodide = await loadPyodide();
  const repl = createConsole(
    pyodide,
    { write: () => {}, writeErrorRaw: () => {} },
    { topLevelAwait: false },
  );
  pyconsole = repl.pyconsole;
  completer = loadCompleteSource(pyodide, pyconsole);
}, 60_000);

describe("loadCompleteSource: 후처리", () => {
  test("`os.pa`는 정렬된 `os.*` 후보를 돌려주고 `start`는 마지막 단어 구분자 다음 위치다", () => {
    pyodide.runPython("import os");

    const result = completer("os.pa", undefined);

    // rlcompleter의 attr_matches는 이미 정렬해 돌려주지만, complete_source의 sorted()가 불변식을 지킨다(전역
    // 매칭은 정렬돼 있지 않다는 것을 아래 "내부 이름 제외" 시험이 보인다). 완성 문자열은 dotted 전체 이름이다.
    expect(result.completions).toEqual([
      "os.pardir",
      "os.path",
      "os.pathconf(",
      "os.pathconf_names",
      "os.pathsep",
    ]);
    // "os.pa" 앞에 단어 구분자(공백·세미콜론 등)가 없으므로 start는 0이다(rlcompleter docstring 예시와 동치).
    expect(result.start).toBe(0);
  });

  test("`pending` 인자는 받아서 무시한다(RD-016이 쓴다)", () => {
    pyodide.runPython("import os");

    const withPending = completer("os.pa", "import ");
    const withoutPending = completer("os.pa", undefined);

    expect(withPending).toEqual(withoutPending);
  });

  test("`_pyodide`·`___`로 시작하는 이름은 후보에서 뺀다", () => {
    pyodide.runPython("import _pyodide");
    pyodide.runPython("___x = 1");

    // 전역 매칭(`.`이 없는 소스)은 rlcompleter가 정렬하지 않는다 — 내부 이름 필터가 없으면 "_pyodide"·
    // "_pyodide_core"가 섞여 나온다. 필터가 전부 걸러내 빈 결과가 되는 것으로 확인한다.
    expect(completer("_py", undefined)).toEqual({ completions: [], start: 0 });
    const dunder = completer("__", undefined);
    expect(dunder.completions).not.toContain("___x");
  });

  test("예외를 던지는 `__dir__`은 빈 결과다", () => {
    pyodide.runPython(`
class _BrokenDir:
    def __dir__(self):
        raise RuntimeError("boom")
_broken_dir_obj = _BrokenDir()
`);

    const result = completer("_broken_dir_obj.", undefined);

    expect(result).toEqual({ completions: [], start: 0 });
  });

  test("`DeprecationWarning`을 내는 속성 접근에서 stderr에 경고가 새지 않는다", () => {
    // `@property`는 쓰지 않는다 — bpo-44752 이후 attr_matches는 property 후보를 getattr 없이 그대로 추가해서
    // getter(따라서 경고)가 애초에 불리지 않는다(공허 통과 원인, 리뷰 지적). `__dir__`이 후보를 직접 내놓고
    // `__getattr__`이 실제로 getattr되어 경고를 내는 조합으로 바꿨다(KeyboardInterrupt 시험과 같은 패턴).
    pyodide.runPython(`
import warnings
class _Deprecated:
    def __dir__(self):
        return ["dep"]
    def __getattr__(self, name):
        warnings.warn("deprecated", DeprecationWarning)
        return 1
_deprecated_obj = _Deprecated()
`);
    const stderr: string[] = [];
    pyodide.setStderr({ batched: (text) => stderr.push(text) });

    const result = completer("_deprecated_obj.dep", undefined);

    expect(result.completions).toContain("_deprecated_obj.dep");
    expect(stderr.join("")).toBe("");
    pyodide.setStderr();
  });

  test("전역 이름 매칭은 정렬되지 않은 순서로 오고, `sorted()`가 사전순으로 고정한다", () => {
    // global_matches(dotted 아닌 소스)는 namespace dict의 삽입 순서를 그대로 따른다(attr_matches와 달리 자체
    // 정렬이 없다) — 실측: `zz_b = 1; zz_a = 1` 뒤 raw global_matches는 ["zz_b", "zz_a"](삽입 순서),
    // complete_source의 sorted()가 없으면 이 순서가 그대로 새 나간다. builtin과 이름이 안 겹치는 접두사를 썼다
    // (`z` 하나만 쓰면 builtin `zip`이 섞여 나온다).
    pyodide.runPython(`
zz_b = 1
zz_a = 1
`);

    const result = completer("zz_", undefined);

    expect(result.completions).toEqual(["zz_a", "zz_b"]);
  });

  test("`start`는 코드포인트 인덱스다(서로게이트 쌍인 이모지도 1로 센다)", () => {
    pyodide.runPython(`
class _A:
    attr_one = 1
_a = _A()
`);

    const result = completer('x = "😀" ; _a.at', undefined);

    // JS(UTF-16)로는 "_a"가 12번째 코드 유닛에서 시작하지만(이모지가 서로게이트 쌍 2유닛), Python 코드포인트로는
    // 이모지가 1글자라 10번째다.
    expect(result).toEqual({ completions: ["_a.attr_one"], start: 10 });
  });

  test("`KeyboardInterrupt`는 삼키지 않고 전파된다(변이 `except BaseException`이면 이 시험이 실패한다)", () => {
    pyodide.runPython(`
class _C:
    def __dir__(self):
        return ["x"]
    def __getattr__(self, name):
        raise KeyboardInterrupt()
_c = _C()
`);

    expect(() => completer("_c.x", undefined)).toThrowError(/KeyboardInterrupt/);
  });
});
