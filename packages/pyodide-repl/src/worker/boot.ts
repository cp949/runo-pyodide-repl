/**
 * worker 부팅 시퀀스(01-protocols.md 5절 S1의 RD-004 부분, 00-architecture.md 3.1). 초기화 프레임을 받은 뒤
 * pyodide 로드 → 콘솔 생성 → `ready` → 배너 → 시험용 스크립트 순서로 진행한다. 로더는 주입해 node에서 npm `loadPyodide`로
 * 시험하고 브라우저에서는 CDN 로더(`loadPyodideFromCdn`)를 쓴다.
 */
import type { PyodideInterface } from "pyodide";
import type { InitFrame } from "../protocol/init-frame";
import { createRpc } from "../protocol/rpc";
import { createConsole, type ConsoleSinks, type ReplConsole } from "./console";

export interface BootDeps {
  loadPyodide(indexURL: string): Promise<PyodideInterface>;
}

/** RD-004 임시: REPL 루프 대신 배너 뒤에 실행한다. RD-005의 REPL 루프가 이 상수와 실행 루프를 삭제한다. */
export const DEMO_LINES: readonly string[] = [
  "import sys, time",
  'print("x", end="")',
  "time.sleep(0.5)",
  'print("\\r50%", end="")',
  "time.sleep(0.5)",
  'print("\\r100%")',
  'print("err", file=sys.stderr)',
];

/**
 * 순서: RPC 생성 → loadPyodide → createConsole → ntf ready → ntf writeOutput(BANNER) → DEMO_LINES 순서 실행.
 * 로드·콘솔 생성 실패는 ntf loadFailed(String(error))로 알리고 돌아온다(worker는 살아 있다).
 */
export async function bootReplWorker(
  frame: InitFrame,
  deps: BootDeps,
): Promise<void> {
  const rpc = createRpc(frame.rpcPort); // 이 RD에는 main→worker 요청 핸들러가 없다(complete는 RD-008)
  const sinks: ConsoleSinks = {
    write: (text) => rpc.notify("write", text),
    writeErrorRaw: (text) => rpc.notify("writeErrorRaw", text),
  };
  let repl: ReplConsole;
  try {
    const pyodide = await deps.loadPyodide(frame.pyodide.indexURL);
    repl = createConsole(pyodide, sinks, {
      topLevelAwait: frame.topLevelAwait,
    });
    rpc.notify("ready", { pyodideVersion: pyodide.version });
  } catch (error) {
    rpc.notify("loadFailed", String(error));
    return;
  }
  // sink(println)가 개행을 붙이므로 배너에 개행을 더하지 않는다(TRAP-29).
  rpc.notify("writeOutput", repl.banner);
  for (const line of DEMO_LINES) {
    const result = await repl.runLine(line);
    if (result.kind !== "complete") {
      console.error("[repl.worker] 시험용 스크립트 실패", line, result);
    }
  }
}
