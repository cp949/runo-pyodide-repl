/**
 * 시험용 가짜 `Worker`(시험 전용, 패키지 진입점(`index.ts`·`worker.ts`)과 tsdown entry에서 import하지 않는다).
 * 시험이 `@cp949/runo-pyodide-core/test-utils`(작업공간 `development` 조건 전용 하위 경로)로 가져다 쓴다.
 * 실제 `createRunner`·`startCoreSession`·`MessageChannel`·인터럽트 송신기·stdin 메일박스를 그대로 쓰고 worker 쪽만 흉내 낸다:
 * 초기화 프레임의 포트에 worker 역할 `createRpc`를 붙여 `runCode`를 받고 `ready` 등 알림을 보낸다.
 * core `runner.test.ts`의 `createFakeWorker`와 react `test-utils/fake-worker.ts`의 합집합이다(두 사본은 아직 그대로 둔다).
 * 시험 프레임워크(vitest)에 의존하지 않는다: `terminate()` 호출은 `terminated()`·`terminateCount()`로 센다.
 */
import type { InitFrame } from "../protocol/init-frame";
import { SIGNAL } from "../protocol/interrupt-protocol";
import { createReadyPayload } from "../protocol/ready-payload";
import type { ReadyPayload } from "../protocol/ready-payload";
import { createRpc } from "../protocol/rpc";
import type { Rpc } from "../protocol/rpc";
import type { RunOutcome } from "../protocol/run-outcome";
import { PYODIDE_VERSION } from "../pyodide-version";

/** 문제 없는 `ready` 페이로드(버전 일치·저하 없음). */
export const CLEAN_READY: ReadyPayload = createReadyPayload({
  actual: PYODIDE_VERSION,
  expected: PYODIDE_VERSION,
  degraded: [],
});

export interface PendingRun {
  code: string;
  resolve(outcome: RunOutcome): void;
  reject(error: Error): void;
}

export interface FakeWorker {
  /** `createRunner`의 `createWorker`가 돌려줄 값. */
  worker: Worker;
  /** `runCode` 요청 대기열. 시험이 결말을 정한다. */
  pending: PendingRun[];
  /** main이 보낸 초기화 프레임. 아직 오지 않았으면 `undefined`. */
  init(): InitFrame | undefined;
  /** 초기화 프레임(도착한 뒤에만 부른다). */
  frame(): InitFrame;
  /** `terminate()`가 한 번이라도 불렸는지. */
  terminated(): boolean;
  /** `terminate()` 호출 횟수. */
  terminateCount(): number;
  /** `ready` 알림(부팅 완료). 초기화 프레임이 도착한 뒤에만 부를 수 있다. */
  ready(payload?: ReadyPayload): void;
  /** pyodide 로드 실패 알림(`loadFailed`). */
  loadFailed(message: string): void;
  /** worker가 보내는 `crashed` 알림(부팅 뒤 루프의 잡히지 않은 예외). */
  crashedNotice(message: string): void;
  /** worker `error` 이벤트(크래시)를 발생시킨다. */
  dispatchError(message: string): void;
  /** worker stdout 조각. */
  write(text: string): void;
  /** worker stderr 원문 조각(`writeErrorRaw`). */
  writeError(text: string): void;
  /** `input()` 읽기 요청(`readInput` 알림). */
  readInput(): void;
  /**
   * REPL worker의 `readLine` 요청(프롬프트가 열림). main의 응답(줄 문자열·`null`·`{ source }`)으로 resolve하는 promise를 돌려준다.
   * `outcome`은 바로 앞 `{ source }` 실행의 결말이다. createRunner(`run` 계열)는 쓰지 않는다.
   */
  readLine(prompt?: string, outcome?: RunOutcome): Promise<unknown>;
  /** stdin 메일박스 STATE(`protocol/stdin-mailbox.ts`의 IDLE·READY·CANCELLED·ERROR). */
  mailboxState(): number;
  /** 메일박스에 실린 한 줄(`deliver` 결과). */
  mailboxText(): string;
  /** 인터럽트 버퍼의 마지막 눌림 슬롯. */
  signal(): number;
  /** 이 worker의 rpc 포트를 정리한다. */
  dispose(): void;
}

type ErrorListener = (event: { message?: string }) => void;

/** 가짜 worker 하나를 만든다. 시험이 끝나면 `dispose()`로 rpc 포트를 정리한다. */
export function createFakeWorker(): FakeWorker {
  const errorListeners = new Set<ErrorListener>();
  const pending: PendingRun[] = [];
  let frame: InitFrame | undefined;
  let rpc: Rpc | undefined;
  let terminateCount = 0;
  const worker = {
    postMessage: (message: unknown) => {
      frame = message as InitFrame;
      rpc = createRpc(frame.rpcPort, {
        runCode: (code: string) =>
          new Promise<RunOutcome>((resolve, reject) => {
            pending.push({ code, resolve, reject });
          }),
      });
    },
    terminate: () => {
      terminateCount += 1;
    },
    addEventListener: (type: string, listener: ErrorListener) => {
      if (type === "error") errorListeners.add(listener);
    },
    removeEventListener: (type: string, listener: ErrorListener) => {
      if (type === "error") errorListeners.delete(listener);
    },
  } as unknown as Worker;
  return {
    worker,
    pending,
    init: () => frame,
    frame: () => frame!,
    terminated: () => terminateCount > 0,
    terminateCount: () => terminateCount,
    ready: (payload = CLEAN_READY) => rpc!.notify("ready", payload),
    loadFailed: (message) => rpc!.notify("loadFailed", message),
    crashedNotice: (message) => rpc!.notify("crashed", { message }),
    dispatchError: (message) => {
      for (const listener of errorListeners) listener({ message });
    },
    write: (text) => rpc!.notify("write", text),
    writeError: (text) => rpc!.notify("writeErrorRaw", text),
    readInput: () => rpc!.notify("readInput", true),
    readLine: (prompt = ">>> ", outcome) => {
      const request =
        outcome === undefined
          ? rpc!.call("readLine", prompt, undefined, true)
          : rpc!.call("readLine", prompt, undefined, true, outcome);
      // 언마운트로 rpc가 정리되면 reject된다. 시험이 기다리지 않은 요청이 처리되지 않은 rejection이 되지 않게 한다.
      request.catch(() => {});
      return request;
    },
    mailboxState: () => Atomics.load(frame!.stdinCtrl, 0),
    mailboxText: () =>
      new TextDecoder().decode(
        frame!.stdinData.slice(0, Atomics.load(frame!.stdinCtrl, 1)),
      ),
    signal: () => Atomics.load(frame!.interruptBuffer, SIGNAL),
    dispose: () => rpc?.dispose(),
  };
}

export interface FakeWorkerFactory {
  /** `createWorker` 옵션에 그대로 넘긴다. 부를 때마다 가짜 worker를 하나 만든다. */
  createWorker: () => Worker;
  /** 만든 순서대로의 가짜 worker. */
  workers: FakeWorker[];
  /** 만들어졌고 아직 `terminate()`되지 않은 worker 수. */
  live(): number;
  /** 시험이 끝나면 만든 worker의 rpc 포트를 모두 정리한다. */
  dispose(): void;
}

/** 부를 때마다 가짜 worker를 만들어 `workers`에 쌓는 공장(`createRunner`의 재생성을 시험할 때 쓴다). */
export function createFakeWorkerFactory(): FakeWorkerFactory {
  const workers: FakeWorker[] = [];
  return {
    createWorker: () => {
      const fake = createFakeWorker();
      workers.push(fake);
      return fake.worker;
    },
    workers,
    live: () => workers.filter((w) => !w.terminated()).length,
    dispose: () => {
      for (const fake of workers) fake.dispose();
    },
  };
}
