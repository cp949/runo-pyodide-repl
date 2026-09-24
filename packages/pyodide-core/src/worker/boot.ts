/**
 * worker 부팅 시퀀스(01-protocols.md 5절 S1, 00-architecture.md 3.1). 초기화 프레임을 받은 뒤
 * pyodide 로드 → 콘솔 생성 → Ctrl+C 연결 → stdin 배선 → `ready` → driver 실행 순서로 진행한다. 로더는 주입해 node에서 npm
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
import { composeRpcHandlers } from "../protocol/rpc-handlers";
import { createMailboxReader } from "../protocol/stdin-mailbox";
import type { ConsoleSinks } from "./core-console";
import type { WorkerDriver } from "./driver";
import { connectInterrupts } from "./interrupt-buffer";
import { startInterruptWatch } from "./interrupt-watch";
import type { InterruptIdle } from "./sigint-handler";
import { createStdinCallback } from "./stdin-callback";
import { suppressWebLoopReraise } from "./webloop-reraise";

export interface BootDeps {
  loadPyodide(indexURL: string): Promise<PyodideInterface>;
}

export interface BootOptions extends BootDeps {
  driver: WorkerDriver;
}

/**
 * core가 worker 쪽에 등록하는 RPC 핸들러(main → worker 요청). 지금은 없다(main→worker 요청은 driver의 `complete`뿐이다).
 * 방향이 반대인 main 쪽 표(worker → main: `write`·`readInput` 등)는 `session/core-session.ts`의 `CORE_MAIN_HANDLER_NAMES`다.
 * 두 표는 서로 다른 RPC 끝점에 붙어 이름 충돌 검사도 따로 한다(각 끝점에서 core 표 + driver 표를 `composeRpcHandlers`로 합성).
 */
const CORE_WORKER_HANDLERS = {};

/**
 * 순서: driver 옵션 검증(`parseOptions`) → driver 세션 생성 → RPC 생성(core + driver 핸들러 합성) → loadPyodide → `driver.createConsole` →
 * suppressWebLoopReraise → connectInterrupts → setStdin → ntf ready → 감시 타이머 시작 → `driver.run`(00-architecture.md
 * 3.1(5)). `suppressWebLoopReraise`(WebLoop의 KeyboardInterrupt·SystemExit 재보고 억제, 03-ctrl-c.md 2.8)는 콘솔 생성
 * 직후·Ctrl+C 연결 전에 한 번만 부른다. `connectInterrupts`(SIGINT 핸들러 설치 → 남은 SIGINT 폐기 → 버퍼 연결)는 부팅 중
 * 눌림이 시작 코드를 죽이지 않도록 `setStdin`보다 앞이다(03-ctrl-c.md 2.6). 로드·콘솔 생성·재보고 억제·Ctrl+C 연결·stdin
 * 배선 실패는 ntf loadFailed(String(error))로 알리고 돌아온다(worker는 살아 있다). 감시 타이머(`startInterruptWatch`,
 * 03-ctrl-c.md 2.5)는 driver 실행 직전에 켜고 실행이 끝나면(`exit()`) `finally`에서 끈다. `ready` 알림 뒤(감시·driver 실행)의
 * 잡히지 않은 예외는 ntf crashed({ message: String(error) })로 나간다(RD-010, worker는 살아 있을 수 있다).
 */
export async function bootWorker(
  frame: InitFrame,
  options: BootOptions,
): Promise<void> {
  // 옵션이 틀리면 여기서 던진다: RPC·pyodide 로드 어느 것도 시작하기 전이다(프레임 검증 실패와 같이 `runWorker`가 로그로 남긴다).
  const driverOptions = options.driver.parseOptions(frame.driver);
  const session = options.driver.createSession(driverOptions);
  // driver 핸들러(`complete` 등)는 createRpc 생성 시에만 등록할 수 있다(`protocol/rpc.ts`, 나중 등록 API 없음).
  const rpc = createRpc(
    frame.rpcPort,
    composeRpcHandlers(CORE_WORKER_HANDLERS, session.handlers),
  );
  const interruptBuffer = frame.interruptBuffer;
  const sinks: ConsoleSinks = {
    write: (text) => rpc.notify("write", text),
    writeErrorRaw: (text) => rpc.notify("writeErrorRaw", text),
  };
  let pyconsole: ReturnType<typeof session.createConsole>;
  let pyodide: PyodideInterface;
  let interruptIdle: InterruptIdle | undefined;
  try {
    pyodide = await options.loadPyodide(frame.pyodide.indexURL);
    pyconsole = session.createConsole({ pyodide, sinks, frame });
    // WebLoop의 KeyboardInterrupt·SystemExit 재보고 억제. 세션당 1회, 실패해도 REPL 동작은 그대로다(경고만 남는다).
    suppressWebLoopReraise(pyodide, {
      warn: (message) => console.warn(message),
    });
    // time.sleep 조각 교체 → SIGINT 핸들러 설치 → 폐기 → 버퍼 연결. 폴링은 연결 뒤에 시작하므로 이 순서가 부팅 중
    // 눌림으로부터 시작 코드를 지킨다.
    // 프로토콜 함수는 여기서 클로저로 넣는다(`interrupt-buffer.ts`는 `protocol/`을 import하지 않는다). 실패는 loadFailed다.
    interruptIdle = connectInterrupts(pyodide, pyconsole, interruptBuffer, {
      ack: () => acknowledgeInterrupt(interruptBuffer),
      seq: () => readRequestSeq(interruptBuffer),
      discard: () => discardPendingInterrupt(interruptBuffer),
      warn: (message) => console.warn(message),
    });
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
    // connectInterrupts는 성공했지만 이후(setStdin·ready 알림 등)에서 던지면 SIGINT 핸들러·time.sleep 조각이 이미
    // 설치돼 있다. loadFailed를 알리기 전에 interrupt_idle(PyProxy)을 destroy해 부분 설치 상태를 정리한다.
    interruptIdle?.destroy();
    rpc.notify("loadFailed", String(error));
    return;
  }
  // 이 지점부터의 잡히지 않은 예외는 loadFailed가 아니라 crashed다(RD-010, worker는 살아 있을 수 있다).
  try {
    // 세션의 프롬프트 대기 여부를 감시 타이머의 프롬프트 유휴 폐기가 읽는다(03-ctrl-c.md 2.5, 01-protocols.md 1.2).
    // driver가 REPL 루프의 `readLine` 대기 중일 때 참이다.
    const stopWatch = startInterruptWatch({
      interruptIdle,
      atPrompt: () => session.atPrompt(),
      hasPending: () => hasPendingInterrupt(interruptBuffer),
      consume: () => consumeInterrupt(interruptBuffer),
      discard: () => discardPendingInterrupt(interruptBuffer),
    });
    // driver 실행이 끝나면(`exit()`) 세션이 끝난 것이다. 감시 타이머는 여기서 놓아 준다.
    try {
      await session.run({ pyodide, pyconsole, rpc, frame });
    } finally {
      stopWatch();
    }
  } catch (error) {
    rpc.notify("crashed", { message: String(error) });
  } finally {
    // 깨우기 proxy는 정상 종료·크래시 어느 쪽이든 여기서 놓아 준다.
    interruptIdle.destroy();
  }
}
