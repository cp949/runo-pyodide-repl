/**
 * `Readline.dispose()` 정책 시험.
 * StrictMode처럼 마운트 직후 dispose되는 경우에도 대기 중인 읽기가 끝나지 않고 남거나,
 * 해제된 xterm에 write 콜백이 닿지 않아야 한다. write 콜백을 동기/비동기로 돌려 둘 다 확인한다.
 */
import { describe, expect, test } from "vitest";
import { Readline } from "./readline";

type Outcome =
  | { state: "pending" }
  | { state: "resolved"; value: unknown }
  | { state: "rejected"; reason: unknown };

/**
 * promise의 현재 상태를 읽는 함수를 돌려준다. 끝나지 않는 읽기를 시험이 멈추지 않고 잡고,
 * reject된 promise에 핸들러가 붙어 있어 처리되지 않은 rejection이 생기지 않는다.
 */
function observe(promise: Promise<unknown>): () => Outcome {
  let outcome: Outcome = { state: "pending" };
  promise.then(
    (value) => {
      outcome = { state: "resolved", value };
    },
    (reason) => {
      outcome = { state: "rejected", reason };
    },
  );
  return () => outcome;
}

/** 대기 중인 마이크로태스크와 타이머 하나를 모두 지나가게 한다. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Readline이 읽는 xterm 멤버만 가진 시험용 터미널.
 * asyncWrite가 참이면 write 콜백을 flush() 때까지 미뤄 실제 xterm의 비동기 파싱을 흉내낸다.
 * cursorYReads는 buffer.active.cursorY를 읽은 횟수로, 해제된 터미널에 접근했는지 본다.
 */
function createStubTerminal(asyncWrite: boolean) {
  const counters = {
    written: [] as string[],
    cursorYReads: 0,
    listenerDisposals: 0,
  };
  const queue: (() => void)[] = [];
  const disposable = () => ({
    dispose: () => {
      counters.listenerDisposals += 1;
    },
  });
  const term = {
    cols: 80,
    rows: 24,
    options: { tabStopWidth: 8 },
    buffer: {
      active: {
        get cursorY() {
          counters.cursorYReads += 1;
          return 0;
        },
      },
    },
    onData: (_handler: (data: string) => void) => disposable(),
    onResize: (_handler: (size: { cols: number; rows: number }) => void) =>
      disposable(),
    attachCustomKeyEventHandler: (_fn: (event: KeyboardEvent) => boolean) => {},
    write: (text: string, callback?: () => void) => {
      counters.written.push(text);
      if (!callback) return;
      if (asyncWrite) queue.push(callback);
      else callback();
    },
  };
  const flush = () => {
    for (const callback of queue.splice(0)) callback();
  };
  return { term, counters, flush };
}

/** 시험용 터미널에 활성화한 Readline을 만든다. */
function createReadline(asyncWrite: boolean) {
  const stub = createStubTerminal(asyncWrite);
  const readline = new Readline({ persist: false });
  readline.activate(
    stub.term as unknown as Parameters<Readline["activate"]>[0],
  );
  return { readline, ...stub };
}

describe.each([
  { mode: "동기", asyncWrite: false },
  { mode: "비동기", asyncWrite: true },
])("write 콜백이 $mode 모드일 때", ({ asyncWrite }) => {
  test("읽기 대기 중 dispose하면 그 읽기가 Error로 reject된다", async () => {
    const { readline, flush } = createReadline(asyncWrite);
    const outcome = observe(readline.read("> "));
    flush();

    readline.dispose();
    await tick();

    expect(outcome()).toEqual({ state: "rejected", reason: expect.any(Error) });
  });

  test("dispose를 두 번 불러도 리스너 해제는 한 번씩만 일어난다", () => {
    const { readline, counters } = createReadline(asyncWrite);

    readline.dispose();
    readline.dispose();

    // onData와 onResize 리스너 두 개가 각각 한 번씩 해제된다.
    expect(counters.listenerDisposals).toBe(2);
  });

  test("dispose 뒤 read()는 터미널에 쓰지 않고 reject된다", async () => {
    const { readline, counters } = createReadline(asyncWrite);
    readline.dispose();

    const outcome = observe(readline.read("> "));
    await tick();

    expect(outcome().state).toBe("rejected");
    expect(counters.written).toEqual([]);
  });

  test("dispose 뒤 println은 터미널에 쓰지 않는다", () => {
    const { readline, counters } = createReadline(asyncWrite);
    readline.dispose();

    readline.println("늦게 도착한 출력");

    expect(counters.written).toEqual([]);
  });
});

describe("write 콜백이 아직 오지 않은 읽기", () => {
  test("콜백이 오기 전에 dispose해도 대기 중이던 읽기가 reject된다", async () => {
    const { readline } = createReadline(true);
    const outcome = observe(readline.read("> "));

    readline.dispose();
    await tick();

    expect(outcome()).toEqual({ state: "rejected", reason: expect.any(Error) });
  });

  test("dispose 뒤 뒤늦게 온 콜백은 해제된 터미널의 buffer를 읽지 않고 아무것도 쓰지 않는다", async () => {
    const { readline, counters, flush } = createReadline(true);
    const outcome = observe(readline.read("> "));
    readline.dispose();
    const writtenAtDispose = counters.written.length;

    flush();
    await tick();

    // 해제된 xterm의 buffer를 읽으면 DisposableStore 경고가 난다(이전 구현 TRP-001).
    expect(counters.cursorYReads).toBe(0);
    expect(counters.written).toHaveLength(writtenAtDispose);
    expect(outcome().state).toBe("rejected");
  });
});
