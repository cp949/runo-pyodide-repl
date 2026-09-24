/**
 * main 쪽 REPL 읽기(worker가 RPC로 요청하는 `readLine`, 04-stdin-input.md 3.3). 3.14의 REPL은 프롬프트 직전에 stdout을
 * flush하고 개행 없이 그 뒤에 `>>> `를 그린다(`print("t", end="")` → `t>>> `). `Readline.read()`는 커서 행을 열 0부터
 * 다시 그리므로(`\r\x1b[J`, TRP-004) 직전 출력의 꼬리(`output-tail`)를 프롬프트 앞에 붙여 그 자리에 다시 그린다.
 * 꼬리의 열린 색이 REPL 프롬프트로 새지 않도록 둘 사이에 SGR 리셋을 넣는다(3.14는 프롬프트가 자체 색을 입히고 닫아 꼬리 색이
 * 새지 않는다). 꼬리가 폭을 넘으면 읽기 전에 첫 행까지 커서를 올린다(`rewindTail`, TRP-016).
 *
 * 읽기를 시작하며 꼬리를 비운다: 읽는 동안 Python은 멈춰 있어 새 출력이 없고, 읽기가 끝나면(Enter, Ctrl+C 취소) 커서가 다음
 * 행 처음으로 가므로 꼬리가 없다. 비우지 않으면 다음 읽기가 앞 꼬리를 물려받는다.
 *
 * 읽기 옵션은 세션이 합성해 넘긴다(`read-options.ts`).
 */
import type { Readline } from "@cp949/runo-xterm-readline";
import type { ReadOptionsProvider } from "./read-options";
import {
  rewindTail,
  type RewindTerminal,
  type TerminalSinks,
} from "@cp949/runo-pyodide-terminal/internal";

export interface ReplReader {
  /**
   * 꼬리 + `\x1b[0m` + prompt를 그 자리에 그리고 Enter까지 한 줄을 돌려준다. 꼬리가 없으면 prompt 그대로.
   * `cancelable`이면 읽기 중 Ctrl+C가 `^C` 없이 줄만 바꾸고 `null`로 끝난다(취소, 06-editing.md 6.3).
   * `pending`은 worker가 보낸, 아직 제출되지 않은 블록 줄들이다(자동 들여쓰기 프리필의 재료,
   * `06-editing.md` 6.3).
   */
  read(
    prompt: string,
    pending: string | undefined,
    cancelable: boolean
  ): Promise<string | null>;
}

/** 세션(sink 세트)마다 하나. 순서: rewindTail(flush) → 꼬리 재조회 → resetTail → readline.read(합성 프롬프트). */
export function createReplReader(
  readline: Pick<Readline, "read">,
  term: RewindTerminal,
  sinks: Pick<TerminalSinks, "tail" | "resetTail">,
  readOptions: ReadOptionsProvider
): ReplReader {
  return {
    async read(prompt, pending, cancelable) {
      await rewindTail(term, sinks.tail());
      // flush를 기다리는 사이에 온 출력을 반영하려고 꼬리를 다시 읽는다.
      const tail = sinks.tail();
      sinks.resetTail();
      return readline.read(tail === "" ? prompt : `${tail}\x1b[0m${prompt}`, {
        cancelable,
        ...readOptions(pending),
      });
    },
  };
}
