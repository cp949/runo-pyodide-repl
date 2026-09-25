/**
 * `createTerminalRunner`의 `run()` 시작 화면 준비 시험(run-accepted-hook DELTA-03). `terminal-runner.test.ts`의 가짜 core 대신
 * 실제 core `createRunner`를 쓰고 worker만 공용 가짜(`@cp949/runo-pyodide-core/test-utils`)로 둔다: 화면 준비가 core의 수락 판정
 * (거부 5종·`loading`·`restarting` 대기·재진입)을 그대로 따르는지 본다. 화면 준비 밖 시험은 가짜 core 파일에 남는다.
 * 가짜 core 시험에서 옮긴 14건이며 제목·단언은 그대로다(예외 1건은 그 시험에 표시). jsdom은 `crossOriginIsolated`가 없어 스텁한다.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createFakeWorkerFactory } from "@cp949/runo-pyodide-core/test-utils";
import type { RunResult } from "@cp949/runo-pyodide-core";
import {
  createFakeTerminal,
  type FakeTerminalOptions,
} from "@repo/pyodide-testkit/fake-terminal";
import {
  createTerminalRunner,
  type TerminalRunnerHandle,
  type TerminalRunnerOptions,
} from "./terminal-runner";

/** 매크로태스크 한 번. 옛 run의 정착 콜백·`rewindTail`의 await 사슬이 끝나기를 기다린다. */
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const factory = createFakeWorkerFactory();
const handles: TerminalRunnerHandle[] = [];

beforeEach(() => {
  vi.stubGlobal("crossOriginIsolated", true);
});

afterEach(() => {
  // runner를 먼저 정리해 대기 중인 run을 `disposed`로 끝낸 뒤 worker의 rpc 포트를 닫는다.
  for (const handle of handles.splice(0)) handle.dispose();
  factory.dispose();
  factory.workers.length = 0;
  vi.unstubAllGlobals();
});

interface SetupOptions {
  terminal?: FakeTerminalOptions;
  /** `false`면 `loading`인 채로 둔다(worker의 `ready`를 보내지 않는다). 기본 `true`. */
  ready?: boolean;
  runner?: Partial<TerminalRunnerOptions>;
}

/** 실제 `Readline`·sink·선택 복사·core `createRunner` + 가짜 worker로 실행창을 만든다. `ready`가 기본으로 끝난 상태다. */
async function setupReal(setupOptions: SetupOptions = {}) {
  const fake = createFakeTerminal(setupOptions.terminal);
  const core = createTerminalRunner({
    terminal: fake.term,
    createWorker: factory.createWorker,
    ...setupOptions.runner,
  });
  handles.push(core);
  // 시험이 기다리지 않는 `run()`의 reject(정리 때 `disposed`)가 처리되지 않은 rejection이 되지 않게 한다.
  const handle: Pick<TerminalRunnerHandle, "run" | "reset" | "dispose"> = {
    run(code) {
      const result = core.run(code);
      result.catch(() => {});
      return result;
    },
    reset: () => core.reset(),
    dispose: () => core.dispose(),
  };
  const screen = () => fake.written.join("");
  const worker = () => factory.workers[0]!;
  /** worker가 준비됐다(`loading` → `ready`). 대기 run이 있으면 곧바로 보내져 `running`이 되므로 둘 다 준비 완료로 본다. */
  const becomeReady = async () => {
    worker().ready();
    await vi.waitFor(() => expect(["ready", "running"]).toContain(core.status));
  };
  /** 실행 중인 run(worker가 받은 마지막 요청)을 끝낸다. */
  const finishRun = async (
    outcome: { kind: "ok" } | { kind: "exit"; code: number } = { kind: "ok" },
  ) => {
    await vi.waitFor(() => expect(worker().pending.length).toBeGreaterThan(0));
    worker().pending[worker().pending.length - 1]!.resolve(outcome);
  };
  if (setupOptions.ready !== false) await becomeReady();
  return { fake, core, handle, screen, worker, becomeReady, finishRun };
}

describe("run 시작 시 화면 준비: 커서 줄바꿈·clearOnRun", () => {
  test("커서가 행 머리가 아니면 \\r\\n을 한 번 쓴다", async () => {
    const { fake, handle } = await setupReal();
    fake.screen.cursorX = 3;

    void handle.run("code");

    expect(fake.written.filter((text) => text === "\r\n")).toHaveLength(1);
  });

  test("커서가 행 머리이면 줄바꿈을 쓰지 않는다", async () => {
    const { fake, handle } = await setupReal();
    fake.screen.cursorX = 0;

    void handle.run("code");

    expect(fake.written).toEqual([]);
  });

  test("clearOnRun이 기본이면 화면을 지우지 않는다", async () => {
    const { fake, handle, screen } = await setupReal();
    fake.screen.cursorX = 3;

    void handle.run("code");

    expect(screen()).not.toContain("\x1b[2J");
  });

  test("clearOnRun이면 화면을 지우고 줄바꿈은 쓰지 않는다", async () => {
    const { fake, handle, screen } = await setupReal({
      runner: { clearOnRun: true },
    });
    fake.screen.cursorX = 3;

    void handle.run("code");

    expect(screen()).toContain("\x1b[2J");
    expect(fake.written.filter((text) => text === "\r\n")).toHaveLength(0);
  });

  test("clearOnRun이 참인 값만 켠다(=== true)", async () => {
    const { fake, handle, screen } = await setupReal({
      runner: { clearOnRun: "yes" as unknown as boolean },
    });
    fake.screen.cursorX = 3;

    void handle.run("code");

    expect(screen()).not.toContain("\x1b[2J");
  });

  test("거부되는 run(busy)은 화면을 건드리지 않는다", async () => {
    const { fake, handle } = await setupReal({ runner: { clearOnRun: true } });
    void handle.run("first");
    fake.written.length = 0;
    fake.screen.cursorX = 3;

    await expect(handle.run("second")).rejects.toMatchObject({
      reason: "busy",
    });

    expect(fake.written).toEqual([]);
  });

  // 예외 1건: 가짜 core의 `calls.run`(core가 받은 run 호출) 단언은 실제 core에서 볼 수 없어, 같은 뜻인 "worker는 first만 받는다"로 바꿨다.
  test("로딩 대기 중인 run이 슬롯을 잡고 있을 때 두 번째 run은 busy로 거부되고 화면을 건드리지 않는다", async () => {
    const { fake, handle, worker, becomeReady } = await setupReal({
      ready: false,
      runner: { clearOnRun: true },
    });
    void handle.run("first"); // ready가 될 때까지 대기한다(core도 슬롯을 잡는다)
    fake.written.length = 0;
    fake.screen.cursorX = 3;

    await expect(handle.run("second")).rejects.toMatchObject({
      reason: "busy",
    });

    expect(fake.written).toEqual([]);
    await becomeReady();
    await vi.waitFor(() => expect(worker().pending).toHaveLength(1));
    expect(worker().pending.map((run) => run.code)).toEqual(["first"]);
  });

  test("끝난 run 뒤 재시작 대기 중에 부른 run은 슬롯이 비어 있으므로 화면을 준비한다", async () => {
    const { fake, handle, finishRun } = await setupReal();
    const first = handle.run("first");
    await finishRun();
    await first;
    handle.reset(); // 재시작 대기(restarting)
    fake.screen.cursorX = 3;

    void handle.run("second"); // 새 worker가 준비되면 실행된다(core도 슬롯을 잡는다)

    expect(fake.written.filter((text) => text === "\r\n")).toHaveLength(1);
  });

  test("실행 중 reset 직후 같은 틱에 부른 run은 받아들여지므로 화면을 준비한다", async () => {
    const { fake, handle } = await setupReal();
    void handle.run("first");
    handle.reset();
    fake.written.length = 0;
    fake.screen.cursorX = 3;

    void handle.run("second"); // 옛 run의 결과 Promise는 아직 정착 콜백 전이다

    expect(fake.written.filter((text) => text === "\r\n")).toHaveLength(1);
  });

  test("reset 직후 받아들여진 run이 재시작을 기다리는 동안 부른 run은 busy로 거부되고 화면을 건드리지 않는다", async () => {
    const { fake, handle } = await setupReal({ runner: { clearOnRun: true } });
    void handle.run("first");
    handle.reset();
    void handle.run("second").catch(() => {});
    await tick(); // 옛 run의 정착 콜백까지 돈다
    fake.written.length = 0;
    fake.screen.cursorX = 3;

    await expect(handle.run("third")).rejects.toMatchObject({ reason: "busy" });

    expect(fake.written).toEqual([]);
  });

  test("대기 run이 있는 onStatus(ready) 콜백 안에서 부른 run은 busy로 거부되고 화면을 건드리지 않는다", async () => {
    let inner: Promise<unknown> | undefined;
    // 첫 상태(loading)는 `setupReal()`이 반환하기 전에 오지만 ready가 아니라 `started`를 읽지 않는다.
    const started: Awaited<ReturnType<typeof setupReal>> = await setupReal({
      ready: false,
      runner: {
        clearOnRun: true,
        onStatus: (status) => {
          if (status === "ready" && inner === undefined) {
            inner = started.handle.run("inner");
            inner.catch(() => {});
          }
        },
      },
    });
    const { fake, handle, becomeReady } = started;
    void handle.run("first");
    fake.written.length = 0;
    fake.screen.cursorX = 3;

    await becomeReady();

    await expect(inner).rejects.toMatchObject({ reason: "busy" });
    expect(fake.written).toEqual([]);
  });

  test("worker가 없는 상태(unavailable)의 run도 화면을 건드리지 않는다", async () => {
    const { fake, core, handle, worker } = await setupReal({
      runner: { clearOnRun: true },
    });
    worker().dispatchError("boom"); // crashed
    expect(core.status).toBe("crashed");
    fake.screen.cursorX = 3;

    await expect(handle.run("x")).rejects.toMatchObject({
      reason: "unavailable",
    });

    expect(fake.written).toEqual([]);
  });

  test("실행 시작에 꼬리를 비워 이전 실행의 미종결 줄이 다음 input() 프롬프트가 되지 않는다", async () => {
    const { fake, handle, screen, worker, finishRun } = await setupReal();
    const first = handle.run("first");
    await vi.waitFor(() => expect(worker().pending).toHaveLength(1));
    worker().write("a");
    await vi.waitFor(() => expect(screen()).toContain("a"));
    await finishRun();
    await first;
    fake.screen.cursorX = 1;
    const before = fake.written.length;

    void handle.run("second");
    await vi.waitFor(() => expect(worker().pending).toHaveLength(2));
    worker().readInput();
    await tick(); // 읽기가 열려 그려진다
    fake.type("z\r");

    await vi.waitFor(() => expect(worker().mailboxText()).toContain("z"));
    // 프롬프트는 빈 꼬리라 입력줄 재그리기가 `a`를 다시 그리지 않는다(`az`가 아니라 `z`).
    const drawn = fake.written.slice(before);
    expect(drawn).toContain("z");
    expect(drawn.join("")).not.toContain("a");
  });

  test("run의 결과와 거부를 core 그대로 돌려준다", async () => {
    const { handle, finishRun } = await setupReal();
    const running = handle.run("code");
    await finishRun({ kind: "exit", code: 3 });
    await expect(running).resolves.toEqual<RunResult>({
      kind: "exit",
      code: 3,
    });

    const restarted = handle.run("code");
    handle.reset();
    await expect(restarted).resolves.toEqual({ kind: "restarted" });

    const disposed = handle.run("code");
    handle.dispose();
    await expect(disposed).rejects.toMatchObject({
      name: "RunRejectedError",
      reason: "disposed",
    });
  });
});

// `prepareScreen`에는 `disposed` 방어가 없다. 실제 core가 dispose 뒤 `run()`을 콜백 전에 거부하고 terminal `dispose()`가
// core를 먼저 끝내므로 콜백이 불릴 수 없다는 근거(코드 읽기 + 이 시험).
describe("dispose 뒤 run은 화면 준비 콜백이 불리지 않는다", () => {
  test("dispose 뒤 run은 disposed로 거부되고 해제된 터미널의 buffer를 읽지 않으며 화면을 건드리지 않는다", async () => {
    const { fake, handle } = await setupReal();
    handle.dispose();
    fake.term.dispose();

    await expect(handle.run("x")).rejects.toMatchObject({ reason: "disposed" });

    expect(fake.disposedBufferReads).toBe(0);
    expect(fake.written).toEqual([]);
  });
});
