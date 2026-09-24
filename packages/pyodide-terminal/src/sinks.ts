/**
 * main이 터미널에 쓰는 sink 4종과 꼬리 추적(05-output.md 4.1). worker의 출력 알림과 콘솔 콜백·전역 스트림이 모두
 * 이 함수들을 지나므로 개행·색 규칙이 한곳에 있다. `Readline`은 `print`/`println`만 쓴다(ADR-0003).
 */
import type { Readline } from "@cp949/runo-xterm-readline";
import { createOutputTail } from "@cp949/runo-pyodide-core";

export const RED = "\x1b[31m";
export const RESET = "\x1b[0m";

export interface TerminalSinks {
  /** 값 에코·배너. 끝 개행 없는 텍스트를 받고 sink가 `\r\n`을 붙인다. */
  writeOutput(text: string): void;
  /** 트레이스백·SyntaxError. 줄 전체를 빨강으로 한 번 감싸고 `\r\n`을 붙인다. */
  writeError(text: string): void;
  /** stdout 조각·전역 stdout·`^C` 에코. 조각 그대로, 개행 강제 없음. 빈 조각은 무출력. */
  write(text: string): void;
  /** stderr 조각·전역 stderr. 조각마다 빨강을 열고 닫는다(무상태). 빈 조각은 무출력. */
  writeErrorRaw(text: string): void;
  tail(): string;
  resetTail(): void;
}

/** sink 세트는 worker(세션)마다 새로 만든다 — 새 세션이 이전 꼬리를 물려받지 않게. */
export function createTerminalSinks(
  readline: Pick<Readline, "print" | "println">,
): TerminalSinks {
  const tail = createOutputTail();
  const print = (text: string) => {
    tail.feed(text);
    readline.print(text);
  };
  // println은 sink가 붙이는 개행도 추적기에 알린다(TRAP-29: fake가 이것을 모사하지 않아 이중 개행을 놓쳤다).
  const println = (text: string) => {
    tail.feed(`${text}\n`);
    readline.println(text);
  };
  return {
    writeOutput: (text) => println(text),
    writeError: (text) => println(`${RED}${text}${RESET}`),
    write: (text) => {
      if (text !== "") print(text);
    },
    writeErrorRaw: (text) => {
      if (text !== "") print(`${RED}${text}${RESET}`);
    },
    tail: () => tail.value(),
    resetTail: () => tail.reset(),
  };
}
