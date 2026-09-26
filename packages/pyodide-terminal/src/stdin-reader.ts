/**
 * main 쪽 stdin 읽기(worker가 `readInput` 알림을 보낸 뒤 메일박스에서 정지해 기다리는 `input()`·`sys.stdin` 읽기,
 * 04-stdin-input.md 3.3). 3.14의 `input("x: ")`는 프롬프트를 stdout에 쓰고 그 뒤에서 입력을 받아 `x: abc` 한 줄이 된다.
 * `Readline.read()`는 커서 행을 열 0부터 다시 그리므로(`\r\x1b[J`, TRP-004) 직전 출력의 꼬리(`output-tail`)가 곧 프롬프트다.
 * REPL 읽기(`repl-reader`)와 달리 SGR 리셋을 붙이지 않는다: 꼬리 그대로가 프롬프트의 전부이고, 프롬프트의 열린 색은 tty처럼
 * 입력에 이어진다. 꼬리가 폭을 넘으면 읽기 전에 첫 행까지 커서를 올린다(`rewindTail`, TRP-016).
 *
 * 읽기를 시작하며 꼬리를 비운다: 읽는 동안 worker는 메일박스에 정지해 새 출력이 없고, 읽기가 끝나면(Enter, Ctrl+C 취소)
 * 커서가 다음 행 처음이라 꼬리가 없다. 비우지 않으면 다음 읽기가 앞 프롬프트를 물려받는다.
 */
import type { Readline } from "@cp949/runo-xterm-readline";
import { rewindTail, type RewindTerminal } from "./rewind-tail";
import type { TerminalSinks } from "./sinks";

export interface InputReader {
  /**
   * 직전 출력의 꼬리를 프롬프트로 그 자리에 다시 그리고 Enter까지 한 줄을 돌려준다. 꼬리가 없으면 프롬프트 없이 읽는다.
   * `cancelable`이면 읽기 중 Ctrl+C가 `^C` 없이 줄만 바꾸고 `null`로 끝난다(취소 → worker에서 `KeyboardInterrupt`).
   * `signal`이 주어지고 꼬리 정리(flush 대기)가 끝난 시점에 이미 abort됐으면 읽기를 시작하지 않고 `null`을 돌려준다
   * (실행창의 `InputProvider`가 그 사이에 abort되면 죽은 읽기가 남지 않게 한다). 읽는 도중의 abort는 호출자가
   * `Readline.cancelRead()`로 끝낸다.
   * `options.history`가 `false`면 제출한 줄을 history에 넣지 않는다(벤더 `ReadOptions.history`, 실행창 `input()`). 생략하면
   * 벤더 기본대로 기록한다(repl `input()`).
   */
  read(
    cancelable: boolean,
    signal?: AbortSignal,
    options?: { history?: false },
  ): Promise<string | null>;
}

/**
 * 세션(sink 세트)마다 하나. 순서: rewindTail(flush) → 꼬리 재조회 → resetTail → readline.read(꼬리).
 * `createReplReader`와 한 함수로 일반화하지 않는다(프롬프트 합성과 SGR 리셋이 다르다).
 * RD-013의 auto-indent 래퍼는 `readline` 자리에 끼운다.
 */
export function createInputReader(
  readline: Pick<Readline, "read">,
  term: RewindTerminal,
  sinks: Pick<TerminalSinks, "tail" | "resetTail">,
): InputReader {
  return {
    async read(cancelable, signal, options) {
      await rewindTail(term, sinks.tail());
      // flush를 기다리는 사이에 abort됐으면 읽기를 열지 않는다(열면 아무도 끝내지 않는 읽기가 남는다).
      if (signal?.aborted) return null;
      // flush를 기다리는 사이에 온 출력을 반영하려고 꼬리를 다시 읽는다.
      const tail = sinks.tail();
      sinks.resetTail();
      // history 키는 `false`일 때만 넣는다(생략 호출의 벤더 옵션은 전과 같다).
      return readline.read(
        tail,
        options?.history === false
          ? { cancelable, history: false }
          : { cancelable },
      );
    },
  };
}
