// @vitest-environment node
/**
 * 정지한 실행 깨우기 시험(03-ctrl-c.md 2.4의 규칙 ③과 깨우기 세부, 09-testing.md 9.1, TRP-020·TRP-021).
 * `asyncio.run`·`run_until_complete`·`run_sync`·top-level await 대기 중에는 사용자 스택이 JSPI로 정지해 SIGINT 폴링이
 * 사용자 프레임 없는 콜백에서 일어난다. 그 SIGINT를 버리지 않고 대기 Task나 콘솔 task를 취소해 사용자 지점에서
 * 중단하는 것이 여기서 고정하는 규칙이다. JSPI·asyncio 스케줄러·`ConsoleFuture`에 걸쳐 있어 실제 pyodide(node)에서만
 * 재현되므로 mock 없이 로드한다.
 *
 * RD-009a: `run_sync` 계열로 들어간 awaitable이 예외로 끝나면(취소뿐 아니라 사용자 코드가 낸 어떤 예외로든) `guard`가
 * 그 예외를 값으로 나르고 래퍼가 사용자 스택에서 다시 올린다 — Task가 예외로 끝나 JS 경계를 넘으며 pyodide가
 * `sys.excepthook`으로 트레이스백을 한 번 더 찍는 것(TRP-021)을 막는다. `"run_sync 계열 대기에서 코루틴이 낸 예외"`
 * describe가 이 나르기·프레임 다듬기를 확인한다.
 *
 * 깨우기는 감시 타이머(DELTA-04)가 부르는 것이 프로덕션 경로이고, 여기서는 `sigint-setup.ts`의 `wakeAfter(ms)`가 그
 * 한 틱을 흉내낸다(`signalInterrupt` → `interruptIdle()` → 깨웠으면 소비·ack). 타이머 없이 핸들러만으로 깨우는 경로는
 * 눌림 스레드(`src/test/roles/interrupt-presser.ts`)가 만든다.
 */
import { loadPyodide, type PyodideInterface } from "pyodide";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  CONSOLE_TRACEBACK,
  execSource,
  type SetupOptions,
  setupConsoleRunner,
  slots,
  teardownConsoleRunner,
} from "../test/sigint-setup";
import { PS1, PS2 } from "./submission-runner";
import { SIGINT_HANDLER_FILENAME } from "./sigint-handler";

let pyodide: PyodideInterface;

beforeAll(async () => {
  pyodide = await loadPyodide();
}, 60_000);

/** 이 시험이 연결한 버퍼. `afterEach`가 떼고 비운다. */
let connected: Int32Array | undefined;

/** 설치 가드가 건너뛴 이유를 받는 가짜. 가드 시험만 넘겨 쓴다. */
const warn = vi.fn<(message: string) => void>();

afterEach(() => {
  teardownConsoleRunner(pyodide, connected);
  connected = undefined;
  warn.mockReset();
});

const READY = { prompt: PS1, exit: false };
/** top-level await 대기의 중단 화면: 3.14 `python -m asyncio`처럼 트레이스백 없이 한 줄이다. */
const AWAIT_INTERRUPT = "KeyboardInterrupt\n";
/** 대기를 이만큼 길게 잡는다. 깨우지 못하면 시험이 이 시간을 다 채우고 단언에서 실패한다. */
const IDLE_WAIT = "5";
/** `wakeAfter`가 깨우는 시각(ms). */
const WAKE_AT_MS = 100;
/** 깨운 뒤 이 시간(ms) 안에 제출이 끝나야 깨운 것으로 본다. 목표는 200ms이고 병렬 실행의 부하 여유를 둔다. */
const WAKE_LIMIT_MS = 1000;

/** 조립 뒤 버퍼를 `afterEach`가 치우도록 기록하고, 시나리오가 쓰는 모듈을 콘솔에서 import해 둔다. */
async function setup(options?: SetupOptions) {
  const runner = setupConsoleRunner(pyodide, options);
  connected = runner.buffer;
  expect(await runner.run("import asyncio, time")).toEqual(READY);
  expect(await runner.run("from pyodide.ffi import run_sync")).toEqual(READY);
  return runner;
}

type Runner = Awaited<ReturnType<typeof setup>>;

interface Outcome {
  /**
   * `interruptIdle()`이 깨울 것을 찾았는지. **경합이 있어 참을 단언하지 않는다**: SIGINT를 쓴 뒤 Python으로 들어가는
   * 그 호출에서 pyodide 폴링이 먼저 일어나면 핸들러 규칙 ③이 대기를 깨우고, 그 뒤에 도는 `interrupt_idle` 본문은
   * 깨울 것이 남지 않아 거짓을 돌려준다. 어느 쪽이든 깨어나고 ack는 정확히 한 번 오른다(슬롯으로 단언한다).
   */
  woke: boolean;
  /** 제출을 시작한 시각부터 끝날 때까지의 ms. 깨우기는 그중 `wakeAt`에 일어난다. */
  elapsedMs: number;
}

/** `wakeAt` 뒤에 감시 타이머 한 틱을 흉내내면서 한 줄을 제출한다. */
async function runWaking(
  runner: Runner,
  source: string,
  wakeAt = WAKE_AT_MS,
): Promise<Outcome> {
  const startedAt = performance.now();
  const wake = runner.wakeAfter(wakeAt);
  expect(await runner.run(source)).toEqual(READY);
  const elapsedMs = performance.now() - startedAt;
  return { woke: (await wake).woke, elapsedMs };
}

/**
 * 복합문(블록)을 제출한다. 콘솔은 빈 줄을 받아야 블록을 실행하므로 실제 대기는 그 빈 줄 push에서 시작한다.
 * 깨우기를 그 직전에 건다.
 */
/**
 * 블록 본문 줄들을 실제 타이핑처럼 한 줄씩 push한다(RD-011: 개행이 든 한 번의 `run()`은 `split_paste`로 즉시
 * 실행되므로, 이 시험처럼 마지막 빈 줄 전에 깨우기를 걸려면 줄 단위로 나눠 보내야 한다).
 */
async function submitBlockLines(runner: Runner, block: string): Promise<void> {
  for (const line of block.split("\n")) {
    expect((await runner.run(line)).prompt).toBe(PS2);
  }
}

async function runBlockWaking(
  runner: Runner,
  block: string,
  wakeAt = WAKE_AT_MS,
): Promise<Outcome> {
  await submitBlockLines(runner, block);
  return runWaking(runner, "", wakeAt);
}

/** 깨운 뒤 곧 끝났는지. 깨우지 못하면 대기 시간(5초)을 다 채워 여기서 실패한다. */
function expectWoken(outcome: Outcome, wakeAt = WAKE_AT_MS): void {
  expect(outcome.elapsedMs).toBeLessThan(wakeAt + WAKE_LIMIT_MS);
}

/** `screen.stderr`의 `  File ...` 줄들. */
const frames = (stderr: string) =>
  stderr.split("\n").filter((line) => line.startsWith("  File "));

/** `asyncio.run`·`run_until_complete`·`run_sync` 3종에 같은 코루틴 식을 태운다(모두 같은 `run_sync` 래퍼를 거친다). */
const RUNNERS: [string, (coroutineExpr: string) => string][] = [
  ["asyncio.run", (c) => `asyncio.run(${c})`],
  [
    "run_until_complete",
    (c) => `asyncio.get_event_loop().run_until_complete(${c})`,
  ],
  ["run_sync", (c) => `run_sync(${c})`],
];

describe("정지한 대기 중 Ctrl+C", () => {
  it.each([
    ["asyncio.run", `asyncio.run(asyncio.sleep(${IDLE_WAIT}))`],
    [
      "run_until_complete",
      `asyncio.get_event_loop().run_until_complete(asyncio.sleep(${IDLE_WAIT}))`,
    ],
    ["run_sync", `run_sync(asyncio.sleep(${IDLE_WAIT}))`],
  ])(
    "%s 대기는 깨운 뒤 곧 표준 트레이스백으로 끝난다",
    async (_title, source) => {
      const runner = await setup();

      expectWoken(await runWaking(runner, source));

      // 우리 프레임도 `pyodide/webloop.py`의 `_run`·`run_until_complete`도 남지 않는다.
      expect(runner.screen.stderr).toBe(CONSOLE_TRACEBACK);
      // 깨운 쪽이 타이머든 핸들러든 SIGINT는 소비되고 ack는 정확히 한 번 오른다.
      expect(slots(runner.buffer)).toEqual([0, 1, 1, 0]);
    },
    20_000,
  );

  it("중단한 뒤 다음 문장이 정상 실행된다", async () => {
    const runner = await setup();
    expectWoken(
      await runWaking(runner, `asyncio.run(asyncio.sleep(${IDLE_WAIT}))`),
    );
    runner.screen.stdout = "";
    runner.screen.stderr = "";

    expect(await runner.run("1 + 1")).toEqual(READY);

    expect(runner.screen.stdout).toBe("2\n");
    expect(runner.screen.stderr).toBe("");
  }, 20_000);

  it("KeyboardInterrupt는 except로 잡히고 finally가 실행된다", async () => {
    const runner = await setup();
    const block = [
      "try:",
      `    run_sync(asyncio.sleep(${IDLE_WAIT}))`,
      "except KeyboardInterrupt:",
      "    print('caught')",
      "finally:",
      "    print('fin')",
    ].join("\n");

    expectWoken(await runBlockWaking(runner, block));

    expect(runner.screen.stdout).toBe("caught\nfin\n");
    expect(runner.screen.stderr).toBe("");
  }, 20_000);

  // `<console>` 파일명으로 정의해 이 함수의 프레임이 사용자 프레임으로 인정되게 한다. `run_sync`는 3행이다.
  const NESTED_SOURCE = `def f():
    import asyncio
    run_sync(asyncio.sleep(${IDLE_WAIT}))
`;

  it("중첩 호출 안의 run_sync 대기도 사용자 프레임까지만 보인다", async () => {
    const runner = await setup();
    pyodide.runPython(NESTED_SOURCE, {
      globals: pyodide.globals,
      filename: "<console>",
    });

    expectWoken(await runWaking(runner, "f()"));

    expect(frames(runner.screen.stderr)).toEqual([
      '  File "<console>", line 1, in <module>',
      '  File "<console>", line 3, in f',
    ]);
    expect(runner.screen.stderr).toMatch(/KeyboardInterrupt\n$/);
  }, 20_000);

  // 래퍼가 부른 라이브러리 프레임(`ensure_future` 등)에서 SIGINT가 소비되면 KeyboardInterrupt의 트레이스백은
  // [사용자, 래퍼, 라이브러리, 핸들러] 순서다. 핸들러 프레임만 자르면 래퍼와 라이브러리 프레임이 샌다.
  it("래퍼가 부른 라이브러리 프레임에서 올라온 KeyboardInterrupt도 우리 프레임 없이 보인다", async () => {
    const runner = await setup();
    pyodide.runPython(
      `import asyncio, signal
_real_ensure_future = asyncio.ensure_future

def _leaky_ensure_future(*args, **kwargs):
    # Task를 먼저 만든 뒤 눌림을 소비한다(만들기 전에 끊으면 대기 코루틴이 await되지 않아 RuntimeWarning이 화면에
    # 끼어든다). press()는 요청 번호를 올려 재전송 무시 규칙에 걸리지 않게 한다.
    fut = _real_ensure_future(*args, **kwargs)
    press()
    signal.raise_signal(signal.SIGINT)
    return fut

asyncio.ensure_future = _leaky_ensure_future
`,
      { globals: pyodide.globals, filename: "<test>" },
    );

    try {
      expect(await runner.run("run_sync(asyncio.sleep(0.05))")).toEqual(READY);
    } finally {
      pyodide.runPython(
        "import asyncio\nasyncio.ensure_future = _real_ensure_future",
        {
          globals: pyodide.globals,
          filename: "<test>",
        },
      );
    }

    expect(runner.screen.stderr).toBe(CONSOLE_TRACEBACK);
  }, 20_000);

  // 깨우기 간격은 `sleep(1)` 종료 콜백에 위상이 고정되지 않도록 어긋나게 둔다.
  it("KeyboardInterrupt를 잡고 계속 도는 프로그램은 깨우기 3회를 모두 받는다", async () => {
    const runner = await setup();
    expect(await runner.run("n = 0")).toEqual(READY);
    expect(await runner.run("deadline = time.monotonic() + 6")).toEqual(READY);
    const block = [
      "while n < 3 and time.monotonic() < deadline:",
      "    try:",
      "        run_sync(asyncio.sleep(1))",
      "    except KeyboardInterrupt:",
      "        n += 1",
    ].join("\n");
    await submitBlockLines(runner, block);
    const wakes = [
      runner.wakeAfter(100),
      runner.wakeAfter(400),
      runner.wakeAfter(700),
    ];

    expect(await runner.run("")).toEqual(READY);

    await Promise.all(wakes);
    expect(pyodide.globals.get("n")).toBe(3);
  }, 20_000);

  // 같은 틱의 연타 3회: 첫 깨우기만 성공하고 나머지는 깨울 것이 없어 SIGINT를 슬롯에 남긴다. 남은 것은 재개한
  // 스택의 폴링이나 루프의 폐기가 치우고, 트레이스백은 하나여야 한다.
  it("정지한 대기 중 0ms 연타 3회에도 트레이스백은 한 번이다", async () => {
    const runner = await setup();
    const wakes = [
      runner.wakeAfter(WAKE_AT_MS),
      runner.wakeAfter(WAKE_AT_MS),
      runner.wakeAfter(WAKE_AT_MS),
    ];

    expect(await runner.run(`run_sync(asyncio.sleep(${IDLE_WAIT}))`)).toEqual(
      READY,
    );

    // 깨운 것은 많아야 하나다(첫 호출이나 그것이 일으킨 핸들러 둘 중 하나). 나머지 SIGINT는 슬롯에 남는다.
    const woke = (await Promise.all(wakes)).filter((wake) => wake.woke);
    expect(woke.length).toBeLessThanOrEqual(1);
    expect(runner.screen.stderr.match(/KeyboardInterrupt/g)).toHaveLength(1);
    expect(runner.screen.stderr).not.toContain(SIGINT_HANDLER_FILENAME);
    // 남은 SIGINT는 worker 루프가 제출 전에 폐기한다(03-ctrl-c.md 2.6). 그 뒤 다음 문장은 정상이다.
    runner.screen.stdout = "";
    runner.screen.stderr = "";
    expect(await runner.run("1 + 1")).toEqual(READY);
    expect(runner.screen.stdout).toBe("2\n");
    expect(runner.screen.stderr).toBe("");
  }, 20_000);

  // 대기 코루틴(guard)은 우리가 깨운 취소만 정상 값으로 바꾼다. 사용자 코드가 낸 CancelledError는 그대로 올라온다.
  it("사용자가 낸 CancelledError는 KeyboardInterrupt로 바뀌지 않는다", async () => {
    const runner = await setup();
    pyodide.runPython(
      "import asyncio\n\nasync def boom():\n    raise asyncio.CancelledError()\n",
      { globals: pyodide.globals, filename: "<console>" },
    );
    const program = [
      "try:",
      "    run_sync(boom())",
      "except asyncio.CancelledError:",
      "    print('user-cancel')",
    ].join("\n");

    expect(await runner.run(execSource(program))).toEqual(READY);

    expect(runner.screen.stdout).toBe("user-cancel\n");
    expect(runner.screen.stderr).toBe("");
  }, 20_000);

  it("실행 중이 아니면 interruptIdle()은 아무것도 깨우지 않는다", async () => {
    const runner = await setup();

    expect(runner.interruptIdle()).toBe(false);

    expect(slots(runner.buffer)).toEqual([0, 0, 0, 0]);
  });
});

describe("top-level await 대기 중 Ctrl+C", () => {
  it("await 대기는 깨운 뒤 곧 KeyboardInterrupt 한 줄로 끝난다", async () => {
    const runner = await setup({ topLevelAwait: true });

    expectWoken(await runWaking(runner, `await asyncio.sleep(${IDLE_WAIT})`));

    expect(runner.screen.stderr).toBe(AWAIT_INTERRUPT);
    runner.screen.stderr = "";
    expect(await runner.run("1 + 1")).toEqual(READY);
    expect(runner.screen.stdout).toBe("2\n");
    expect(runner.screen.stderr).toBe("");
  }, 20_000);

  it("finally는 실행된다", async () => {
    const runner = await setup({ topLevelAwait: true });
    const block = [
      "try:",
      `    await asyncio.sleep(${IDLE_WAIT})`,
      "finally:",
      "    print('fin')",
    ].join("\n");

    expectWoken(await runBlockWaking(runner, block));

    expect(runner.screen.stdout).toBe("fin\n");
    expect(runner.screen.stderr).toBe(AWAIT_INTERRUPT);
  }, 20_000);

  it("except asyncio.CancelledError는 잡는다", async () => {
    const runner = await setup({ topLevelAwait: true });
    const block = [
      "try:",
      `    await asyncio.sleep(${IDLE_WAIT})`,
      "except asyncio.CancelledError:",
      "    print('cancelled-caught')",
    ].join("\n");

    expectWoken(await runBlockWaking(runner, block));

    expect(runner.screen.stdout).toBe("cancelled-caught\n");
    expect(runner.screen.stderr).toBe("");
  }, 20_000);

  // 3.14 `python -m asyncio`와 같다: await 중단은 콘솔 task 취소라 KeyboardInterrupt가 아니라 CancelledError로 온다.
  it("except KeyboardInterrupt는 잡지 못한다", async () => {
    const runner = await setup({ topLevelAwait: true });
    const block = [
      "try:",
      `    await asyncio.sleep(${IDLE_WAIT})`,
      "except KeyboardInterrupt:",
      "    print('caught')",
    ].join("\n");

    expectWoken(await runBlockWaking(runner, block));

    expect(runner.screen.stdout).toBe("");
    expect(runner.screen.stderr).toBe(AWAIT_INTERRUPT);
  }, 20_000);
});

// 콘솔 task는 await 지점에서 멈춘(CORO_SUSPENDED) 때만 취소한다. 실행 중이거나 재개 중인 task를 취소하면 코루틴이
// 끝나는 순간 task가 취소로 끝나 ConsoleFuture가 영영 끝나지 않는다(HANG, TRP-021). 이 조건이 깨지면 아래 시험은
// 끝나지 않아 시간 초과로 실패한다.
describe("콘솔 task 취소 조건", () => {
  it("실행 중인 콘솔 task는 interruptIdle()이 취소하지 않는다", async () => {
    const runner = await setup({ topLevelAwait: true });
    pyodide.globals.set("idle", runner.interruptIdle);

    expect(await runner.run("print(idle())")).toEqual(READY);
    expect(await runner.run("print('next')")).toEqual(READY);

    expect(runner.screen.stdout).toBe("False\nnext\n");
    expect(runner.screen.stderr).toBe("");
  }, 10_000);

  it("이미 깨운 대기 위의 두 번째 interruptIdle()은 콘솔 task를 취소하지 않는다", async () => {
    const runner = await setup({ topLevelAwait: true });
    const calls: boolean[] = [];
    // 정지한 대기 중 한 JS 콜백 안에서 두 번 부른다. 첫 호출이 대기를 깨우고, 대기가 재개되기 전(콘솔 task는 아직
    // run_sync 안이라 CORO_RUNNING)에 둘째 호출이 온다.
    const timer = setTimeout(() => {
      calls.push(runner.interruptIdle(), runner.interruptIdle());
    }, WAKE_AT_MS);

    try {
      expect(await runner.run(`run_sync(asyncio.sleep(${IDLE_WAIT}))`)).toEqual(
        READY,
      );
    } finally {
      clearTimeout(timer);
    }

    expect(calls).toEqual([true, false]);
    expect(runner.screen.stderr).toBe(CONSOLE_TRACEBACK);
  }, 20_000);
});

// 타이머 틱 사이에 Python 콜백이 SIGINT를 먼저 소비하면(핸들러가 사용자 스택이 없어 버리면) 타이머만으로는 눌림이
// 손실된다. 이 시험은 타이머(=`wakeAfter`) 없이 핸들러 규칙 ③만으로 깨운다.
describe("SIGINT 핸들러 보완(타이머 없음)", () => {
  it("정지한 run_sync 루프의 콜백이 소비한 SIGINT도 루프를 끊는다", async () => {
    const runner = await setup();
    expect(
      (await runner.run("for _ in range(300): run_sync(asyncio.sleep(0.01))"))
        .prompt,
    ).toBe(PS2);
    const presser = runner.presser();
    presser.press({ offsets: [200], waitStarted: false });
    const startedAt = performance.now();

    expect(await runner.run("")).toEqual(READY);

    expect(performance.now() - startedAt).toBeLessThan(200 + WAKE_LIMIT_MS);
    expect(runner.screen.stderr).toBe(CONSOLE_TRACEBACK);
    await presser.done();
  }, 20_000);

  // await 사이에 사용자 프레임이 자주 도는 짧은 루프라 눌림이 소비되는 위치에 따라 화면이 셋 중 하나다: 정지한
  // 구간(콜백)이면 콘솔 task 취소의 한 줄, 사용자 프레임이면 보통의 트레이스백, 사용자 await 사슬 안의 asyncio
  // 프레임이면 그 프레임이 든 트레이스백. 어느 쪽이든 끊기고 우리 쪽 프레임은 없다.
  it("TLA await 루프의 콜백이 소비한 SIGINT도 루프를 끊는다", async () => {
    const runner = await setup({ topLevelAwait: true });
    expect(
      (await runner.run("for _ in range(300): await asyncio.sleep(0.01)"))
        .prompt,
    ).toBe(PS2);
    const presser = runner.presser();
    presser.press({ offsets: [200], waitStarted: false });
    const startedAt = performance.now();

    expect(await runner.run("")).toEqual(READY);

    expect(performance.now() - startedAt).toBeLessThan(200 + WAKE_LIMIT_MS);
    expect(runner.screen.stderr).toMatch(
      /^(KeyboardInterrupt|Traceback \(most recent call last\):\n[\s\S]*KeyboardInterrupt)\n$/,
    );
    expect(runner.screen.stderr).not.toMatch(
      /sigint_handler|<sigint-handler>|run_sync|guard|WOKEN/,
    );
    await presser.done();
  }, 20_000);
});

describe("깨울 수 없는 순간에 소비된 SIGINT", () => {
  // 표시(pending)는 재개하는 run_sync가 올려야 사라진다. 대기가 예외로 끝나 재개 지점에서 올리지 못하면 실행이
  // 끝날 때(runcode 경계) 지워져야 다음 문장이 끊기지 않는다. 코루틴은 `<console>`이 아닌 파일명으로 정의한다
  // (`<console>`이면 핸들러가 사용자 프레임으로 보고 그 자리에서 KeyboardInterrupt를 올린다).
  it("예외로 끝난 실행에 남은 표시는 다음 문장을 끊지 않는다", async () => {
    const runner = await setup();
    pyodide.runPython(
      `import asyncio, signal

async def w():
    press()
    signal.raise_signal(signal.SIGINT)
    raise ValueError("boom")
`,
      { globals: pyodide.globals, filename: "<test>" },
    );
    expect(await runner.run("run_sync(w())")).toEqual(READY);
    expect(runner.screen.stderr).toContain("ValueError: boom");
    runner.screen.stdout = "";
    runner.screen.stderr = "";

    expect(
      await runner.run("run_sync(asyncio.sleep(0.05)); print('ok')"),
    ).toEqual(READY);

    expect(runner.screen.stdout).toBe("ok\n");
    expect(runner.screen.stderr).toBe("");
  }, 20_000);
});

describe("pyodide 가정", () => {
  // run_sync 대기가 사용자 스택을 정지하는 것은 JSPI로 정지할 수 있는 호출 스택에서만이다. `pyodide.runPython`의
  // 동기 호출이 아니라 콘솔 실행 안에서 본다.
  it("콘솔 실행 안의 can_run_sync()는 참이다", async () => {
    const runner = await setup();

    expect(
      await runner.run("from pyodide.ffi import can_run_sync; can_run_sync()"),
    ).toEqual(READY);

    expect(runner.screen.stdout).toBe("True\n");
  });

  // 사용자의 `from pyodide.ffi import run_sync`와 webloop.py의 run_until_complete가 모두 래퍼를 부르려면 두 곳을
  // 함께 교체해야 한다.
  it("설치 뒤 pyodide.ffi.run_sync와 pyodide.webloop.run_sync는 같은 래퍼다", async () => {
    await setup();

    expect(
      pyodide.runPython(
        `import pyodide.ffi, pyodide.webloop
pyodide.ffi.run_sync is pyodide.webloop.run_sync and pyodide.ffi.run_sync.__code__.co_filename == "${SIGINT_HANDLER_FILENAME}"`,
        { globals: pyodide.toPy({}), filename: "<test>" },
      ),
    ).toBe(true);
  });
});

// 가정이 깨지면 정지한 실행 깨우기만 건너뛴다. 핸들러 규칙 ①②④(바쁜 루프 중단)와 `time.sleep` 조각 중단은 그대로다.
describe("설치 가드", () => {
  /** 가드에 걸린 설치에서도 남아 있어야 하는 것: 바쁜 루프 중단과 `time.sleep` 조각 중단. */
  async function expectStillInterruptible(runner: Runner): Promise<void> {
    expect(
      await runner.run(execSource("press()\nfor _ in range(10**7): pass")),
    ).toEqual(READY);
    expect(runner.screen.stderr).toMatch(/KeyboardInterrupt\n$/);
    runner.screen.stderr = "";
    const presser = runner.presser();
    presser.press({ offsets: [200] });
    const startedAt = performance.now();
    expect(await runner.run("started(); time.sleep(5)")).toEqual(READY);
    expect(performance.now() - startedAt).toBeLessThan(200 + WAKE_LIMIT_MS);
    expect(runner.screen.stderr).toMatch(/KeyboardInterrupt\n$/);
    await presser.done();
  }

  it.each([
    [
      "pyodide.webloop",
      "pyodide.webloop.run_sync = None",
      "pyodide.webloop.run_sync",
    ],
    ["pyodide.ffi", "del pyodide.ffi.run_sync", "pyodide.ffi.run_sync"],
  ])(
    "%s의 run_sync가 기대와 다르면 깨우기를 건너뛰고 warn으로 알린다",
    async (_title, breakage, label) => {
      pyodide.runPython(`import pyodide.ffi, pyodide.webloop\n${breakage}`, {
        globals: pyodide.toPy({}),
        filename: "<test>",
      });

      const runner = await setup({ warn });

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]![0]).toContain("[sigint-handler]");
      expect(warn.mock.calls[0]![0]).toContain(label);
      expect(runner.interruptIdle()).toBe(false);
      await expectStillInterruptible(runner);
    },
    30_000,
  );

  it("console.runcode가 코루틴 함수가 아니면 깨우기를 건너뛰고 warn으로 알린다", async () => {
    // 클래스 속성을 바꿔 설치 시점의 `console.runcode`를 일반 함수로 만든다. 설치 직후 되돌려 그 뒤의 실행은
    // 원래 `runcode`(인스턴스 속성이 없으므로 클래스 것)를 쓴다.
    pyodide.runPython(
      `import pyodide.console
_saved_runcode = pyodide.console.PyodideConsole.runcode
pyodide.console.PyodideConsole.runcode = lambda self, source, code: None`,
      { globals: pyodide.globals, filename: "<test>" },
    );
    let runner: Runner;
    try {
      runner = await setup({ warn });
    } finally {
      pyodide.runPython(
        `import pyodide.console
pyodide.console.PyodideConsole.runcode = _saved_runcode
del _saved_runcode`,
        { globals: pyodide.globals, filename: "<test>" },
      );
    }

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain("[sigint-handler]");
    expect(warn.mock.calls[0]![0]).toContain("console.runcode");
    expect(runner.interruptIdle()).toBe(false);
    await expectStillInterruptible(runner);
  }, 30_000);
});

// `<console>` 파일명으로 정의해 이 코루틴의 프레임이 사용자 프레임으로 인정되게 한다. `time.sleep`은 5행이다.
const SLEEPER_SOURCE = `import asyncio, time

async def main():
    started()
    time.sleep(5)
`;

/** `SLEEPER_SOURCE`의 `time.sleep(5)` 눌림이 끝났을 때의 정확한 화면. `main` 프레임(5행)이 남는다. */
const CONSOLE_MAIN_SLEEP_TRACEBACK =
  'Traceback (most recent call last):\n  File "<console>", line 1, in <module>\n  File "<console>", line 5, in main\nKeyboardInterrupt\n';

describe("time.sleep과 정지한 대기의 조합", () => {
  it.each(RUNNERS)(
    "%s 코루틴 안의 time.sleep 중 눌림도 webloop 프레임 없이 끊고 main 프레임을 남긴다",
    async (_title, wrap) => {
      const runner = await setup();
      pyodide.runPython(SLEEPER_SOURCE, {
        globals: pyodide.globals,
        filename: "<console>",
      });
      const presser = runner.presser();
      presser.press({ offsets: [300] });
      const startedAt = performance.now();

      expect(await runner.run(wrap("main()"))).toEqual(READY);

      expect(performance.now() - startedAt).toBeLessThan(300 + WAKE_LIMIT_MS);
      expect(runner.screen.stderr).toBe(CONSOLE_MAIN_SLEEP_TRACEBACK);
      await presser.done();
    },
    20_000,
  );
});

// RD-009a: run_sync 계열 대기 안 코루틴이 예외로 끝났을 때 excepthook 이중 인쇄를 없앤다(guard가 값으로 나른다).
describe("run_sync 계열 대기에서 코루틴이 낸 예외", () => {
  it.each(RUNNERS)(
    "%s: 코루틴이 낸 ValueError는 트레이스백이 한 번만 찍히고 main 프레임이 남는다",
    async (_title, wrap) => {
      const runner = await setup();
      pyodide.runPython("async def main():\n    raise ValueError('boom')\n", {
        globals: pyodide.globals,
        filename: "<console>",
      });

      expect(await runner.run(wrap("main()"))).toEqual(READY);

      expect(runner.screen.stderr).toBe(
        'Traceback (most recent call last):\n  File "<console>", line 1, in <module>\n  File "<console>", line 2, in main\nValueError: boom\n',
      );
    },
    20_000,
  );

  it.each(RUNNERS)(
    "%s: 코루틴이 낸 KeyboardInterrupt는 인자가 보존되고 한 번만 찍힌다",
    async (_title, wrap) => {
      const runner = await setup();
      pyodide.runPython(
        "async def main():\n    raise KeyboardInterrupt('custom')\n",
        { globals: pyodide.globals, filename: "<console>" },
      );

      expect(await runner.run(wrap("main()"))).toEqual(READY);

      expect(
        runner.screen.stderr.match(/Traceback \(most recent call last\):/g),
      ).toHaveLength(1);
      expect(
        runner.screen.stderr.match(/KeyboardInterrupt: custom/g),
      ).toHaveLength(1);
      expect(runner.screen.stderr).not.toContain(SIGINT_HANDLER_FILENAME);
    },
    20_000,
  );

  it("except 안에서 눌린 time.sleep도 컨텍스트 연쇄 문구가 한 번만 찍힌다", async () => {
    const runner = await setup();
    pyodide.runPython(
      `import time

async def main():
    started()
    try:
        raise ValueError('inner')
    except ValueError:
        time.sleep(5)
`,
      { globals: pyodide.globals, filename: "<console>" },
    );
    const presser = runner.presser();
    presser.press({ offsets: [300] });
    const startedAt = performance.now();

    expect(await runner.run("asyncio.run(main())")).toEqual(READY);

    expect(performance.now() - startedAt).toBeLessThan(300 + WAKE_LIMIT_MS);
    expect(
      runner.screen.stderr.match(
        /During handling of the above exception, another exception occurred:/g,
      ),
    ).toHaveLength(1);
    expect(runner.screen.stderr).not.toContain(SIGINT_HANDLER_FILENAME);
    expect(runner.screen.stderr).not.toContain("<sleep-slice>");
    expect(runner.screen.stderr).toMatch(/KeyboardInterrupt\n$/);
    expect(runner.screen.stderr.match(/ValueError: inner/g)).toHaveLength(1);
    await presser.done();
  }, 20_000);

  it("코루틴 안에서 KeyboardInterrupt를 잡고 finally도 실행된다", async () => {
    const runner = await setup();
    pyodide.runPython(
      `import time

async def main():
    started()
    try:
        time.sleep(5)
    except KeyboardInterrupt:
        print('caught')
    finally:
        print('fin')
`,
      { globals: pyodide.globals, filename: "<console>" },
    );
    const presser = runner.presser();
    presser.press({ offsets: [300] });
    const startedAt = performance.now();

    expect(await runner.run("asyncio.run(main())")).toEqual(READY);

    expect(performance.now() - startedAt).toBeLessThan(300 + WAKE_LIMIT_MS);
    expect(runner.screen.stdout).toBe("caught\nfin\n");
    expect(runner.screen.stderr).toBe("");
    await presser.done();
  }, 20_000);

  it("코루틴 안 sys.exit는 트레이스백 없이 종료 표시로 끝난다", async () => {
    const runner = await setup();
    pyodide.runPython("async def main():\n    import sys\n    sys.exit(3)\n", {
      globals: pyodide.globals,
      filename: "<console>",
    });

    expect(await runner.run("asyncio.run(main())")).toEqual({
      prompt: PS1,
      exit: true,
    });

    expect(runner.screen.stderr).toBe("");
  }, 20_000);

  // 사용자가 잡은 예외의 __traceback__에도 나르며 다듬은 결과가 그대로 보인다: guard·sleep 조각·핸들러·JS 가짜
  // 프레임이 없다. run_sync 래퍼(<sigint-handler>)와 pyodide webloop.py는 실제 호출 경로라 남아도 허용 편차다.
  it("사용자가 잡은 KeyboardInterrupt의 __traceback__에는 우리 헬퍼 프레임이 없다", async () => {
    const runner = await setup();
    pyodide.runPython(SLEEPER_SOURCE, {
      globals: pyodide.globals,
      filename: "<console>",
    });
    pyodide.runPython(
      `def catcher():
    try:
        asyncio.run(main())
    except KeyboardInterrupt as e:
        import traceback
        print([(f.filename, f.name) for f in traceback.extract_tb(e.__traceback__)])
`,
      { globals: pyodide.globals, filename: "<console>" },
    );
    const presser = runner.presser();
    presser.press({ offsets: [300] });
    const startedAt = performance.now();

    expect(await runner.run("catcher()")).toEqual(READY);

    expect(performance.now() - startedAt).toBeLessThan(300 + WAKE_LIMIT_MS);
    expect(runner.screen.stdout).not.toMatch(/'guard'|'sleep'|'poll'|'sigint_handler'/);
    expect(runner.screen.stdout).not.toContain("<sleep-slice>");
    expect(runner.screen.stdout).not.toContain("wasm://");
    expect(runner.screen.stdout).not.toContain("pyodide.asm.mjs");
    expect(runner.screen.stderr).toBe("");
    await presser.done();
  }, 20_000);

  it("코루틴이 부른 <console> 함수의 프레임도 남는다(중첩)", async () => {
    const runner = await setup();
    pyodide.runPython(
      `async def main():
    helper()

def helper():
    started()
    time.sleep(5)
`,
      { globals: pyodide.globals, filename: "<console>" },
    );
    const presser = runner.presser();
    presser.press({ offsets: [300] });
    const startedAt = performance.now();

    expect(await runner.run("asyncio.run(main())")).toEqual(READY);

    expect(performance.now() - startedAt).toBeLessThan(300 + WAKE_LIMIT_MS);
    expect(runner.screen.stderr).toBe(
      'Traceback (most recent call last):\n  File "<console>", line 1, in <module>\n  File "<console>", line 2, in main\n  File "<console>", line 6, in helper\nKeyboardInterrupt\n',
    );
    await presser.done();
  }, 20_000);

  // 코루틴 안에 사용자 프레임이 없는 경우(라이브러리가 낸 예외)의 규칙 검증: 안쪽 끝이 우리 코드가 아니므로 절단하지
  // 않고, 래퍼 프레임만 떼며 라이브러리 프레임(asyncio/tasks.py)은 남는다.
  it("코루틴 안에 사용자 프레임이 없으면 라이브러리 프레임이 남는다(TypeError)", async () => {
    const runner = await setup();

    expect(await runner.run("asyncio.run(asyncio.sleep('x'))")).toEqual(
      READY,
    );

    expect(
      runner.screen.stderr.match(/Traceback \(most recent call last\):/g),
    ).toHaveLength(1);
    expect(runner.screen.stderr).toContain("asyncio/tasks.py");
    expect(runner.screen.stderr).toMatch(/TypeError/);
    expect(runner.screen.stderr).not.toContain(SIGINT_HANDLER_FILENAME);
  }, 20_000);
});
