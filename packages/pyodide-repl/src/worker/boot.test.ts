// @vitest-environment node
/**
 * worker 부팅 시퀀스(`bootReplWorker`) 시험(01-protocols.md 5절 S1의 RD-004 부분).
 * 실제 `MessageChannel` 양 끝에 worker 역할(`bootReplWorker`)과 main 역할(`createRpc` + 기록 핸들러)을 두고
 * 실제 pyodide(node)로 `ready` → 배너 → 시험용 스크립트 출력 순서와 로드 실패 경로를 확인한다.
 * CDN 동적 import(`loadPyodideFromCdn`)는 브라우저 전용이라 여기서는 npm `loadPyodide`를 주입한다.
 */
import { loadPyodide, type PyodideInterface } from "pyodide";
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import type { InitFrame } from "../protocol/init-frame";
import { createInterruptBuffer } from "../protocol/interrupt-protocol";
import { createRpc } from "../protocol/rpc";
import { createStdinMailbox } from "../protocol/stdin-mailbox";
import { bootReplWorker } from "./boot";

let pyodide: PyodideInterface;

beforeAll(async () => {
  pyodide = await loadPyodide();
}, 60_000);

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

const NOTIFICATIONS = [
  "write",
  "writeErrorRaw",
  "writeOutput",
  "writeError",
  "ready",
  "loadFailed",
];

/** worker 역할이 받을 초기화 프레임과, main 역할이 받은 알림 기록(`[이름, ...인자]`). */
function createMainSide() {
  const channel = new MessageChannel();
  const mailbox = createStdinMailbox();
  const frame: InitFrame = {
    kind: "init",
    rpcPort: channel.port1,
    interruptBuffer: createInterruptBuffer(),
    stdinCtrl: mailbox.ctrl,
    stdinData: mailbox.data,
    topLevelAwait: false,
    pyodide: { indexURL: "unused-in-node/" },
  };
  const events: unknown[][] = [];
  const rpc = createRpc(
    channel.port2,
    Object.fromEntries(
      NOTIFICATIONS.map((name) => [
        name,
        (...args: unknown[]) => {
          events.push([name, ...args]);
        },
      ]),
    ),
  );
  cleanups.push(() => {
    rpc.dispose();
    channel.port1.close();
    channel.port2.close();
  });
  /** 알림은 `MessagePort`를 타므로 `await bootReplWorker` 뒤에도 늦게 도착할 수 있다. 50ms 간격으로 최대 5초 기다린다. */
  async function waitFor(predicate: () => boolean): Promise<void> {
    for (let waited = 0; waited < 5000; waited += 50) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("기다리던 알림이 오지 않았다");
  }
  return { frame, events, waitFor };
}

describe("bootReplWorker", () => {
  test("ready → 배너 → 시험용 스크립트 출력 순서로 알림이 온다", async () => {
    const { frame, events, waitFor } = createMainSide();

    await bootReplWorker(frame, { loadPyodide: () => loadPyodide() });
    // 마지막 줄(`print("err", file=sys.stderr)`)의 개행 조각이 마지막 알림이다.
    await waitFor(() =>
      events.some((e) => e[0] === "writeErrorRaw" && e[1] === "\n"),
    );

    const names = events.map((e) => e[0]);
    expect(names[0]).toBe("ready");
    expect(events[0]?.[1]).toEqual({ pyodideVersion: "314.0.7" });
    expect(names[1]).toBe("writeOutput");
    const banner = String(events[1]?.[1]);
    expect(banner.startsWith("Python 3.14.2 (")).toBe(true);
    // sink(println)가 개행을 붙이므로 배너에 개행을 더해 보내지 않는다(TRAP-29).
    expect(banner).not.toMatch(/\n$/);
    const stdout = events
      .filter((e) => e[0] === "write")
      .map((e) => e[1])
      .join("");
    const stderr = events
      .filter((e) => e[0] === "writeErrorRaw")
      .map((e) => e[1])
      .join("");
    expect(stdout).toBe("x\r50%\r100%\n");
    expect(stderr).toBe("err\n");
    expect(names).not.toContain("loadFailed");
  }, 30_000);

  test("로더가 던지면 loadFailed만 오고 ready·배너는 오지 않는다", async () => {
    const { frame, events, waitFor } = createMainSide();

    await bootReplWorker(frame, {
      loadPyodide: async () => {
        throw new Error("boom");
      },
    });
    await waitFor(() => events.length >= 1);

    expect(events).toEqual([["loadFailed", "Error: boom"]]);
  });

  test("콘솔 생성이 던져도 loadFailed로 알린다", async () => {
    const { frame, events, waitFor } = createMainSide();
    // loadPyodide는 성공하지만 콘솔 모듈을 가져오는 pyimport가 실패하는 가짜.
    const broken = new Proxy(pyodide, {
      get(target, key) {
        if (key === "pyimport") {
          return () => {
            throw new Error("no console");
          };
        }
        return Reflect.get(target, key) as unknown;
      },
    });

    await bootReplWorker(frame, { loadPyodide: async () => broken });
    await waitFor(() => events.length >= 1);

    expect(events).toEqual([["loadFailed", "Error: no console"]]);
  });
});
