// @vitest-environment node
/**
 * top-level await 비트 토글(`setTopLevelAwait`) 시험(02-console-core.md 5.4, TRAP-03).
 * 실제 `PyodideConsole`의 컴파일 플래그(`_compile.compiler.flags`, pyodide private 경로)를 읽고 쓴다.
 * 이 경로가 바뀌면 pyodide 버전 업그레이드 알림으로 첫 시험이 먼저 깨진다(09-testing.md 9.1).
 */
import type { PyProxy } from "pyodide/ffi";
import { loadPyodide, type PyodideInterface } from "pyodide";
import { beforeAll, describe, expect, test } from "vitest";
import {
  DEFAULT_CONSOLE_FLAGS,
  setTopLevelAwait,
  TOP_LEVEL_AWAIT_FLAG,
  type CompilerFlagsHolder,
} from "./top-level-await";

interface TestConsole extends PyProxy, CompilerFlagsHolder {
  push(line: string): PyProxy & { syntax_check: string };
}

let pyodide: PyodideInterface;

beforeAll(async () => {
  pyodide = await loadPyodide();
  pyodide.runPython("import asyncio");
}, 60_000);

/** 이 시험이 쓸 새 콘솔. 콜백은 잇지 않는다. */
function createTestConsole(): TestConsole {
  const consoleModule = pyodide.pyimport("pyodide.console");
  return consoleModule.PyodideConsole(pyodide.globals) as TestConsole;
}

/**
 * top-level `await`를 push해 판정만 보고 future를 버린다. `await 1`은 켜진 상태에서 실제로 실행돼 회수되지 않는
 * `TypeError`가 stderr에 남으므로, 정상 완료되는 `asyncio.sleep(0)`을 쓴다.
 */
function syntaxCheckOfAwait(pyconsole: TestConsole): string {
  const future = pyconsole.push("await asyncio.sleep(0)");
  try {
    return future.syntax_check;
  } finally {
    future.destroy();
  }
}

describe("setTopLevelAwait", () => {
  test("생성 직후 콘솔 플래그는 0x6200이고 비공개 경로 _compile.compiler.flags가 숫자다", () => {
    const pyconsole = createTestConsole();

    const flags = pyconsole._compile.compiler.flags;

    expect(typeof flags).toBe("number");
    expect(flags).toBe(0x6200);
    expect(DEFAULT_CONSOLE_FLAGS).toBe(0x6200);
    expect(TOP_LEVEL_AWAIT_FLAG).toBe(0x2000);
  });

  test("false면 TLA 비트만 꺼져 0x4200이 된다", () => {
    const pyconsole = createTestConsole();

    setTopLevelAwait(pyconsole, false);

    expect(pyconsole._compile.compiler.flags).toBe(0x4200);
  });

  test("true면 다시 0x6200이다", () => {
    const pyconsole = createTestConsole();
    setTopLevelAwait(pyconsole, false);

    setTopLevelAwait(pyconsole, true);

    expect(pyconsole._compile.compiler.flags).toBe(0x6200);
  });

  test("끄면 top-level await가 syntax-error, 켜면 complete로 판정된다", () => {
    const pyconsole = createTestConsole();

    setTopLevelAwait(pyconsole, false);
    expect(syntaxCheckOfAwait(pyconsole)).toBe("syntax-error");

    setTopLevelAwait(pyconsole, true);
    expect(syntaxCheckOfAwait(pyconsole)).toBe("complete");
  });
});
