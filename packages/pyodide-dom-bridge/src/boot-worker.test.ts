// @vitest-environment node
/**
 * core `bootWorker`와 dom-bridge 플러그인의 조합: 플러그인이 던진 오류가 `loadFailed`로 가고 문구가 `Error: plugin "dom-bridge": `
 * 로 시작한다(`loadFailed` 페이로드는 `String(error)`라 `Error: ` 접두가 붙는다). 성공하면 `createConsole` 앞에서 `runo` 모듈이
 * 등록된다. 가짜 pyodide(interrupt 공개 API와 `registerJsModule`만)와 가짜 브리지를 쓰고, `createConsole`이 던져 시퀀스를 거기서
 * 끝낸다(플러그인 이후 단계에 도달했는지 보는 표지).
 */
import type { PyodideInterface } from "pyodide";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  createInterruptBuffer,
  createStdinMailbox,
} from "@cp949/runo-pyodide-core";
import {
  bootWorker,
  createRpc,
  type InitFrame,
  type WorkerDriver,
} from "@cp949/runo-pyodide-core/worker";
import { createDomBridgePlugin } from "./dom-bridge-plugin";
import type { WorkerBridge } from "./worker-bridge";

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** worker 역할이 받을 프레임과 main 역할이 받은 `loadFailed`·`ready` 알림. */
function createMainSide() {
  const channel = new MessageChannel();
  const mailbox = createStdinMailbox();
  const frame: InitFrame = {
    kind: "init",
    rpcPort: channel.port1,
    interruptBuffer: createInterruptBuffer(),
    stdinCtrl: mailbox.ctrl,
    stdinData: mailbox.data,
    driver: {},
    pyodide: { indexURL: "unused-in-node/" },
  };
  const events: unknown[][] = [];
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      events.push([name, ...args]);
    };
  const rpc = createRpc(channel.port2, {
    write: record("write"),
    writeErrorRaw: record("writeErrorRaw"),
    ready: record("ready"),
    loadFailed: record("loadFailed"),
    crashed: record("crashed"),
  });
  cleanups.push(() => {
    rpc.dispose();
    channel.port1.close();
    channel.port2.close();
  });
  async function waitForOutcome(): Promise<unknown[]> {
    for (let waited = 0; waited < 5000; waited += 20) {
      const outcome = events.find(
        (event) => event[0] === "ready" || event[0] === "loadFailed",
      );
      if (outcome) return outcome;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("ready·loadFailed 알림이 오지 않았다");
  }
  return { frame, waitForOutcome };
}

/** `createConsole`에 도달하면 `console 도달`로 던지는 가짜 driver. */
const driver: WorkerDriver = {
  parseOptions: (raw) => raw,
  createSession: () => ({
    handlers: {},
    createConsole: () => {
      throw new Error("console 도달");
    },
    run: async () => {},
    atPrompt: () => false,
  }),
};

function createBoot(options: { received: boolean; native: boolean }) {
  const registerJsModule = vi.fn();
  const pyodide = {
    setInterruptBuffer: () => {},
    checkInterrupt: () => {},
    registerJsModule,
  } as unknown as PyodideInterface;
  const plugin = createDomBridgePlugin({
    receivedBootstrap: () => options.received,
    bridge: async (): Promise<WorkerBridge> => ({
      proxy: {},
      native: options.native,
      window: { document: {} } as unknown as WorkerBridge["window"],
    }),
  });
  const main = createMainSide();
  const booted = bootWorker(main.frame, {
    driver,
    loadPyodide: async () => pyodide,
    plugins: [plugin],
  });
  return { main, booted, registerJsModule };
}

describe("bootWorker + dom-bridge 플러그인", () => {
  test('부트스트랩을 받지 못했으면 loadFailed이고 문구가 Error: plugin "dom-bridge": 로 시작하며 첫 정적 import를 알린다', async () => {
    const { main, booted, registerJsModule } = createBoot({
      received: false,
      native: true,
    });

    await booted;
    const outcome = await main.waitForOutcome();

    expect(outcome[0]).toBe("loadFailed");
    expect(String(outcome[1]).startsWith('Error: plugin "dom-bridge": ')).toBe(
      true,
    );
    expect(outcome[1]).toContain("첫 정적 import");
    expect(registerJsModule).not.toHaveBeenCalled();
  });

  test('native가 false면 loadFailed이고 문구가 Error: plugin "dom-bridge": 로 시작하며 SharedArrayBuffer를 알린다', async () => {
    const { main, booted, registerJsModule } = createBoot({
      received: true,
      native: false,
    });

    await booted;
    const outcome = await main.waitForOutcome();

    expect(outcome[0]).toBe("loadFailed");
    expect(String(outcome[1]).startsWith('Error: plugin "dom-bridge": ')).toBe(
      true,
    );
    expect(outcome[1]).toContain("SharedArrayBuffer");
    expect(registerJsModule).not.toHaveBeenCalled();
  });

  test("정상이면 createConsole 앞에서 runo 모듈이 등록된다(loadFailed 문구가 콘솔 단계 것이다)", async () => {
    const { main, booted, registerJsModule } = createBoot({
      received: true,
      native: true,
    });

    await booted;
    const outcome = await main.waitForOutcome();

    expect(registerJsModule).toHaveBeenCalledTimes(1);
    expect(registerJsModule.mock.calls[0]?.[0]).toBe("runo");
    expect(outcome).toEqual(["loadFailed", "Error: console 도달"]);
  });
});
