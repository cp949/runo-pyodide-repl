import { describe, expect, it } from "vitest";
import { backspaceCount, indentUnitWidth, nextIndentation } from "./auto-indent";

// 커서가 버퍼 끝에 있을 때 Enter 뒤 개행 다음에 들어갈 공백.
function indentationAfter(buffer: string, lastUsed: string | null = null): string {
  return nextIndentation(buffer, buffer.length, lastUsed).indentation;
}

// 기대값은 python3.14 -q를 pty로 구동해 관찰한 이전 구현의 실측 결과를 옮긴 것이다.
describe("nextIndentation: 3.14 REPL 실측 동작", () => {
  it("`:`로 끝나는 줄 다음 줄은 4칸 들여쓴다", () => {
    expect(indentationAfter("for i in range(2):")).toBe("    ");
  });

  it("`:`가 없어도 직전 줄의 들여쓰기를 이어받는다", () => {
    expect(indentationAfter("for i in range(2):\n    print(i)")).toBe("    ");
  });

  it("들여쓰기 없는 일반 줄 다음은 비어 있다", () => {
    expect(indentationAfter("x = 1")).toBe("");
  });

  it("블록에서 처음 나온 들여쓰기 폭을 단위로 쓴다", () => {
    // 자동 4칸 위에 4칸을 더 타이핑해 8칸이 첫 들여쓰기가 된 경우, 다음 줄은 16칸(8 유지 + 8 추가).
    expect(indentationAfter("if True:\n        if True:")).toBe(" ".repeat(16));
  });

  it("이전 블록에서 본 들여쓰기 폭을 새 블록에서도 쓴다", () => {
    // 2칸으로 쓴 블록 뒤 새 블록의 자동 들여쓰기는 2칸이다. 새 세션(null)은 4칸.
    const buffer = "if True:\n  x=1";
    const { lastUsedIndentation } = nextIndentation(buffer, buffer.length, null);

    expect(lastUsedIndentation).toBe("  ");
    expect(indentationAfter("if True:", lastUsedIndentation)).toBe("  ");
    expect(indentationAfter("if True:", null)).toBe("    ");
  });

  it("본문 없이 공백뿐인 줄에서 Enter를 눌러도 블록이 열려 있어 다시 4칸이 채워진다", () => {
    // 공백뿐인 줄은 들여쓰기로 이어받지 않지만, 그 앞의 `:`를 거슬러 올라가 찾는다.
    expect(indentationAfter("if True:\n    ")).toBe("    ");
  });

  it("`:` 뒤 줄 끝 주석은 무시한다", () => {
    expect(indentationAfter("if x:  # 조건")).toBe("    ");
  });

  it("주석뿐인 줄은 `:`로 끝나도 들여쓰지 않는다", () => {
    expect(indentationAfter("# 참고:")).toBe("");
  });

  it("문자열 안의 `#`도 주석으로 오인한다(3.14와 같은 한계)", () => {
    expect(indentationAfter('if s == "#":')).toBe("");
  });
});

describe("indentUnitWidth", () => {
  it("스페이스로 쓴 단위는 그 길이이고 아니면 4칸이다", () => {
    expect(indentUnitWidth(null)).toBe(4);
    expect(indentUnitWidth("  ")).toBe(2);
    expect(indentUnitWidth("        ")).toBe(8);
    expect(indentUnitWidth("\t")).toBe(4);
  });
});

// 기대값은 python3.14 -q에서 자동 4칸 뒤 Backspace 한 번에 0칸이 되는 실측과 `backspace_dedent` 소스를
// 따른다. 3.14와 달리 이전 줄들의 들여쓰기 수준이 아니라 단위 배수를 쓴다(편차 12).
describe("backspaceCount", () => {
  const continuing = (buffer: string, unitWidth = 4) =>
    backspaceCount(buffer, buffer.length, unitWidth, true);

  it("연속 줄의 앞 공백은 단위 배수까지 지운다", () => {
    expect(continuing("    ")).toBe(4);
    expect(continuing(" ".repeat(8))).toBe(4);
    expect(continuing(" ".repeat(6))).toBe(2);
    expect(continuing("  ")).toBe(2);
  });

  it("단위 폭이 2이면 2칸씩 지운다", () => {
    expect(continuing("    ", 2)).toBe(2);
  });

  it("공백 앞에 글자나 탭이 있으면 한 글자만 지운다", () => {
    expect(continuing("    a")).toBe(1);
    expect(continuing("\t")).toBe(1);
    expect(continuing("  \t  ")).toBe(1);
  });

  it("줄 시작이면 한 글자(개행)만 지운다", () => {
    expect(continuing("")).toBe(1);
    expect(continuing("if x:\n")).toBe(1);
  });

  it("이어지는 줄이 아닌 버퍼의 첫 줄에서는 한 글자만 지운다", () => {
    expect(backspaceCount("    ", 4, 4, false)).toBe(1);
  });

  it("여러 줄 버퍼의 둘째 줄부터는 연속 줄이 아니어도 한 단위를 지운다", () => {
    const buffer = `if x:\n${" ".repeat(8)}`;

    expect(backspaceCount(buffer, buffer.length, 4, false)).toBe(4);
  });

  it("커서가 공백 사이에 있으면 커서 앞 공백만 센다", () => {
    const buffer = `if x:\n${" ".repeat(8)}pass`;

    expect(backspaceCount(buffer, 6 + 6, 4, false)).toBe(2);
  });
});
