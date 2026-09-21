/**
 * `createReplReader` 시험(04-stdin-input.md 3.3). 실제 `Readline` + 실제 `createTerminalSinks` + 가짜 터미널로,
 * 직전 출력의 꼬리가 `>>> ` 앞에 붙어 그 자리에 다시 그려지는지(`t>>> `) 프롬프트 합성과 순서를 본다.
 * write 콜백이 동기일 때와 비동기일 때를 모두 돌린다(비동기는 `rewindTail`의 flush 대기 순서를 통제한다, TRP-008).
 * 화면에 실제로 어떻게 그려지는지(앞 행 중복 없음)는 브라우저(Playwright)가 본다.
 */
import { Readline } from "@cp949/runo-xterm-readline";
import { describe, expect, test, vi } from "vitest";
import { createFakeTerminal } from "../test/fake-terminal";
import { createReplReader } from "./repl-reader";
import { createTerminalSinks } from "./sinks";

/** 매크로태스크 한 번. `rewindTail`의 await 사슬(마이크로태스크 여러 번)이 끝나기를 기다린다. */
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const RED = "\x1b[31m";
const RESET = "\x1b[0m";

describe.each([
  { mode: "동기", asyncWrite: false },
  { mode: "비동기", asyncWrite: true },
])("REPL 읽기(write 콜백이 $mode 모드일 때)", ({ asyncWrite }) => {
  function setup() {
    const fake = createFakeTerminal({ asyncWrite });
    const readline = new Readline({ persist: false });
    fake.term.loadAddon(readline);
    const sinks = createTerminalSinks(readline);
    // 실제 `read`를 그대로 호출하면서 받은 합성 프롬프트를 기록한다.
    const read = vi.spyOn(readline, "read");
    const reader = createReplReader(readline, fake.term, sinks);
    /**
     * 읽기를 시작하고 `readline.read`가 불릴 때까지 기다린 뒤 write 콜백을 배출한다. 꼬리가 길면 `rewindTail`이 flush를
     * 기다리므로 먼저 배출해야 `read`가 시작된다. 읽기가 끝나기를 기다리지 않도록(async 함수는 반환한 Promise를 풀어
     * 버린다) 시작한 읽기의 Promise를 객체에 담아 돌려준다.
     */
    async function startRead(
      prompt: string,
    ): Promise<{ line: Promise<string> }> {
      const line = reader.read(prompt);
      fake.flush();
      await tick();
      fake.flush();
      return { line };
    }
    /** 마지막 `readline.read`가 받은 합성 프롬프트. */
    const lastPrompt = () => read.mock.calls.at(-1)?.[0];
    return { fake, sinks, reader, startRead, lastPrompt };
  }

  test("꼬리가 없으면 프롬프트를 그대로 읽는다(SGR 리셋 없음)", async () => {
    const { startRead, lastPrompt } = setup();

    await startRead(">>> ");

    expect(lastPrompt()).toBe(">>> ");
  });

  test("개행 없이 끝난 stdout 꼬리가 프롬프트 앞에 붙는다(`t>>> `)", async () => {
    const { sinks, startRead, lastPrompt } = setup();
    sinks.write("t");

    await startRead(">>> ");

    expect(lastPrompt()).toBe("t\x1b[0m>>> ");
  });

  test("`... ` 프롬프트도 같은 합성이다", async () => {
    const { sinks, startRead, lastPrompt } = setup();
    sinks.write("t");

    await startRead("... ");

    expect(lastPrompt()).toBe("t\x1b[0m... ");
  });

  test("stderr 꼬리는 빨강 텍스트가 꼬리 본문에 남고 그 뒤에 리셋 한 번이 더 붙는다", async () => {
    const { sinks, startRead, lastPrompt } = setup();
    sinks.writeErrorRaw("e");

    await startRead(">>> ");

    expect(lastPrompt()).toBe(`${RED}e${RESET}${RESET}>>> `);
  });

  test("닫지 않은 색은 프롬프트 앞 리셋으로 닫힌다", async () => {
    const { sinks, startRead, lastPrompt } = setup();
    sinks.write("\x1b[32mG");

    await startRead(">>> ");

    expect(lastPrompt()).toBe("\x1b[32mG\x1b[0m>>> ");
  });

  test("`\\r`로 덮어쓴 진행률은 마지막 것만 꼬리가 된다(`100%>>> `)", async () => {
    const { sinks, startRead, lastPrompt } = setup();
    sinks.write("\r30%");
    sinks.write("\r100%");

    await startRead(">>> ");

    expect(lastPrompt()).toBe("100%\x1b[0m>>> ");
  });

  test("println으로 끝난 출력(값 에코)은 꼬리가 없다", async () => {
    const { sinks, startRead, lastPrompt } = setup();
    sinks.writeOutput("2");

    await startRead(">>> ");

    expect(lastPrompt()).toBe(">>> ");
  });

  test("읽기를 시작하면 꼬리를 비워 다음 읽기가 물려받지 않는다", async () => {
    const { fake, sinks, startRead, lastPrompt } = setup();
    sinks.write("t");
    const { line: first } = await startRead(">>> ");
    fake.type("\r");
    await first;

    await startRead(">>> ");

    expect(lastPrompt()).toBe(">>> ");
  });

  test("Enter로 친 줄을 돌려준다", async () => {
    const { fake, startRead } = setup();
    const { line } = await startRead(">>> ");

    fake.type("abc\r");

    await expect(line).resolves.toBe("abc");
  });

  test("꼬리 정리를 기다리는 사이에 온 출력도 꼬리에 반영한다", async () => {
    const { sinks, reader, fake, lastPrompt } = setup();
    sinks.write("x".repeat(100));

    // 100자 꼬리는 짧지 않아 `rewindTail`이 flush를 기다린다. 그 사이 출력 `Z`가 온다.
    void reader.read(">>> ");
    sinks.write("Z");
    fake.flush();
    await tick();
    fake.flush();

    expect(lastPrompt()).toBe(`${"x".repeat(100)}Z\x1b[0m>>> `);
  });

  test("폭을 넘는 꼬리는 커서를 첫 행까지 올린 다음에 프롬프트를 그린다", async () => {
    const { fake, sinks, startRead } = setup();
    fake.screen.cursorY = 1;
    fake.screen.wrappedRows = new Set([1]);
    sinks.write("x".repeat(100));

    await startRead(">>> ");

    const up = fake.written.indexOf("\x1b[1A");
    const promptDraw = fake.written.findIndex((text) => text.includes(">>> "));
    expect(up).toBeGreaterThan(-1);
    expect(promptDraw).toBeGreaterThan(up);
  });
});
