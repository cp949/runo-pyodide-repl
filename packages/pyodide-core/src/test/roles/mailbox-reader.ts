/**
 * 메일박스 worker 쪽 역할. `wait` 명령마다 `Atomics.wait`로 정지한 채 main의 응답을 기다리고 결과를 돌려준다.
 * workerData: `createStdinMailbox()`가 만든 `{ ctrl, data }`(같은 SharedArrayBuffer를 가리킨다).
 */
import { parentPort, workerData } from "node:worker_threads";
import { createMailboxReader } from "../../protocol/stdin-mailbox";
import type { StdinMailboxBuffers } from "../../protocol/stdin-mailbox";

const port = parentPort;
if (!port) throw new Error("worker 스레드에서만 실행한다");
const reader = createMailboxReader(workerData as StdinMailboxBuffers);

port.on("message", (command: string) => {
  if (command !== "wait") return;
  try {
    port.postMessage({ ok: true, value: reader.wait() });
  } catch (error) {
    port.postMessage({
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    });
  }
});
