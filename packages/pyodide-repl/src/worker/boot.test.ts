// @vitest-environment node
/**
 * worker 부팅 시퀀스(`bootReplWorker`) 시험(01-protocols.md 5절 S1, 00-architecture.md 3.1·3.2).
 * 실제 `MessageChannel` 양 끝에 worker 역할(`bootReplWorker`)과 main 역할(`createRpc` + 기록 핸들러)을 두고
 * 실제 pyodide(node)로 `ready` → 배너 → 각본형 `readLine` REPL 실행 순서, 종료, 실행 밖 오류 정책, 로드 실패 경로를
 * 확인한다. 알림과 `readLine` 요청은 한 타임라인(`events`)에 도착 순서대로 기록해 "출력이 다음 프롬프트 요청보다 먼저
 * 온다"를 순서까지 고정한다. CDN 동적 import(`loadPyodideFromCdn`)는 브라우저 전용이라 npm `loadPyodide`를 주입한다.
 */
import { loadPyodide, type PyodideInterface } from "pyodide";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
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
  vi.restoreAllMocks();
});

const NOTIFICATIONS = [
  "write",
  "writeErrorRaw",
  "writeOutput",
  "writeError",
  "ready",
  "loadFailed",
  "sessionTerminated",
];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * worker 역할이 받을 초기화 프레임과, main 역할이 받은 알림·요청 기록(`[이름, ...인자]`, 도착 순서).
 * `script`는 `readLine` 요청에 차례로 답할 값이다. 각본이 끝난 뒤의 요청은 오류로 답한다(기록은 남는다).
 */
function createMainSide(script: unknown[] = []) {
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
    Object.fromEntries([
      ...NOTIFICATIONS.map((name) => [
        name,
        (...args: unknown[]) => {
          events.push([name, ...args]);
        },
      ]),
      [
        "readLine",
        (...args: unknown[]) => {
          events.push(["readLine", ...args]);
          if (script.length === 0) throw new Error("각본 밖 readLine 요청");
          return script.shift();
        },
      ],
    ]),
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
      await sleep(50);
    }
    throw new Error("기다리던 알림이 오지 않았다");
  }
  return { frame, events, waitFor };
}

const PROMPT_REQUEST = ["readLine", ">>> ", undefined, true];

describe("bootReplWorker", () => {
  test("배너 뒤 readLine 요청에 답하면 출력이 다음 요청보다 먼저 오고 exit()로 끝난다", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const { frame, events, waitFor } = createMainSide([
      "1 + 1",
      "if True:",
      "    print(1)",
      "",
      "1 +",
      "1/0",
      'print("t", end="")',
      "exit()",
    ]);

    await bootReplWorker(frame, { loadPyodide: () => loadPyodide() });
    await waitFor(() => events.some((e) => e[0] === "sessionTerminated"));

    // 배너는 개행을 더해 보내지 않는다(TRAP-29). 빈 조각(`write ""`)은 main sink가 거른다(여기서는 알림 그대로 기록).
    expect(events).toEqual([
      ["ready", { pyodideVersion: "314.0.7" }],
      ["writeOutput", expect.stringMatching(/^Python 3\.14\.2 \(.*[^\n]$/s)],
      PROMPT_REQUEST,
      ["writeOutput", "2"],
      PROMPT_REQUEST,
      ["readLine", "... ", "if True:", true],
      ["readLine", "... ", "if True:\n    print(1)", true],
      ["write", "1"],
      ["write", "\n"],
      PROMPT_REQUEST,
      [
        "writeError",
        '  File "<console>", line 1\n    1 +\n       ^\nSyntaxError: invalid syntax',
      ],
      PROMPT_REQUEST,
      [
        "writeError",
        expect.stringMatching(
          /^Traceback \(most recent call last\):\n[\s\S]*ZeroDivisionError: division by zero$/,
        ),
      ],
      PROMPT_REQUEST,
      ["write", "t"],
      ["write", ""],
      PROMPT_REQUEST,
      ["sessionTerminated"],
    ]);
    const traceback = String(
      events.find(
        (e) => e[0] === "writeError" && String(e[1]).includes("ZeroDivision"),
      )?.[1],
    );
    for (const internal of ["runcode", "push", "await_fut", "__repl_run"]) {
      expect(traceback.includes(internal)).toBe(false);
    }
    expect(consoleError).not.toHaveBeenCalled();
  }, 30_000);

  test("sessionTerminated 뒤에는 readLine 요청이 더 오지 않는다", async () => {
    const { frame, events, waitFor } = createMainSide(["exit()"]);

    await bootReplWorker(frame, { loadPyodide: () => loadPyodide() });
    await waitFor(() => events.some((e) => e[0] === "sessionTerminated"));
    const count = events.length;
    await sleep(200);

    expect(events).toHaveLength(count);
    expect(events.filter((e) => e[0] === "readLine")).toHaveLength(1);
  }, 30_000);

  test("run이 예상 밖 오류를 던지면 repl 내부 오류를 알리고 콘솔을 정리한 뒤 다음 프롬프트로 계속한다", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    // 문자열이 아닌 입력은 콘솔 `push`가 `KeyboardInterrupt`가 아닌 TypeError를 던진다 — 러너가 삼키지 않는 오류의
    // 실제 경로다. 콘솔 buffer에 그 값이 남으므로 `clearPending()`이 없으면 다음 줄도 같은 오류로 실패한다.
    const { frame, events, waitFor } = createMainSide([42, "1 + 1", "exit()"]);

    await bootReplWorker(frame, { loadPyodide: () => loadPyodide() });
    await waitFor(() => events.some((e) => e[0] === "sessionTerminated"));

    expect(events.slice(2)).toEqual([
      PROMPT_REQUEST,
      [
        "writeError",
        expect.stringMatching(/^repl 내부 오류: [\s\S]*TypeError/),
      ],
      PROMPT_REQUEST,
      ["writeOutput", "2"],
      PROMPT_REQUEST,
      ["sessionTerminated"],
    ]);
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError.mock.calls[0]?.[0]).toBe("[repl.worker] 루프 오류");
  }, 30_000);

  test("로더가 던지면 loadFailed만 오고 ready·배너·readLine 요청은 오지 않는다", async () => {
    const { frame, events, waitFor } = createMainSide(["1 + 1"]);

    await bootReplWorker(frame, {
      loadPyodide: async () => {
        throw new Error("boom");
      },
    });
    await waitFor(() => events.length >= 1);
    await sleep(100);

    expect(events).toEqual([["loadFailed", "Error: boom"]]);
  });

  test("콘솔 생성이 던져도 loadFailed로 알리고 루프에 들어가지 않는다", async () => {
    const { frame, events, waitFor } = createMainSide(["1 + 1"]);
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
    await sleep(100);

    expect(events).toEqual([["loadFailed", "Error: no console"]]);
  });
});
