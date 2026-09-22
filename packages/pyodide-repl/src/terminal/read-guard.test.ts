/**
 * `createReadGuard` 시험(04-stdin-input.md 3.2). REPL 읽기와 stdin 읽기는 같은 `Readline`을 쓰고 `readline.read()`는 이미
 * 열린 읽기를 교체하면서 옛 읽기의 promise를 끝내지 않는다. 그래서 프롬프트를 기다리는 사이 배경 콜백이 `input()`을 부르면
 * REPL 읽기가 고아가 되어 입력이 멈춘다. 가드는 stdin 읽기를 활성 REPL 읽기의 결과가 정해진 뒤에 시작한다.
 * 앞 절은 결과를 시험이 정하는 가짜 읽기로 순서 규칙을, 뒤 절은 실제 `Readline` + 가짜 터미널로 REPL 줄이 REPL 읽기에
 * 전달되는지를 본다. 겹침 거절(`reading`)은 가드 바깥(`createRepl`)의 몫이라 여기서 보지 않는다.
 */
import { Readline } from "@cp949/runo-xterm-readline";
import { describe, expect, test, vi } from "vitest";
import { createFakeTerminal } from "../test/fake-terminal";
import { createReadGuard } from "./read-guard";
import { createReplReader } from "./repl-reader";
import { createTerminalSinks } from "./sinks";
import { createInputReader } from "./stdin-reader";

/** 매크로태스크 한 번. 가드가 걸어 둔 then 체인(마이크로태스크 여러 번)이 끝나기를 기다린다. */
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

type Outcome =
  | { state: "pending" }
  | { state: "resolved"; value: unknown }
  | { state: "rejected"; reason: unknown };

/**
 * promise의 현재 상태를 읽는 함수를 돌려준다. 끝나지 않는 읽기가 시험을 멈추지 않게 하고, reject된 promise에
 * 핸들러가 붙어 처리되지 않은 rejection이 생기지 않는다.
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

/** 결과를 시험이 정하는 읽기. `resolve`·`reject`를 밖에서 부른다. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** REPL 읽기는 취소(`null`)로도 끝난다. stdin 읽기도 같은 형태다. */
type Deferred = ReturnType<typeof deferred<string | null>>;

/**
 * 원본 읽기 두 개를 가짜로 둔 가드. 호출마다 새 deferred를 만들어 `replReads`·`inputReads`에 쌓고 시험이 끝을 정한다.
 * 호출 기록은 `rawReadLine`·`rawReadInput`(`vi.fn`)에 남는다.
 */
function createGuarded() {
  const replReads: Deferred[] = [];
  const inputReads: Deferred[] = [];
  const rawReadLine = vi.fn<
    (prompt: string, cancelable: boolean) => Promise<string | null>
  >(() => {
    const read = deferred<string | null>();
    replReads.push(read);
    return read.promise;
  });
  const rawReadInput = vi.fn<(cancelable: boolean) => Promise<string | null>>(
    () => {
      const read = deferred<string | null>();
      inputReads.push(read);
      return read.promise;
    },
  );
  const guard = createReadGuard({
    readLine: rawReadLine,
    readInput: rawReadInput,
  });
  // noUncheckedIndexedAccess가 켜져 있어 인덱스 접근은 undefined일 수 있다. 없으면 바로 실패시킨다.
  const at = (reads: Deferred[], kind: string) => (index: number) => {
    const read = reads[index];
    if (!read) throw new Error(`${kind} 읽기 #${index}가 시작되지 않았다`);
    return read;
  };
  return {
    guard,
    rawReadLine,
    rawReadInput,
    replReadAt: at(replReads, "REPL"),
    inputReadAt: at(inputReads, "stdin"),
  };
}

describe("createReadGuard: stdin 읽기는 활성 REPL 읽기가 끝난 뒤에 시작한다", () => {
  test("활성 REPL 읽기가 있으면 stdin 읽기는 그 읽기가 끝난 뒤에 시작하고 두 결과는 그대로 전달된다", async () => {
    const { guard, rawReadInput, replReadAt, inputReadAt } = createGuarded();
    const repl = guard.readLine(">>> ", true);
    const input = guard.readInput(true);
    await tick();
    expect(rawReadInput).not.toHaveBeenCalled();

    replReadAt(0).resolve("x = 41");
    await tick();

    expect(rawReadInput).toHaveBeenCalledTimes(1);
    inputReadAt(0).resolve("hello");
    await expect(repl).resolves.toBe("x = 41");
    await expect(input).resolves.toBe("hello");
  });

  test("활성 REPL 읽기가 없으면 stdin 읽기는 기다리지 않고 시작한다", async () => {
    const { guard, rawReadInput, inputReadAt } = createGuarded();

    const input = guard.readInput(true);
    // 마이크로태스크 한 번이면 충분해야 한다. 매크로태스크를 기다려야 시작한다면 기다리지 않는 것이 아니다.
    await Promise.resolve();

    expect(rawReadInput).toHaveBeenCalledTimes(1);
    inputReadAt(0).resolve("answer");
    await expect(input).resolves.toBe("answer");
  });

  test("REPL 읽기가 reject돼도 stdin 읽기는 시작하고 reject는 REPL 호출자에게 그대로 간다", async () => {
    const { guard, rawReadInput, replReadAt, inputReadAt } = createGuarded();
    const error = new Error("읽기 실패");
    const repl = observe(guard.readLine(">>> ", true));
    const input = observe(guard.readInput(true));

    replReadAt(0).reject(error);
    await tick();

    expect(repl()).toEqual({ state: "rejected", reason: error });
    expect(rawReadInput).toHaveBeenCalledTimes(1);
    inputReadAt(0).resolve("answer");
    await tick();
    expect(input()).toEqual({ state: "resolved", value: "answer" });
  });

  test("REPL 읽기가 끝난 뒤에는 stdin 읽기가 연달아 와도 앞 읽기를 기다리지 않고 각각 바로 시작한다", async () => {
    const { guard, rawReadInput, replReadAt } = createGuarded();
    void guard.readLine(">>> ", true);
    replReadAt(0).resolve("f()");
    await tick();

    // 앞 stdin 읽기는 끝나지 않은 채로 둔다. 직렬화하면 둘째는 시작하지 못한다.
    void guard.readInput(true);
    void guard.readInput(true);
    await tick();

    expect(rawReadInput).toHaveBeenCalledTimes(2);
  });

  test("다음 프롬프트의 새 REPL 읽기가 시작되면 끝난 옛 읽기가 아니라 새 읽기를 기다린다", async () => {
    const { guard, rawReadInput, replReadAt } = createGuarded();
    void guard.readLine(">>> ", true);
    replReadAt(0).resolve("a = 1");
    await tick();
    void guard.readLine(">>> ", true);
    void guard.readInput(true);
    await tick();
    expect(rawReadInput).not.toHaveBeenCalled();

    replReadAt(1).resolve("b = 2");
    await tick();

    expect(rawReadInput).toHaveBeenCalledTimes(1);
  });

  test("REPL 읽기는 가드를 거쳐도 즉시 시작된다(시작 타이밍 불변)", () => {
    const { guard, rawReadLine } = createGuarded();

    void guard.readLine(">>> ", true);

    // 동기로 확인한다. 마이크로태스크라도 미루면 시작 타이밍이 바뀐 것이다.
    expect(rawReadLine).toHaveBeenCalledTimes(1);
    expect(rawReadLine).toHaveBeenCalledWith(">>> ", true);
  });

  test("REPL 읽기가 취소(`null`)로 끝나도 stdin 읽기는 시작한다", async () => {
    const { guard, rawReadInput, replReadAt, inputReadAt } = createGuarded();
    const repl = guard.readLine(">>> ", true);
    const input = guard.readInput(true);
    await tick();
    expect(rawReadInput).not.toHaveBeenCalled();

    // 취소는 실패가 아니라 값(`null`)이다. 가드는 REPL 읽기가 끝났다는 것만 본다.
    replReadAt(0).resolve(null);
    await tick();

    expect(rawReadInput).toHaveBeenCalledTimes(1);
    inputReadAt(0).resolve("hello");
    await expect(repl).resolves.toBeNull();
    await expect(input).resolves.toBe("hello");
  });

  test("`cancelable` 인자를 그대로 원본 읽기에 넘긴다", async () => {
    const { guard, rawReadLine, rawReadInput, replReadAt } = createGuarded();

    void guard.readLine(">>> ", false);
    void guard.readInput(false);
    // stdin 읽기는 활성 REPL 읽기가 끝난 뒤에 시작한다.
    replReadAt(0).resolve("x = 1");
    await tick();

    expect(rawReadLine).toHaveBeenCalledWith(">>> ", false);
    expect(rawReadInput).toHaveBeenCalledWith(false);
  });

  test("stdin 읽기가 reject되면 가드가 삼키지 않고 호출자에게 그대로 전달한다", async () => {
    const { guard, inputReadAt } = createGuarded();
    const error = new Error("stdin 읽기 실패");
    const input = observe(guard.readInput(true));
    await tick();

    inputReadAt(0).reject(error);
    await tick();

    expect(input()).toEqual({ state: "rejected", reason: error });
  });
});

describe.each([
  { mode: "동기", asyncWrite: false },
  { mode: "비동기", asyncWrite: true },
])(
  "createReadGuard: 실제 Readline에서 REPL 읽기가 고아가 되지 않는다(write 콜백이 $mode 모드일 때)",
  ({ asyncWrite }) => {
    // 가드가 없으면 stdin 읽기가 `readline.read()`로 REPL 읽기를 교체해, 사용자가 REPL 줄에 친 입력이 stdin 읽기로 가고
    // REPL 읽기는 영영 끝나지 않는다. `createRepl`과 같이 REPL 읽기 = `createReplReader`, stdin 읽기 = `createInputReader`다.
    function setup() {
      const fake = createFakeTerminal({ asyncWrite });
      const readline = new Readline({ persist: false });
      fake.term.loadAddon(readline);
      const sinks = createTerminalSinks(readline);
      // 실제 `read`를 그대로 호출하면서 받은 프롬프트를 기록한다.
      const read = vi.spyOn(readline, "read");
      const replReader = createReplReader(readline, fake.term, sinks);
      const inputReader = createInputReader(readline, fake.term, sinks);
      const guard = createReadGuard({
        readLine: (prompt: string, cancelable: boolean) =>
          replReader.read(prompt, cancelable),
        readInput: (cancelable: boolean) => inputReader.read(cancelable),
      });
      /** write 콜백을 배출하고 대기 중인 마이크로태스크·타이머를 지나가게 한다. 비동기 모드는 flush 전에 읽기가 시작되지 않는다. */
      async function settle() {
        fake.flush();
        await tick();
        fake.flush();
        await tick();
      }
      /** 지금까지 `readline.read`가 받은 프롬프트. */
      const prompts = () => read.mock.calls.map(([prompt]) => prompt);
      return { fake, sinks, guard, prompts, settle };
    }

    test("REPL 읽기 중 배경 input()이 들어와도 REPL 줄은 REPL 읽기가, 그다음 줄은 stdin 읽기가 받는다", async () => {
      const { fake, sinks, guard, prompts, settle } = setup();
      const repl = observe(guard.readLine(">>> ", true));
      await settle();

      // 프롬프트를 기다리는 사이 배경 콜백의 `input("bg> ")`가 프롬프트를 쓰고 stdin 읽기를 요청한다.
      sinks.write("bg> ");
      const input = observe(guard.readInput(true));
      await settle();
      expect(prompts()).toEqual([">>> "]);

      // 사용자가 REPL 줄을 친다. 이 줄은 REPL 읽기가 받고 stdin 읽기는 아직 시작하지 않는다.
      fake.type("x = 41\r");
      await settle();
      expect(repl()).toEqual({ state: "resolved", value: "x = 41" });

      // REPL 읽기가 끝나 stdin 읽기가 시작됐다. 프롬프트는 배경 `input`의 꼬리(`bg> `)다. 다음 줄은 stdin 읽기가 받는다.
      expect(input()).toEqual({ state: "pending" });
      expect(prompts()).toEqual([">>> ", "bg> "]);
      fake.type("hello\r");
      await settle();
      expect(input()).toEqual({ state: "resolved", value: "hello" });
      expect(fake.written).toContain("bg> hello");
    });
  },
);
