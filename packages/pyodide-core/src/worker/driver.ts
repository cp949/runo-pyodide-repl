/**
 * worker 커널(`runWorker`)과 driver의 경계. 커널은 RPC 생성 → pyodide 로드 → (driver 콘솔) → webloop 억제 → Ctrl+C 연결 →
 * stdin 배선 → `ready` → (driver 실행) → 감시 타이머 순서를 소유하고, driver는 콘솔 확장과 세션 제어 흐름만 낸다.
 * 이 모양은 REPL이 쓰는 것만 담는다(RD-020, 실행 driver는 RD-022). 공개 API로 문서화하기 전의 내부 계약이다.
 */
import type { PyodideInterface } from "pyodide";
import type { InitFrame } from "../protocol/init-frame";
import type { Rpc, RpcHandlers } from "../protocol/rpc";
import type { ConsoleSinks, PyodideConsoleProxy } from "./core-console";

/** `createConsole` 단계에서 driver가 받는 것. pyodide는 로드된 상태이고 콘솔은 아직 없다. */
export interface ConsoleContext {
  pyodide: PyodideInterface;
  /** `write`·`writeErrorRaw` RPC 알림에 연결된 sink. 전역 Writer와 콘솔 콜백이 같이 쓴다. */
  sinks: ConsoleSinks;
  /** 검증된 초기화 프레임. 이 DELTA에서는 driver 옵션(`topLevelAwait`)이 프레임 최상위에 있다(DELTA-04에서 `driver` 필드로). */
  frame: InitFrame;
}

/** `run` 단계에서 driver가 받는 것. `ready` 알림은 이미 나갔다. */
export interface RunContext {
  pyodide: PyodideInterface;
  /** `createConsole`이 돌려준 콘솔. */
  pyconsole: PyodideConsoleProxy;
  rpc: Rpc;
  frame: InitFrame;
}

/** worker(= 세션) 한 개의 driver 상태. 세션 상태는 클로저에 둔다. */
export interface WorkerDriverSession {
  /**
   * main이 부를 수 있는 RPC 핸들러. `createRpc` 생성 시에만 받을 수 있어(늦은 등록 API 없음) 콘솔이 생기기 전에도 유효해야 한다.
   * core 핸들러와 이름이 겹치면 생성 시 예외(`composeRpcHandlers`).
   */
  handlers: RpcHandlers;
  /**
   * 콘솔을 만든다(핵심 두 단계 `installStdioWriters`·`createCoreConsole`은 core가 내고, 그 사이·뒤에 driver 단계를 끼운다).
   * 던지면 `loadFailed`다.
   */
  createConsole(context: ConsoleContext): PyodideConsoleProxy;
  /**
   * `ready` 알림 뒤의 세션 제어 흐름. 끝나면 세션이 끝난 것이고(감시 타이머 정지), 던지면 `crashed`다.
   * REPL은 여기서 배너·러너를 만들고 `readLine` 루프를 돈다.
   */
  run(context: RunContext): Promise<void>;
  /** 감시 타이머의 프롬프트 유휴 폐기 판정(03-ctrl-c.md 2.5). driver가 "지금 대상 Python 코드가 없다"고 볼 때 참. */
  atPrompt(): boolean;
}

/** `runWorker({ driver })`가 받는 driver. worker 하나에 세션 하나를 만든다. */
export interface WorkerDriver {
  createSession(): WorkerDriverSession;
}
