/**
 * 실제 worker 스레드 시험 하니스(`// @vitest-environment node` 시험 전용). 역할 스크립트(`src/test/roles/<이름>.ts`)를
 * 스레드로 띄워 main 역할(시험 본문)과 메시지·SharedArrayBuffer로 주고받는다. 스레드는 `Atomics.wait`에 막혀 있어도
 * 시험이 끝날 때 종료된다.
 *
 * 역할 스크립트는 Node의 타입 제거로 실행되므로 enum·namespace를 쓰지 않고 타입 import는 `import type`으로 쓴다.
 * 확장자 없는 상대 import는 `ts-resolve-hook.mjs`가 푼다.
 */
import { Worker } from "node:worker_threads";
import { onTestFinished } from "vitest";

const RESOLVE_HOOK = new URL("./ts-resolve-hook.mjs", import.meta.url).href;

export interface Role {
  /** 스레드에 메시지를 보낸다. `transfer`에 든 MessagePort 등은 소유권이 넘어간다. */
  post(message: unknown, transfer?: readonly unknown[]): void;
  /** 스레드가 보낸 다음 메시지 하나를 기다린다. 스레드가 오류로 죽으면 그 오류로 reject한다. */
  next<T = unknown>(): Promise<T>;
}

interface Waiter {
  resolve(message: unknown): void;
  reject(error: unknown): void;
}

export function spawnRole(name: string, workerData?: unknown): Role {
  const worker = new Worker(new URL(`./roles/${name}.ts`, import.meta.url), {
    execArgv: ["--import", RESOLVE_HOOK],
    workerData,
  });
  const inbox: unknown[] = [];
  const waiters: Waiter[] = [];
  let failure: unknown;

  worker.on("message", (message: unknown) => {
    const waiter = waiters.shift();
    if (waiter) waiter.resolve(message);
    else inbox.push(message);
  });
  worker.on("error", (error) => {
    failure = error;
    for (const waiter of waiters.splice(0)) waiter.reject(error);
  });
  onTestFinished(async () => {
    await worker.terminate();
  });

  return {
    post: (message, transfer) => worker.postMessage(message, transfer as never),
    next: <T>() =>
      new Promise<T>((resolve, reject) => {
        if (inbox.length > 0) return resolve(inbox.shift() as T);
        if (failure) return reject(failure);
        waiters.push({
          resolve: resolve as (message: unknown) => void,
          reject,
        });
      }),
  };
}
