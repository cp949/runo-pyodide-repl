/**
 * 시험용 가짜 `Worker` 공장(jsdom 시험 전용, 패키지 진입점에서 import하지 않는다).
 * 실제 `createRunner`·`startCoreSession`·`MessageChannel`·인터럽트 송신기·stdin 메일박스를 그대로 쓰고 worker 쪽만 흉내 낸다:
 * 초기화 프레임의 포트에 `createRpc`를 붙여 `runCode`를 받고 `ready` 등 알림을 보낸다. 만든 worker 수와 `terminate()` 호출
 * 수를 세어 "살아 있는 worker 수"를 시험이 단언하게 한다(core 시험 `runner.test.ts`의 가짜 worker와 같은 방식).
 */
import {
  PYODIDE_VERSION,
  createRpc,
  type InitFrame,
  type ReadyPayload,
  type Rpc,
  type RunOutcome,
} from "@cp949/runo-pyodide-core";

export const CLEAN_READY: ReadyPayload = {
  pyodideVersion: PYODIDE_VERSION,
  versionMismatch: false,
  degraded: [],
};

export interface PendingRun {
  code: string;
  resolve(outcome: RunOutcome): void;
  reject(error: Error): void;
}

export interface FakeWorker {
  worker: Worker;
  /** `runCode` 요청 대기열. 시험이 결말을 정한다. */
  pending: PendingRun[];
  /** main이 보낸 초기화 프레임(`pyodide.indexURL`·`driver` 옵션). 아직 오지 않았으면 `undefined`. */
  init(): InitFrame | undefined;
  terminated(): boolean;
  /** `ready` 알림(부팅 완료). 초기화 프레임이 도착한 뒤에만 부를 수 있다. */
  ready(): void;
  /** worker `error` 이벤트(크래시)를 발생시킨다. */
  dispatchError(message: string): void;
  /** worker stdout 조각. */
  write(text: string): void;
  /** pyodide 로드 실패 알림(`loadFailed`). */
  loadFailed(message: string): void;
  /** `input()` 읽기 요청(`readInput` 알림). */
  readInput(): void;
  /**
   * REPL worker의 `readLine` 요청(프롬프트가 열림). main의 응답(줄 문자열·`null`·`{ source }`)으로 resolve하는 promise를 돌려준다.
   * `outcome`은 바로 앞 `{ source }` 실행의 결말이다. 초기화 프레임이 도착한 뒤에만 부를 수 있다.
   */
  readLine(prompt?: string, outcome?: RunOutcome): Promise<unknown>;
}

export interface FakeWorkerFactory {
  /** `createWorker` 옵션에 그대로 넘긴다. 부를 때마다 가짜 worker를 하나 만든다. */
  createWorker: () => Worker;
  workers: FakeWorker[];
  /** 만들어졌고 아직 `terminate()`되지 않은 worker 수. */
  live(): number;
  /** 시험이 끝나면 rpc 포트를 정리한다. */
  dispose(): void;
}

export function createFakeWorkerFactory(): FakeWorkerFactory {
  const workers: FakeWorker[] = [];
  const rpcs: Rpc[] = [];

  const createWorker = (): Worker => {
    const errorListeners = new Set<(event: { message?: string }) => void>();
    const pending: PendingRun[] = [];
    let rpc: Rpc | undefined;
    let initFrame: InitFrame | undefined;
    let terminated = false;
    const worker = {
      postMessage: (message: unknown) => {
        const frame = message as InitFrame;
        initFrame = frame;
        rpc = createRpc(frame.rpcPort, {
          runCode: (code: string) =>
            new Promise<RunOutcome>((resolve, reject) => {
              pending.push({ code, resolve, reject });
            }),
        });
        rpcs.push(rpc);
      },
      terminate: () => {
        terminated = true;
      },
      addEventListener: (
        type: string,
        listener: (event: { message?: string }) => void,
      ) => {
        if (type === "error") errorListeners.add(listener);
      },
      removeEventListener: (
        type: string,
        listener: (event: { message?: string }) => void,
      ) => {
        if (type === "error") errorListeners.delete(listener);
      },
    } as unknown as Worker;
    workers.push({
      worker,
      pending,
      init: () => initFrame,
      terminated: () => terminated,
      ready: () => rpc!.notify("ready", CLEAN_READY),
      dispatchError: (message) => {
        for (const listener of errorListeners) listener({ message });
      },
      write: (text) => rpc!.notify("write", text),
      loadFailed: (message) => rpc!.notify("loadFailed", message),
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
    });
    return worker;
  };

  return {
    createWorker,
    workers,
    live: () => workers.filter((w) => !w.terminated()).length,
    dispose: () => {
      for (const rpc of rpcs.splice(0)) rpc.dispose();
    },
  };
}
