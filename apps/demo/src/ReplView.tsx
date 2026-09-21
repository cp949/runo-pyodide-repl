import { createRepl } from "@cp949/runo-pyodide-repl";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef } from "react";
import { runEchoLoop } from "./echo-loop";

/**
 * xterm Terminal을 마운트하고 `createRepl`로 줄 편집기를 붙인다(RD-003).
 * Terminal은 이 컴포넌트가 소유한다. 크기는 xterm 기본값(80×24)으로 고정한다(FitAddon 없음).
 * 읽기 루프는 pyodide 없이 받은 줄을 되찍는 임시 루프다. RD-005에서 worker의 REPL 루프가 대체한다.
 */
export function ReplView() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;

    const terminal = new Terminal({ cursorBlink: true });
    terminal.open(container);
    terminal.focus();
    const repl = createRepl({ terminal });
    let disposed = false;
    runEchoLoop({
      readLine: (prompt) => repl.readLine(prompt),
      print: (text) => terminal.write(`${text}\r\n`),
      isDisposed: () => disposed,
    }).catch((error: unknown) => {
      console.error("[demo] 읽기 루프 오류", error);
    });

    // StrictMode의 mount → cleanup → mount에서도 Terminal과 줄 편집기가 남지 않게 정리한다.
    return () => {
      disposed = true;
      repl.dispose();
      terminal.dispose();
    };
  }, []);

  return <div ref={containerRef} data-testid="terminal" />;
}
