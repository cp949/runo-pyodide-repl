// @vitest-environment node
/**
 * 프로토콜 코어 통합 시나리오(ROADMAP RD-002). main 역할(시험 본문)과 worker 역할(`src/test/roles/repl-worker.ts`)이 실제
 * worker 스레드로 나뉘어 초기화 프레임·RPC·stdin 메일박스·interrupt buffer를 함께 쓴다. pyodide는 없다.
 */
import { describe, expect, it, onTestFinished } from "vitest";
import { postInitFrame } from "./init-frame";
import type { InitFrame } from "./init-frame";
import {
  ACK,
  createInterruptBuffer,
  SEQ,
  SIGNAL,
  signalInterrupt,
} from "./interrupt-protocol";
import { createRpc } from "./rpc";
import { createMailboxWriter, createStdinMailbox } from "./stdin-mailbox";
import { spawnRole } from "../test/thread";

interface Received {
  line: string;
  text: string | null;
  signal: number;
  seq: number;
}

/** 시나리오를 끝까지 돌리고 main이 관찰한 것을 돌려준다. */
async function runScenario() {
  const channel = new MessageChannel();
  const mailbox = createStdinMailbox();
  const frame: InitFrame = {
    kind: "init",
    rpcPort: channel.port1,
    interruptBuffer: createInterruptBuffer(),
    stdinCtrl: mailbox.ctrl,
    stdinData: mailbox.data,
    topLevelAwait: false,
    pyodide: { indexURL: "https://cdn.jsdelivr.net/pyodide/v314.0.7/full/" },
  };
  const writer = createMailboxWriter(mailbox);
  const log: string[] = [];
  let completeResult: unknown;
  let resolveReceived: (received: Received) => void = () => {};
  const receivedPromise = new Promise<Received>(
    (resolve) => (resolveReceived = resolve),
  );

  const rpc = createRpc(channel.port2, {
    readLine: async (prompt: string) => {
      log.push(`readLine:${prompt}`);
      // worker는 이 응답을 기다리는 동안 이벤트 루프가 살아 있어 main의 요청에 답한다.
      completeResult = await rpc.call("complete", "os.pa", undefined);
      return 'x = input("x: ")';
    },
    write: (text: string) => void log.push(`write:${text}`),
    readInput: async () => {
      log.push("readInput");
      // 이 시점 worker는 wait()에서 정지해 있다. SIGINT를 먼저 쓰고 값을 깨운다.
      signalInterrupt(frame.interruptBuffer);
      await writer.deliver("abc");
    },
    received: (received: Received) => resolveReceived(received),
  });
  onTestFinished(() => rpc.dispose());

  const role = spawnRole("repl-worker");
  postInitFrame(
    { postMessage: (message, transfer) => role.post(message, transfer) },
    frame,
  );
  const received = await receivedPromise;
  return {
    log,
    completeResult,
    received,
    interruptBuffer: frame.interruptBuffer,
  };
}

describe("초기화 프레임 → readLine → complete → readInput → wait/deliver", () => {
  it("worker의 wait()가 main이 deliver한 값을 받는다", async () => {
    const { received } = await runScenario();

    expect(received.line).toBe('x = input("x: ")');
    expect(received.text).toBe("abc");
  });

  it("readLine 응답을 기다리는 동안 worker가 main의 complete 요청에 답한다", async () => {
    const { completeResult } = await runScenario();

    expect(completeResult).toEqual({ completions: ["path"], start: 3 });
  });

  // 같은 포트를 타는 메시지는 FIFO다. 출력 알림이 읽기 요청보다 먼저 main에 닿는 규칙(01-protocols.md 1.3).
  it("main은 readLine, 출력, readInput 알림을 worker가 보낸 순서대로 받는다", async () => {
    const { log } = await runScenario();

    expect(log).toEqual(["readLine:>>> ", "write:x: ", "readInput"]);
  });

  it("초기화 프레임으로 넘긴 interrupt buffer를 양쪽이 같은 메모리로 본다", async () => {
    const { received, interruptBuffer } = await runScenario();

    // worker가 wait()에서 깨어난 뒤 main이 deliver 전에 쓴 SIGINT와 요청 번호가 보였다.
    expect(received.signal).toBe(2);
    expect(received.seq).toBe(1);
    // worker가 폐기하며 올린 ack와 비운 SIGINT가 main 쪽 뷰에 보인다.
    expect(Atomics.load(interruptBuffer, ACK)).toBe(1);
    expect(Atomics.load(interruptBuffer, SIGNAL)).toBe(0);
    expect(Atomics.load(interruptBuffer, SEQ)).toBe(1);
  });
});
