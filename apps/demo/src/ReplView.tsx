import { createRepl } from "@cp949/runo-pyodide-repl";
import type { ReplHandle, ReplStatus } from "@cp949/runo-pyodide-repl";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef, useState } from "react";
import { createWorker } from "./create-worker";

/** `globalThis.crossOriginIsolated`가 거짓이면 세션이 없어 리셋 버튼도 못 쓴다(RD-010 확정 8). */
const isolated = globalThis.crossOriginIsolated === true;

/**
 * xterm Terminal을 마운트하고 `createRepl`로 세션을 시작한다(RD-004). Terminal은 이 컴포넌트가 소유한다.
 * 크기는 xterm 기본값(80×24)으로 고정한다(FitAddon 없음). 세션 상태는 코어의 `onStatus`를 그대로 보여준다.
 * `exit()`로 세션이 끝나면(`terminated`) 종료 Alert가 뜬다. worker가 죽으면(`crashed`) 크래시 Alert와
 * 재시작 버튼이 뜬다. 리셋 버튼은 상시 있고 `reset()`을 부른다(RD-010). 터미널은 크래시 중에도 렌더한다 —
 * 화면의 출력이 단서다. top-level await 체크박스는 바뀔 때마다 즉시 `reset({ topLevelAwait })`를 부른다
 * (RD-012). 저장하지 않으므로 새로고침하면 항상 꺼짐이다. 리셋 버튼·크래시 재시작은 무인자라 마지막
 * 값을 유지한다(sticky, 코어가 보관).
 */
export function ReplView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const replRef = useRef<ReplHandle | null>(null);
  const [status, setStatus] = useState<ReplStatus>("loading");
  const [crashMessage, setCrashMessage] = useState<string | null>(null);
  const [topLevelAwait, setTopLevelAwait] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;

    const terminal = new Terminal({ cursorBlink: true });
    terminal.open(container);
    terminal.focus();
    const repl = createRepl({
      terminal,
      createWorker,
      onStatus: setStatus,
      onCrash: setCrashMessage,
    });
    replRef.current = repl;

    // StrictMode의 mount → cleanup → mount에서도 worker·Terminal·줄 편집기가 남지 않게 정리한다.
    return () => {
      replRef.current = null;
      repl.dispose();
      terminal.dispose();
    };
  }, []);

  return (
    <>
      <p>
        status: <output data-testid="status">{status}</output>
      </p>
      <button
        type="button"
        data-testid="reset"
        disabled={!isolated}
        onClick={() => replRef.current?.reset()}
      >
        세션 리셋
      </button>
      <label>
        <input
          type="checkbox"
          data-testid="top-level-await"
          checked={topLevelAwait}
          disabled={!isolated}
          onChange={(e) => {
            const on = e.target.checked;
            setTopLevelAwait(on);
            replRef.current?.reset({ topLevelAwait: on });
          }}
        />{" "}
        top-level await
      </label>
      {status === "terminated" && (
        <div role="alert" data-testid="terminated">
          Python session terminated. "세션 리셋" 버튼으로 새 세션을 시작하세요.
        </div>
      )}
      {status === "crashed" && (
        <div role="alert" data-testid="crashed">
          worker가 예기치 않게 종료됐습니다: {crashMessage}{" "}
          <button
            type="button"
            data-testid="restart"
            onClick={() => {
              replRef.current?.reset();
              setCrashMessage(null);
            }}
          >
            재시작
          </button>
        </div>
      )}
      <div ref={containerRef} data-testid="terminal" />
    </>
  );
}
