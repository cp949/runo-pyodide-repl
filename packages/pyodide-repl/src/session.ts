/**
 * 세션 하나(worker 1개)가 필요로 하는 자원·게이트(`00-architecture.md` 4.2). `reset()`(RD-010)이 통째로 교체하는 단위다. interrupt
 * buffer·송신기도 세션마다 새로 만든다(옛 worker는 `terminate()` 뒤에도 한동안 살아 같은 buffer의 SIGINT를 가로챌 수 있다,
 * TRP-049·`14-runner.md` 14.3.5). 핸들(`index.ts`)이 소유하는 `readline`·Ctrl+C 핸들러는 세션을 넘어 산다.
 * 공통 부분(worker·프레임·RPC·`readInput`·게이트·종료)은 core 세션(`startCoreSession`)이, REPL 화면 상호작용은 main driver
 * (`repl-main-driver.ts`)가 맡고 이 모듈은 둘을 조립해 이전과 같은 `ReplSession`을 낸다.
 */
import type { TerminalSurface } from "@cp949/runo-pyodide-terminal/internal";
import type { ReplStatus } from "./index";
import {
  createInterruptBuffer,
  createInterruptSender,
  startCoreSession,
  type CoreSession,
} from "@cp949/runo-pyodide-core";
import { createReplMainDriver } from "./repl-main-driver";
import type { SourceLink } from "./run-source";
import type { SourcePrompt } from "./terminal/source-bridge";
import type { SourceCompletion } from "./worker/complete-source";

export interface StartSessionOptions {
  /** 핸들 소유. 세션을 넘어 산다(`readline`·history 유지). 세션마다 `surface.openIo()`로 입출력을 새로 연다. */
  surface: TerminalSurface;
  /** 세션마다 불린다. */
  createWorker: () => Worker;
  /** 끝 `/`가 붙은 pyodide CDN 위치. */
  indexURL: string;
  /** 초기화 프레임 `driver` 필드에 그대로 싣는다. 값을 바꾸려면 새 세션(RD-012). */
  topLevelAwait: boolean;
  /** 핸들이 소유한 `runSource` 슬롯의 창구. 세션을 넘어 사는 슬롯을 이 세션의 읽기 흐름에 잇는다. */
  source: SourceLink;
  /** 상태가 바뀔 때 부른다. */
  onStatus: (status: ReplStatus) => void;
  /** worker `error` 이벤트 또는 `crashed` 알림(첫 신호만) 뒤 부른다. */
  onCrash?: (message: string) => void;
}

export interface ReplSession {
  /** main이 보는 "Python 실행 중"(`03-ctrl-c.md` 2.7). 거짓이면 Ctrl+C를 에코도 전송도 하지 않는다. */
  pythonRunning(): boolean;
  /** 세션의 sink로 `^C`를 에코한다(핸들의 Ctrl+C 핸들러가 부른다. tty 로컬 에코 흉내, 꼬리 추적에 반영). */
  echoCtrlC(): void;
  /** 이 세션의 interrupt buffer에 눌림(SIGINT) 하나를 쓴다(핸들의 Ctrl+C 핸들러가 `echoCtrlC()` 뒤 부른다). */
  interrupt(): void;
  /** 지금 `runSource`를 받아들일 수 있는가. 부작용이 없다(`repl-main-driver.ts`). */
  sourcePrompt(): SourcePrompt;
  /** 열린 읽기를 가져가 `{ source }`로 응답하도록 준비한다. 받아들일 수 없으면 `false`. */
  sendSource(code: string): boolean;
  /**
   * 이 세션에서 실행할 코드가 더 없어진 지점(`exit()`·로드 실패). 게이트를 닫고 재전송을 멈춘다. 닫지 않으면
   * 잔류 SIGNAL 2를 아무도 소비하지 않아 송신기가 5ms마다 영원히 점검한다(RD-012h(a)).
   */
  endSession(): void;
  /**
   * 옛 읽기를 끝내고(`readline.cancelRead()`) 세션 자원을 정리한다: `ended=true` → (REPL 읽기 열림이면
   * 블록 history 폐기) → `tabReader.readEnded(null)` → `cancelRead()` → `endSession()` →
   * `rpc.dispose()` → `worker.terminate()`. 앞 셋은 main driver의 `terminate` 훅, 뒤 셋은 core 세션이다.
   */
  terminate(): void;
  /** `terminate()` 뒤 참. */
  readonly ended: boolean;
}

export function startSession(options: StartSessionOptions): ReplSession {
  const {
    surface,
    createWorker,
    indexURL,
    topLevelAwait,
    source,
    onStatus,
    onCrash,
  } = options;

  // 세션마다 새 buffer·송신기. 프레임에 넣는 것과 같은 SharedArrayBuffer 뷰를 송신기도 쓴다. 송신기는 `send()` 전에는 타이머가 없어,
  // 아래에서 던져도(worker 생성 실패 등) 따로 정리할 것이 없다.
  const interruptBuffer = createInterruptBuffer();
  const interruptSender = createInterruptSender(interruptBuffer);

  // main driver의 `complete`가 core 세션의 `call`을 참조한다. 실제 Tab을 누를 때(세션이 시작된 뒤)만 불리므로 늦게 채워도 된다.
  const ref: { core?: CoreSession } = {};
  const repl = createReplMainDriver({
    readline: surface.readline,
    // sink 세트·터미널 뷰·stdin 리더는 세션마다 새로 연다. 새 세션이 이전 꼬리를 물려받지 않게(05-output.md 4.1).
    io: surface.openIo(),
    interruptSender,
    topLevelAwait,
    source,
    complete: (code, pending) => {
      if (!ref.core) throw new Error("세션이 아직 시작되지 않았다");
      return ref.core.call<SourceCompletion>("complete", code, pending);
    },
  });
  const session = startCoreSession({
    createWorker,
    indexURL,
    interruptBuffer,
    interruptSender,
    driver: repl.driver,
    output: repl.output,
    onStatus,
    onCrash,
  });
  ref.core = session;

  return {
    pythonRunning: () => session.pythonRunning(),
    echoCtrlC: () => repl.echoCtrlC(),
    interrupt: () => interruptSender.send(),
    sourcePrompt: () => repl.sourcePrompt(),
    sendSource: (code) => repl.sendSource(code),
    endSession: () => session.endSession(),
    terminate: () => session.terminate(),
    get ended() {
      return session.ended;
    },
  };
}
