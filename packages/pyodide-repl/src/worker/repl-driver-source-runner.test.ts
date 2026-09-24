// @vitest-environment node
/**
 * REPL driver가 `{ source }` 실행기(`createSourceRunner`)를 세션마다 한 번 만들고 루프가 끝나면 놓는지 본다(RD-022a).
 * `run-source.ts`를 전달만 하는 모의로 감싸 만든 실행기의 `destroy` 호출을 센다. 실제 pyodide(node)와 실제 `MessageChannel`로
 * `bootReplWorker`를 돌리고 main 역할은 각본형 `readLine` 응답만 한다(`boot.test.ts`와 같은 구조의 최소 사본).
 */
import { loadPyodide, type PyodideInterface } from "pyodide";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import {
  createInterruptBuffer,
  createStdinMailbox,
} from "@cp949/runo-pyodide-core";
import { createRpc, type InitFrame } from "@cp949/runo-pyodide-core/worker";
import { bootReplWorker } from "./boot";
import { createSourceRunner, type SourceRunner } from "./run-source";

vi.mock("./run-source", async (importOriginal) => {
  const original = await importOriginal<typeof import("./run-source")>();
  return {
    ...original,
    // 실행기를 그대로 만들고 `destroy`만 감시한다.
    createSourceRunner: vi.fn(
      (...args: Parameters<typeof original.createSourceRunner>) => {
        const runner = original.createSourceRunner(...args);
        vi.spyOn(runner, "destroy");
        return runner;
      },
    ),
  };
});

let pyodide: PyodideInterface;

beforeAll(async () => {
  pyodide = await loadPyodide();
}, 60_000);

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.mocked(createSourceRunner).mockClear();
  pyodide.setInterruptBuffer(
    undefined as unknown as Parameters<
      PyodideInterface["setInterruptBuffer"]
    >[0],
  );
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** worker 역할이 받을 프레임과, main 역할이 받은 알림 이름 기록. `script`는 `readLine` 요청에 차례로 답할 값이다. */
function createMainSide(script: unknown[]) {
  const channel = new MessageChannel();
  const mailbox = createStdinMailbox();
  const frame: InitFrame = {
    kind: "init",
    rpcPort: channel.port1,
    interruptBuffer: createInterruptBuffer(),
    stdinCtrl: mailbox.ctrl,
    stdinData: mailbox.data,
    driver: { topLevelAwait: false },
    pyodide: { indexURL: "unused-in-node/" },
  };
  const names: string[] = [];
  const rpc = createRpc(
    channel.port2,
    Object.fromEntries([
      ...[
        "write",
        "writeErrorRaw",
        "writeOutput",
        "writeError",
        "ready",
        "loadFailed",
        "sessionTerminated",
        "readInput",
        "crashed",
      ].map((name) => [name, () => void names.push(name)]),
      ["readLine", () => script.shift()],
    ]),
  );
  cleanups.push(() => {
    rpc.dispose();
    channel.port1.close();
    channel.port2.close();
  });
  async function waitFor(predicate: () => boolean): Promise<void> {
    for (let waited = 0; waited < 5000; waited += 50) {
      if (predicate()) return;
      await sleep(50);
    }
    throw new Error("기다리던 상태가 오지 않았다");
  }
  return { frame, names, waitFor };
}

describe("REPL driver의 `{ source }` 실행기 수명", () => {
  test("세션마다 실행기를 한 번 만들고 exit() 명령으로 루프가 끝나면 놓는다", async () => {
    const { frame, names, waitFor } = createMainSide([
      { source: "1" },
      "exit()",
    ]);

    await bootReplWorker(frame, { loadPyodide: () => loadPyodide() });
    await waitFor(() => names.includes("sessionTerminated"));

    const runners = vi
      .mocked(createSourceRunner)
      .mock.results.map((result) => result.value as SourceRunner);
    expect(runners).toHaveLength(1);
    // 놓는 것은 루프가 끝난 뒤(`finally`)라 종료 통지보다 조금 늦게 온다.
    await waitFor(() => vi.mocked(runners[0]!.destroy).mock.calls.length > 0);
    expect(runners[0]!.destroy).toHaveBeenCalledTimes(1);
  }, 30_000);
});
