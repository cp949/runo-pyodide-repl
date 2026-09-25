/**
 * 출력 꼬리 추적(04-stdin-input.md 3.3, 05-output.md 4.1). 화면에 낸 바이트를 먹여 두었다가, 읽기 시작 때
 * "마지막 `\n` 뒤이면서 그 안에서 마지막 `\r` 뒤" 텍스트를 프롬프트로 다시 그릴 수 있게 한다.
 * 줄 경계를 넘어 열린 SGR(색) 시퀀스는 꼬리 앞에 이어 붙인다. 커서 이동 없이 줄 위에서 글자만 바꾸는 제어 문자는
 * 폭 계산이 어긋나지 않게 정규화한다 — BS(`\b`)는 본문 마지막 글자를 지우고, BEL 등 나머지 C0와 DEL은 제거한다.
 * 터미널·pyodide에 의존하지 않는 순수 모듈이다.
 */
export interface OutputTail {
  /** 화면에 낸 바이트를 그대로 먹인다. println 계열은 `text + "\n"`을 먹인다. */
  feed(text: string): void;
  /** 꼬리와 SGR 상태를 모두 비운다. */
  reset(): void;
  /** 이어받은 열린 SGR + 꼬리 본문. 개행·`\r`로 끝났으면 "". */
  value(): string;
}

/** 이어받는 열린 SGR 시퀀스 상한. 초과분은 오래된 것부터 버린다. */
export const MAX_ACTIVE_SGR = 64;

const ESC = "\x1b";

function isSgrParameter(char: string): boolean {
  return (char >= "0" && char <= "9") || char === ";" || char === ":";
}

/** `text[start]`가 ESC일 때 SGR이면 끝 인덱스(배타), 아니면 -1. 정규식 없이 직접 읽는다. */
function sgrEnd(text: string, start: number): number {
  if (text[start + 1] !== "[") return -1;
  let index = start + 2;
  while (index < text.length && isSgrParameter(text.charAt(index))) index += 1;
  return text[index] === "m" ? index + 1 : -1;
}

/** 본문에서 제거하는 제어 문자: BEL을 포함한 C0(BS·탭·개행·`\r`·ESC 제외)와 DEL. */
function isDroppedControl(code: number): boolean {
  return (
    (code <= 0x1f &&
      code !== 0x08 &&
      code !== 0x09 &&
      code !== 0x0a &&
      code !== 0x0d &&
      code !== 0x1b) ||
    code === 0x7f
  );
}

/** `text[start]`가 ESC이고 CSI 시퀀스가 `text` 끝까지 이어지면 true. 본문 끝의 시퀀스를 건너뛰는 데 쓴다. */
function endsWithCsi(text: string, start: number): boolean {
  if (text[start + 1] !== "[") return false;
  let index = start + 2;
  while (index < text.length) {
    const code = text.charCodeAt(index);
    if (code < 0x20 || code > 0x3f) break;
    index += 1;
  }
  const final = text.charCodeAt(index);
  return index === text.length - 1 && final >= 0x40 && final <= 0x7e;
}

/**
 * BS를 본문에 적용한다: 끝의 CSI 시퀀스(SGR 등)는 건너뛰고 그 앞 글자 하나를 지운다. 지울 글자가 없으면(본문이 비었거나
 * 시퀀스뿐) 그대로 돌려준다.
 */
function eraseLastChar(body: string): string {
  let end = body.length;
  for (;;) {
    const esc = body.lastIndexOf(ESC, end - 1);
    if (esc === -1 || !endsWithCsi(body.slice(0, end), esc)) break;
    end = esc;
  }
  if (end === 0) return body;
  // 서로게이트 쌍이면 두 코드 유닛을 함께 지운다.
  const low = body.charCodeAt(end - 1);
  const size =
    end >= 2 &&
    low >= 0xdc00 &&
    low <= 0xdfff &&
    body.charCodeAt(end - 2) >= 0xd800 &&
    body.charCodeAt(end - 2) <= 0xdbff
      ? 2
      : 1;
  return body.slice(0, end - size) + body.slice(end);
}

export function createOutputTail(): OutputTail {
  let active: string[] = []; // 커서 위치에서 열려 있는 SGR
  let carried: string[] = []; // 현재 줄이 시작될 때 열려 있던 SGR
  let body = "";

  const startLine = () => {
    body = "";
    carried = active;
  };
  const applySgr = (sequence: string, parameters: string) => {
    // 첫 파라미터가 0(또는 빈 값)이면 지금까지의 SGR이 모두 꺼진다. 나머지 파라미터가 있으면 그 시퀀스만 남는다.
    if (Number(parameters.split(/[;:]/, 1)[0]) === 0) {
      active = parameters.replace(/[0;:]/g, "") === "" ? [] : [sequence];
      return;
    }
    active = [...active, sequence].slice(-MAX_ACTIVE_SGR);
  };

  return {
    feed(text) {
      let segmentStart = 0;
      let index = 0;
      while (index < text.length) {
        const char = text[index];
        if (char === "\n" || char === "\r") {
          body += text.slice(segmentStart, index);
          startLine();
          index += 1;
          segmentStart = index;
        } else if (char === "\b") {
          // 본문 마지막 글자를 지운다. 줄 시작 SGR(`carried`)은 본문과 별개라 건드리지 않는다.
          body = eraseLastChar(body + text.slice(segmentStart, index));
          index += 1;
          segmentStart = index;
        } else if (isDroppedControl(text.charCodeAt(index))) {
          body += text.slice(segmentStart, index);
          index += 1;
          segmentStart = index;
        } else if (char === ESC) {
          const end = sgrEnd(text, index);
          if (end === -1) {
            index += 1; // SGR이 아닌 제어 시퀀스는 본문에 그대로 남긴다
          } else {
            applySgr(text.slice(index, end), text.slice(index + 2, end - 1));
            index = end; // SGR 텍스트도 본문에 남는다(segmentStart를 옮기지 않음)
          }
        } else {
          index += 1;
        }
      }
      body += text.slice(segmentStart);
    },
    reset() {
      active = [];
      carried = [];
      body = "";
    },
    value: () => carried.join("") + body,
  };
}
