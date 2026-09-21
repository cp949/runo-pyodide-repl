import { createRepl } from "@cp949/runo-pyodide-repl";
import type { ReplStatus } from "@cp949/runo-pyodide-repl";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef, useState } from "react";
import { createWorker } from "./create-worker";

/**
 * xterm Terminal을 마운트하고 `createRepl`로 세션을 시작한다(RD-004). Terminal은 이 컴포넌트가 소유한다.
 * 크기는 xterm 기본값(80×24)으로 고정한다(FitAddon 없음). 세션 상태는 코어의 `onStatus`를 그대로 보여준다.
 * 입력은 RD-005(worker의 REPL 루프)까지 아무 동작도 하지 않는다.
 */
export function ReplView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<ReplStatus>("loading");

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;

    const terminal = new Terminal({ cursorBlink: true });
    terminal.open(container);
    terminal.focus();
    const repl = createRepl({ terminal, createWorker, onStatus: setStatus });

    // StrictMode의 mount → cleanup → mount에서도 worker·Terminal·줄 편집기가 남지 않게 정리한다.
    return () => {
      repl.dispose();
      terminal.dispose();
    };
  }, []);

  return (
    <>
      <p>
        status: <output data-testid="status">{status}</output>
      </p>
      <div ref={containerRef} data-testid="terminal" />
    </>
  );
}
