const PROMPT = ">>> ";

/**
 * RD-003 임시 읽기 루프. `readLine`으로 한 줄을 읽어 `[read] <줄>`로 되찍고 다시 읽는다.
 * "Enter로 한 줄이 호출자에게 전달된다"를 화면에서 보이기 위한 것이며 RD-005에서 worker의 REPL 루프가 대체한다.
 *
 * dispose로 끝난 읽기(reject)는 정상 종료다. React StrictMode는 마운트 직후 정리하므로 이 경로를 늘 지난다.
 * dispose와 무관한 읽기 오류는 호출자가 알 수 있게 던진다.
 */
export async function runEchoLoop(options: {
  readLine: (prompt: string) => Promise<string>;
  print: (text: string) => void;
  isDisposed: () => boolean;
}): Promise<void> {
  for (;;) {
    let line: string;
    try {
      line = await options.readLine(PROMPT);
    } catch (error) {
      if (options.isDisposed()) return;
      throw error;
    }
    // 줄바꿈이 든 줄(Shift+Enter)도 한 줄로 보이도록 JSON 문자열로 되찍는다.
    options.print(`[read] ${JSON.stringify(line)}`);
  }
}
