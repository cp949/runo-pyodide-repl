/**
 * worker 부팅 시퀀스(01-protocols.md 5절 S1의 RD-004~RD-006 부분, 00-architecture.md 3.1). 초기화 프레임을 받은 뒤
 * pyodide 로드 → 콘솔 생성 → Ctrl+C 연결 → stdin 배선 → `ready` → 배너 → REPL 루프 순서로 진행한다. 로더는 주입해 node에서 npm
 * `loadPyodide`로 시험하고 브라우저에서는 CDN 로더(`loadPyodideFromCdn`)를 쓴다.
 */
import type { PyodideInterface } from "pyodide";
import type { InitFrame } from "../protocol/init-frame";
import {
  acknowledgeInterrupt,
  consumeInterrupt,
  discardPendingInterrupt,
  hasPendingInterrupt,
  readRequestSeq,
  signalInterrupt,
} from "../protocol/interrupt-protocol";
import { createRpc } from "../protocol/rpc";
import { createMailboxReader } from "../protocol/stdin-mailbox";
import { createConsole, type ConsoleSinks, type ReplConsole } from "./console";
import { connectInterrupts } from "./interrupt-buffer";
import { startInterruptWatch } from "./interrupt-watch";
import { runReplLoop } from "./repl-loop";
import type { InterruptIdle } from "./sigint-handler";
import { createStdinCallback } from "./stdin-callback";
import { createSubmissionRunner } from "./submission-runner";
import { suppressWebLoopReraise } from "./webloop-reraise";

export interface BootDeps {
  loadPyodide(indexURL: string): Promise<PyodideInterface>;
}

/**
 * 순서: RPC 생성 → loadPyodide → createConsole → suppressWebLoopReraise → connectInterrupts → setStdin → ntf ready →
 * ntf writeOutput(BANNER) → 감시 타이머 시작 → REPL 루프 실행(00-architecture.md 3.1(5)). `suppressWebLoopReraise`
 * (WebLoop의 KeyboardInterrupt·SystemExit 재보고 억제, 03-ctrl-c.md 2.8)는 콘솔 생성 직후·Ctrl+C 연결 전에 한 번만
 * 부른다. `connectInterrupts`(SIGINT 핸들러 설치 → 남은 SIGINT 폐기 → 버퍼 연결)는 부팅 중 눌림이 시작 코드를 죽이지
 * 않도록 `setStdin`보다 앞이다(03-ctrl-c.md 2.6). 로드·콘솔 생성·재보고 억제·Ctrl+C 연결·stdin 배선 실패는 ntf
 * loadFailed(String(error))로 알리고 돌아온다(worker는 살아 있다). 감시 타이머(`startInterruptWatch`, 03-ctrl-c.md
 * 2.5)는 루프 직전에 켜고 루프가 끝나면(`exit()`) `finally`에서 끈다.
 */
export async function bootReplWorker(
  frame: InitFrame,
  deps: BootDeps,
): Promise<void> {
  const rpc = createRpc(frame.rpcPort); // 이 RD에는 main→worker 요청 핸들러가 없다(complete는 RD-015)
  const interruptBuffer = frame.interruptBuffer;
  const sinks: ConsoleSinks = {
    write: (text) => rpc.notify("write", text),
    writeErrorRaw: (text) => rpc.notify("writeErrorRaw", text),
  };
  let repl: ReplConsole;
  let pyodide: PyodideInterface;
  let interruptIdle: InterruptIdle;
  try {
    pyodide = await deps.loadPyodide(frame.pyodide.indexURL);
    repl = createConsole(pyodide, sinks, {
      topLevelAwait: frame.topLevelAwait,
    });
    // WebLoop의 KeyboardInterrupt·SystemExit 재보고 억제. 세션당 1회, 실패해도 REPL 동작은 그대로다(경고만 남는다).
    suppressWebLoopReraise(pyodide, {
      warn: (message) => console.warn(message),
    });
    // time.sleep 조각 교체 → SIGINT 핸들러 설치 → 폐기 → 버퍼 연결. 폴링은 연결 뒤에 시작하므로 이 순서가 부팅 중
    // 눌림으로부터 시작 코드를 지킨다.
    // `worker/`가 `protocol/`을 import하지 않도록 프로토콜 함수는 여기서 클로저로 넣는다. 실패는 loadFailed다.
    interruptIdle = connectInterrupts(
      pyodide,
      repl.pyconsole,
      interruptBuffer,
      {
        ack: () => acknowledgeInterrupt(interruptBuffer),
        seq: () => readRequestSeq(interruptBuffer),
        discard: () => discardPendingInterrupt(interruptBuffer),
        warn: (message) => console.warn(message),
      },
    );
    const mailbox = createMailboxReader({
      ctrl: frame.stdinCtrl,
      data: frame.stdinData,
    });
    // input()·sys.stdin 읽기. 알림을 먼저 올리고 Atomics.wait로 멈춘다(01-protocols.md 1.3). 콘솔에는 stdin_callback을
    // 넘기지 않으므로(02-console-core.md) 이 전역 설정이 그대로 쓰인다.
    pyodide.setStdin({
      stdin: createStdinCallback({
        requestInput: (cancelable) => rpc.notify("readInput", cancelable),
        wait: () => mailbox.wait(),
        // 취소 변환의 두 단계. `connectInterrupts` 뒤라 버퍼가 연결돼 있어 `checkInterrupt()`가 EINTR를 던진다.
        signalInterrupt: () => signalInterrupt(interruptBuffer),
        checkInterrupt: () => pyodide.checkInterrupt(),
      }),
    });
    rpc.notify("ready", { pyodideVersion: pyodide.version });
  } catch (error) {
    rpc.notify("loadFailed", String(error));
    return;
  }
  // sink(println)가 개행을 붙이므로 배너에 개행을 더하지 않는다(TRAP-29).
  rpc.notify("writeOutput", repl.banner);
  const runner = createSubmissionRunner(pyodide, repl, {
    writeOutput: (text) => rpc.notify("writeOutput", text),
    writeError: (text) => rpc.notify("writeError", text),
  });
  // 루프의 readLine 대기 중(atPrompt=true)인지를 감시 타이머의 프롬프트 유휴 폐기가 읽는다(03-ctrl-c.md 2.5).
  let atPrompt = false;
  const stopWatch = startInterruptWatch({
    interruptIdle,
    atPrompt: () => atPrompt,
    hasPending: () => hasPendingInterrupt(interruptBuffer),
    consume: () => consumeInterrupt(interruptBuffer),
    discard: () => discardPendingInterrupt(interruptBuffer),
  });
  // 루프가 끝나면(`exit()`) 세션이 끝난 것이다. 감시 타이머와 깨우기 proxy는 여기서 놓아 준다.
  try {
    await runReplLoop({
      readLine: (prompt, pending) =>
        rpc.call<string | null>("readLine", prompt, pending, true),
      setAtPrompt: (value) => {
        atPrompt = value;
      },
      discardPendingInterrupt: () => discardPendingInterrupt(interruptBuffer),
      run: (line) => runner.run(line),
      onTerminated: () => rpc.notify("sessionTerminated"),
      onError: (error) => {
        console.error("[repl.worker] 루프 오류", error);
        rpc.notify("writeError", `repl 내부 오류: ${String(error)}`);
        try {
          repl.clearPending();
        } catch {
          // 콘솔 상태를 읽을 수 없으면 다음 push가 새 상태를 만든다.
        }
      },
    });
  } finally {
    stopWatch();
    interruptIdle.destroy();
  }
}
