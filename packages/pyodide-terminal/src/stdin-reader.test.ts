/**
 * `createInputReader` 시험(04-stdin-input.md 3.3). 실제 `Readline` + 실제 `createTerminalSinks` + 가짜 터미널로,
 * `input("x: ")`의 프롬프트(직전 출력의 꼬리)가 SGR 리셋 없이 그대로 프롬프트가 되어 `x: abc` 한 줄로 그려지는지 본다.
 * REPL 읽기(`repl-reader.test.ts`)와 같은 도우미·순서 시험을 쓰되 합성 프롬프트가 아닌 꼬리 그대로를 확인한다.
 * write 콜백이 동기일 때와 비동기일 때를 모두 돌린다(비동기는 `rewindTail`의 flush 대기 순서를 통제한다, TRP-008).
 * 화면에 실제로 어떻게 그려지는지(앞 행 중복 없음)는 브라우저(Playwright)가 본다.
 */
import { Readline } from "@cp949/runo-xterm-readline";
import { describe, expect, test, vi } from "vitest";
import { createFakeTerminal } from "@repo/pyodide-testkit/fake-terminal";
import { createInputReader } from "./stdin-reader";
import { createTerminalSinks } from "./sinks";

/** 매크로태스크 한 번. `rewindTail`의 await 사슬(마이크로태스크 여러 번)이 끝나기를 기다린다. */
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const RED = "\x1b[31m";
const RESET = "\x1b[0m";

describe.each([
  { mode: "동기", asyncWrite: false },
  { mode: "비동기", asyncWrite: true },
])("stdin 읽기(write 콜백이 $mode 모드일 때)", ({ asyncWrite }) => {
  function setup() {
    const fake = createFakeTerminal({ asyncWrite });
    const readline = new Readline({ persist: false });
    fake.term.loadAddon(readline);
    const sinks = createTerminalSinks(readline);
    // 실제 `read`를 그대로 호출하면서 받은 프롬프트를 기록한다.
    const read = vi.spyOn(readline, "read");
    const reader = createInputReader(readline, fake.term, sinks);
    /**
     * 읽기를 시작하고 `readline.read`가 불릴 때까지 기다린 뒤 write 콜백을 배출한다. 꼬리가 길면 `rewindTail`이 flush를
     * 기다리므로 먼저 배출해야 `read`가 시작된다. 읽기가 끝나기를 기다리지 않도록(async 함수는 반환한 Promise를 풀어
     * 버린다) 시작한 읽기의 Promise를 객체에 담아 돌려준다.
     */
    async function startRead(
      cancelable = true,
    ): Promise<{ line: Promise<string | null> }> {
      const line = reader.read(cancelable);
      fake.flush();
      await tick();
      fake.flush();
      return { line };
    }
    /** 마지막 `readline.read`가 받은 프롬프트. */
    const lastPrompt = () => read.mock.calls.at(-1)?.[0];
    /** 마지막 `readline.read`가 받은 옵션. */
    const lastOptions = () => read.mock.calls.at(-1)?.[1];
    return {
      fake,
      readline,
      sinks,
      reader,
      startRead,
      lastPrompt,
      lastOptions,
    };
  }

  test('`input("x: ")`의 프롬프트를 꼬리로 받아 그 자리에 다시 그리고 입력값을 돌려준다', async () => {
    const { fake, sinks, startRead, lastPrompt } = setup();
    sinks.write("x: ");
    const { line } = await startRead();

    fake.type("abc\r");

    expect(lastPrompt()).toBe("x: ");
    await expect(line).resolves.toBe("abc");
    // Enter 때 프롬프트와 입력이 한 조각(`x: abc`)으로 다시 그려진다 — 화면에 한 줄로 남는 모양이다.
    expect(fake.written).toContain("x: abc");
  });

  test("꼬리가 없으면 프롬프트 없이 입력만 받는다", async () => {
    const { fake, startRead, lastPrompt } = setup();
    const { line } = await startRead();

    fake.type("abc\r");

    expect(lastPrompt()).toBe("");
    await expect(line).resolves.toBe("abc");
  });

  test("색이 닫힌 꼬리는 색 이스케이프까지 그대로 프롬프트가 되고 SGR 리셋을 더 붙이지 않는다", async () => {
    const { sinks, startRead, lastPrompt } = setup();
    sinks.write("\x1b[32mNm: \x1b[0m");

    await startRead();

    expect(lastPrompt()).toBe("\x1b[32mNm: \x1b[0m");
  });

  test("닫지 않은 색 꼬리에도 SGR 리셋을 붙이지 않는다(REPL 읽기와 다른 점: 열린 색이 입력에 이어진다)", async () => {
    const { sinks, startRead, lastPrompt } = setup();
    sinks.write("\x1b[32mG");

    await startRead();

    expect(lastPrompt()).toBe("\x1b[32mG");
  });

  test("stderr 꼬리도 그대로다(뒤에 리셋이 더 붙지 않는다)", async () => {
    const { sinks, startRead, lastPrompt } = setup();
    sinks.writeErrorRaw("e");

    await startRead();

    expect(lastPrompt()).toBe(`${RED}e${RESET}`);
  });

  test("읽기를 시작하면 꼬리를 비워 다음 읽기가 앞 프롬프트를 물려받지 않는다", async () => {
    const { fake, sinks, startRead, lastPrompt } = setup();
    sinks.write("x: ");
    const { line: first } = await startRead();
    fake.type("\r");
    await first;

    await startRead();

    expect(lastPrompt()).toBe("");
  });

  test("읽는 도중에도 꼬리는 이미 비어 있다", async () => {
    const { sinks, startRead } = setup();
    sinks.write("x: ");

    await startRead();

    expect(sinks.tail()).toBe("");
  });

  test("`cancelable`을 벤더 읽기 옵션으로 그대로 넘긴다", async () => {
    const { startRead, lastOptions } = setup();

    await startRead(false);

    expect(lastOptions()).toEqual({ cancelable: false });
  });

  test("호출 옵션 `history: false`를 벤더 읽기 옵션으로 넘기고, 생략하면 history 키를 넣지 않는다", async () => {
    const { fake, reader, startRead, lastOptions } = setup();
    const first = reader.read(true, undefined, { history: false });
    fake.flush();
    await tick();
    fake.flush();
    expect(lastOptions()).toEqual({ cancelable: true, history: false });
    fake.type("abc\r");
    await expect(first).resolves.toBe("abc");

    await startRead();
    expect(lastOptions()).toStrictEqual({ cancelable: true });
  });

  test("`history: false`로 읽은 줄은 history에 남지 않고, 옵션 없이 읽은 줄은 남는다", async () => {
    const { fake, readline, reader, startRead } = setup();
    const first = reader.read(true, undefined, { history: false });
    fake.flush();
    await tick();
    fake.flush();
    fake.type("abc\r");
    await expect(first).resolves.toBe("abc");
    expect(readline.getHistory().entries).toEqual([]);

    const { line } = await startRead();
    fake.type("def\r");
    await expect(line).resolves.toBe("def");
    expect(readline.getHistory().entries).toEqual(["def"]);
  });

  test("cancelable 읽기 중 Ctrl+C는 `^C` 없이 `null`을 돌려준다", async () => {
    const { fake, sinks, startRead } = setup();
    sinks.write("x: ");
    const { line } = await startRead();

    fake.type("abc\x03");
    fake.flush();

    await expect(line).resolves.toBeNull();
    expect(fake.written.join("")).not.toContain("^C");
  });

  test("취소로 끝난 읽기도 꼬리를 남기지 않아 다음 읽기가 앞 프롬프트를 물려받지 않는다", async () => {
    const { fake, sinks, startRead, lastPrompt } = setup();
    sinks.write("x: ");
    const { line } = await startRead();
    fake.type("abc\x03");
    fake.flush();
    await expect(line).resolves.toBeNull();

    expect(sinks.tail()).toBe("");
    await startRead();
    expect(lastPrompt()).toBe("");
  });

  test("`cancelable`이 거짓이면 벤더 원본대로 `^C`를 찍고 읽기가 계속된다", async () => {
    const { fake, sinks, startRead } = setup();
    sinks.write("x: ");
    const { line } = await startRead(false);

    fake.type("abc\x03");
    fake.flush();
    await tick();

    expect(fake.written.join("")).toContain("^C");
    fake.type("1\r");
    await expect(line).resolves.toBe("1");
  });

  test("`\\r`로 덮어쓴 진행률 꼬리는 마지막 `\\r` 뒤만 프롬프트다", async () => {
    const { sinks, startRead, lastPrompt } = setup();
    sinks.write("\r30%");
    sinks.write("\r100%");

    await startRead();

    expect(lastPrompt()).toBe("100%");
  });

  test("flush를 기다리는 사이에 온 출력도 꼬리에 반영한다", async () => {
    const { sinks, reader, fake, lastPrompt } = setup();
    sinks.write("x".repeat(100));

    // 100자 꼬리는 짧지 않아 `rewindTail`이 flush를 기다린다. 그 사이 출력 `!`가 온다.
    void reader.read(true);
    sinks.write("!");
    fake.flush();
    await tick();
    fake.flush();

    expect(lastPrompt()).toBe(`${"x".repeat(100)}!`);
  });

  test("폭을 넘는 꼬리는 커서를 첫 행까지 올린 다음에 프롬프트를 그린다", async () => {
    const { fake, sinks, startRead } = setup();
    fake.screen.cursorY = 1;
    fake.screen.wrappedRows = new Set([1]);
    sinks.write("x".repeat(100));

    await startRead();

    // 꼬리가 곧 프롬프트라 x는 처음 출력(sink 쓰기)에도 나온다. 커서를 올린 뒤에 꼬리가 다시 그려졌는지를 본다.
    const up = fake.written.indexOf("\x1b[1A");
    expect(up).toBeGreaterThan(-1);
    expect(
      fake.written.slice(up + 1).some((text) => text.includes("xxxx")),
    ).toBe(true);
  });

  test("짧은 꼬리는 flush를 기다리지 않고 바로 읽기를 시작한다", async () => {
    const { sinks, reader, lastPrompt } = setup();
    sinks.write("x: ");

    // `fake.flush()`를 부르지 않는다. 비동기 모드에서 flush를 기다리면 `readline.read`가 불리지 않는다.
    void reader.read(true);
    await tick();

    expect(lastPrompt()).toBe("x: ");
  });

  test("꼬리 정리를 기다리는 사이 signal이 abort되면 읽기를 열지 않고 null을 돌려준다", async () => {
    const { fake, sinks, reader, lastPrompt } = setup();
    sinks.write("x: ");
    const controller = new AbortController();

    const line = reader.read(true, controller.signal);
    controller.abort();
    fake.flush();
    await tick();
    fake.flush();

    await expect(line).resolves.toBeNull();
    // 읽기를 열었다면 프롬프트가 벤더 `read`로 넘어갔을 것이다.
    expect(lastPrompt()).toBeUndefined();
    // 죽은 읽기가 열려 있지 않으므로 이어 친 줄이 어디에도 들어가지 않는다.
    fake.type("abc\r");
    expect(fake.written.join("")).not.toContain("abc");
  });

  test("abort되지 않은 signal은 읽기에 영향이 없다", async () => {
    const { fake, sinks, reader, lastPrompt } = setup();
    sinks.write("x: ");
    const controller = new AbortController();
    const line = reader.read(true, controller.signal);
    fake.flush();
    await tick();
    fake.flush();

    fake.type("abc\r");

    expect(lastPrompt()).toBe("x: ");
    await expect(line).resolves.toBe("abc");
  });

  test("새 sink 세트는 빈 프롬프트로 시작한다(세션 리셋의 단위 성질)", async () => {
    const { fake, readline, sinks, lastPrompt } = setup();
    sinks.write("x: ");
    // 세션 리셋 뒤에는 sink 세트가 새로 만들어진다. 이전 세트에 꼬리가 남아 있어도 새 리더는 물려받지 않는다.
    const fresh = createTerminalSinks(readline);
    const freshReader = createInputReader(readline, fake.term, fresh);

    void freshReader.read(true);
    await tick();

    expect(lastPrompt()).toBe("");
  });
});
