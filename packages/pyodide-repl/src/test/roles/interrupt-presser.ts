/**
 * 눌림 스레드 역할(시험 전용, TRP-029). 실행 스레드가 Python에 막혀 있는 동안 별도 스레드가 interrupt buffer에
 * SIGINT를 써서 main의 Ctrl+C를 흉내낸다. 블로킹 실행 중에는 실행 스레드의 `setTimeout`이 돌지 못해 눌림을 같은
 * 스레드에서 예약할 수 없다.
 *
 * workerData: `{ buffer, ctl }`. 둘 다 SharedArrayBuffer 위의 Int32Array다. `ctl[0]`은 "Python이 시나리오에 들어갔다"는
 * 표시로, 시험이 Python에서 부르는 JS 함수가 1로 쓰고 `Atomics.notify`한다.
 * 눌림 시각은 스레드 간에 같은 단조 시계인 `process.hrtime.bigint()`로 잰다(`performance.now()`는 스레드마다 원점이 다르다).
 */
import { parentPort, workerData } from "node:worker_threads";
import { signalInterrupt } from "../../protocol/interrupt-protocol";

export type PresserCommand =
  | {
      kind: "press";
      /** 기준 시각부터 눌림까지의 지연(ms). 오름차순. */
      offsets: number[];
      /** true면 요청 번호를 올리지 않고 SIGINT 슬롯만 다시 쓴다(main 재전송 흉내). */
      raw?: boolean;
      /** 기본 true. `ctl[0]`이 1이 될 때까지(최대 5초) 기다린 뒤 그 시각을 기준으로 삼는다. false면 명령을 받은 시각. */
      waitStarted?: boolean;
    }
  /** `ctl[0]`을 0으로 되돌린다(라운드 반복용). */
  | { kind: "reset" };

export type PresserEvent =
  | { kind: "pressed"; count: number; atMs: number[] }
  | { kind: "not-started" }
  | { kind: "reset" };

interface PresserData {
  buffer: Int32Array;
  ctl: Int32Array;
}

const port = parentPort;
if (!port) throw new Error("worker 스레드에서만 실행한다");
const { buffer, ctl } = workerData as PresserData;
const pause = new Int32Array(new SharedArrayBuffer(4));

/** 마지막 1.5ms는 스핀으로 기다려 밀리초 미만 오차를 줄인다. */
function sleepUntil(target: bigint): void {
  for (;;) {
    const remain = Number(target - process.hrtime.bigint()) / 1e6;
    if (remain <= 0) return;
    if (remain > 2) Atomics.wait(pause, 0, 0, remain - 1.5);
  }
}

function post(event: PresserEvent): void {
  port?.postMessage(event);
}

port.on("message", (command: PresserCommand) => {
  if (command.kind === "reset") {
    Atomics.store(ctl, 0, 0);
    post({ kind: "reset" });
    return;
  }
  const { offsets, raw = false, waitStarted = true } = command;
  if (waitStarted && Atomics.wait(ctl, 0, 0, 5000) === "timed-out") {
    post({ kind: "not-started" });
    return;
  }
  const base = process.hrtime.bigint();
  const atMs: number[] = [];
  for (const offset of offsets) {
    sleepUntil(base + BigInt(Math.round(offset * 1e6)));
    if (raw) Atomics.compareExchange(buffer, 0, 0, 2);
    else signalInterrupt(buffer);
    atMs.push(Number(process.hrtime.bigint() - base) / 1e6);
  }
  post({ kind: "pressed", count: offsets.length, atMs });
});
