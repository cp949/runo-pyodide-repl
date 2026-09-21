/**
 * `PyodideConsole`의 top-level await 비트 토글(02-console-core.md 5.4). 콘솔은 부모 `Console.__init__`이
 * `PyCF_ALLOW_TOP_LEVEL_AWAIT`를 항상 켜므로 기본이 ON이고 생성자로 끌 수 없다(TRAP-03). 그래서 생성 직후
 * 컴파일 플래그에서 이 비트만 끄거나 켠다. 다른 비트는 여러 줄 입력 판정에 쓰이므로 건드리지 않는다.
 */

/** `ast.PyCF_ALLOW_TOP_LEVEL_AWAIT`. 콘솔 컴파일 플래그에서 이 비트만 켜고 끈다. */
export const TOP_LEVEL_AWAIT_FLAG = 0x2000;

/** 생성 직후 `PyodideConsole`의 플래그: TLA(0x2000) | ALLOW_INCOMPLETE_INPUT(0x4000) | DONT_IMPLY_DEDENT(0x200). */
export const DEFAULT_CONSOLE_FLAGS = 0x6200;

/** pyodide private 경로 `_compile.compiler.flags`. pyodide를 올릴 때 이 경로가 바뀌면 시험이 먼저 깨진다. */
export interface CompilerFlagsHolder {
  _compile: { compiler: { flags: number } };
}

/** 콘솔 생성 직후 한 번만 부른다. 실행 중 바꾸면 `... ` 블록의 다음 push가 실패한다(TRAP-03). */
export function setTopLevelAwait(
  pyconsole: CompilerFlagsHolder,
  enabled: boolean,
): void {
  const flags = pyconsole._compile.compiler.flags;
  pyconsole._compile.compiler.flags = enabled
    ? flags | TOP_LEVEL_AWAIT_FLAG
    : flags & ~TOP_LEVEL_AWAIT_FLAG;
}
