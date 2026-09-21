import { Readline } from "@cp949/runo-xterm-readline";
import type { Terminal } from "@xterm/xterm";

/**
 * RD-003 시점의 부분 구현이다. 최종 옵션(`createWorker`·`pyodide`·`onStatus` 등)은
 * 그것을 쓰는 RD가 추가한다(`00-architecture.md` 4.1).
 */
export interface ReplOptions {
  /** 호출자가 소유하는 xterm `Terminal`. 코어는 줄 편집기를 붙이기만 하고 dispose하지 않는다. */
  terminal: Terminal;
}

export interface ReplHandle {
  /**
   * 프롬프트를 그리고 Enter까지 한 줄을 읽어 돌려준다. 값은 편집 버퍼 그대로다.
   * 임시 API다. RD-005에서 worker의 REPL 루프가 읽기를 요청하면 핸들에서 빠진다.
   *
   * 열린 읽기가 있는 동안 다시 부르면 `Error`로 reject한다(벤더 `Readline`은 열린 읽기를 교체하고
   * 앞 promise를 끝내지 않는다). `dispose()`나 그 뒤의 호출도 `Error`로 reject한다.
   */
  readLine(prompt: string): Promise<string>;
  /** 대기 중인 읽기를 reject하고 줄 편집기를 뗀다. 두 번 불러도 안전하다. `Terminal`은 dispose하지 않는다. */
  dispose(): void;
}

export function createRepl(options: ReplOptions): ReplHandle {
  // history는 세션(마운트) 동안 메모리에만 둔다. 새로고침 뒤에는 비어 있어야 한다.
  const readline = new Readline({ persist: false });
  options.terminal.loadAddon(readline);

  let reading = false;
  let disposed = false;

  return {
    readLine(prompt) {
      if (disposed) return Promise.reject(new Error("repl disposed"));
      if (reading) return Promise.reject(new Error("이미 읽는 중"));
      reading = true;
      return readline.read(prompt).finally(() => {
        reading = false;
      });
    },
    dispose() {
      disposed = true;
      // 벤더 dispose가 멱등이라 두 번째 호출은 아무것도 하지 않는다.
      readline.dispose();
    },
  };
}
