// 자동 들여쓰기 순수 로직. CPython 3.14 `_pyrepl/readline.py`의 `maybe_accept`가 개행을 넣은 뒤
// 채우는 들여쓰기 규칙을 옮긴 것이다(docs/design/06-editing.md 6.3). 키 입력 배선(`createAutoIndent`)은
// DELTA-04에서 다른 함수로 두고, 여기서는 문자열만 다룬다.

export interface NextIndentation {
  // 개행 바로 뒤에 넣을 공백(직전 줄에서 이어받은 들여쓰기 + `:` 뒤 추가분).
  indentation: string;
  // 세션 동안 유지되는 "마지막으로 본 첫 들여쓰기"(`_pyrepl`의 `last_used_indentation`).
  lastUsedIndentation: string | null;
}

export const DEFAULT_UNIT = "    ";

function isIndentChar(char: string | undefined): boolean {
  return char === " " || char === "\t";
}

// `_get_first_indentation`: 버퍼에서 처음 나온 (공백만이 아닌) 들여쓴 줄의 들여쓰기.
function firstIndentation(buffer: string): string | null {
  let indentedLineStart: number | null = null;
  for (let i = 0; i < buffer.length; i++) {
    if (
      i < buffer.length - 1 &&
      buffer[i] === "\n" &&
      isIndentChar(buffer[i + 1])
    ) {
      indentedLineStart = i + 1;
    } else if (
      indentedLineStart !== null &&
      !isIndentChar(buffer[i]) &&
      buffer[i] !== "\n"
    ) {
      return buffer.slice(indentedLineStart, i);
    }
  }
  return null;
}

// `_get_previous_line_indent`: 커서가 있는 줄의 시작 위치와 들여쓰기 글자 수. 커서 앞이 공백뿐인
// 줄은 들여쓰기가 없는 것(null)으로 본다.
function previousLineIndent(
  buffer: string,
  pos: number
): { lineStart: number; indent: number | null } {
  let lineStart = pos;
  while (lineStart > 0 && buffer.charAt(lineStart - 1) !== "\n") lineStart--;
  let textStart = lineStart;
  while (textStart < pos && isIndentChar(buffer.charAt(textStart)))
    textStart++;
  return {
    lineStart,
    indent: textStart === pos ? null : textStart - lineStart,
  };
}

// `_should_auto_indent`: pos 앞의 마지막 의미 있는 글자가 `:`인지. 공백·개행은 건너뛰고 줄 끝 `#`
// 주석은 무시한다. 문자열 안의 `#`도 주석으로 오인하는 점까지 3.14와 같다.
function shouldAutoIndent(buffer: string, pos: number): boolean {
  let lastChar: string | null = null;
  while (pos > 0) {
    pos--;
    const char = buffer.charAt(pos);
    if (lastChar === null) {
      if (!" \t\n#".includes(char)) lastChar = char;
    } else {
      // 의미 있는 글자를 찾은 뒤에도 줄 시작까지 거슬러 올라가 `#`가 있으면 주석으로 취급한다.
      if (char === "\n") break;
      if (char === "#") lastChar = null;
    }
  }
  return lastChar === ":";
}

// 들여쓰기 단위의 폭. 스페이스로 쓴 단위면 그 길이이고, 탭이거나 아직 본 적이 없으면 4칸이다.
export function indentUnitWidth(lastUsedIndentation: string | null): number {
  return lastUsedIndentation !== null && /^ +$/.test(lastUsedIndentation)
    ? lastUsedIndentation.length
    : DEFAULT_UNIT.length;
}

// `backspace_dedent`: Backspace 한 번에 지울 글자 수(1이면 평소처럼 한 글자). 커서 앞이 스페이스뿐이고
// 연속 줄일 때만 직전 단위 배수까지 지운다. continuation은 버퍼의 첫 줄이 사실은 블록의 이어지는 줄일 때
// (`... ` 입력줄) true다. 3.14는 이전 줄들의 더 얕은 들여쓰기 수준까지 지우지만, 단위 배수로 단순화했다
// (들여쓰기가 단위 배수이면 같다. 편차 12, `docs/design/10-parity-deviations.md`).
export function backspaceCount(
  buffer: string,
  pos: number,
  unitWidth: number,
  continuation: boolean
): number {
  const lineStart = buffer.lastIndexOf("\n", pos - 1) + 1;
  const prefix = buffer.slice(lineStart, pos);
  if (!/^ +$/.test(prefix)) return 1;
  if (lineStart === 0 && !continuation) return 1;
  return prefix.length % unitWidth || unitWidth;
}

// buffer는 편집 버퍼 전체, pos는 Enter를 누른 커서 위치다.
export function nextIndentation(
  buffer: string,
  pos: number,
  lastUsedIndentation: string | null
): NextIndentation {
  const { lineStart, indent } = previousLineIndent(buffer, pos);
  const kept = indent ? buffer.slice(lineStart, lineStart + indent) : "";
  // `_pyrepl`은 개행과 이어받은 들여쓰기를 넣은 버퍼에서 첫 들여쓰기를 다시 읽어 갱신한다.
  const next = buffer.slice(0, pos) + "\n" + kept + buffer.slice(pos);
  const unit = firstIndentation(next) ?? lastUsedIndentation;
  const extra = shouldAutoIndent(next, pos + 1 + kept.length)
    ? (unit ?? DEFAULT_UNIT)
    : "";
  return { indentation: kept + extra, lastUsedIndentation: unit };
}
