/**
 * sink 4종(`createTerminalSinks`)의 개행·색·꼬리 계약 시험(05-output.md 4.1, TRAP-29).
 * 실제 `Readline`을 가짜 터미널에 붙여 터미널로 나간 바이트를 그대로 비교한다. 벤더 `write`가
 * `\n`을 `\r\n`으로 정규화하므로 fake가 아니라 실제 `Readline`이어야 이중 개행을 놓치지 않는다.
 * pyodide·worker는 쓰지 않는다(실제 `PyodideConsole`과의 바이트 비교는 sinks-pyodide.test.ts).
 */
import { Readline } from "@cp949/runo-xterm-readline";
import { describe, expect, test } from "vitest";
import { createFakeTerminal } from "@repo/pyodide-testkit/fake-terminal";
import { createTerminalSinks } from "./sinks";

function setup() {
  const fake = createFakeTerminal();
  const readline = new Readline({ persist: false });
  fake.term.loadAddon(readline);
  const sinks = createTerminalSinks(readline);
  /** 터미널에 나간 바이트 전부. */
  const bytes = () => fake.written.join("");
  return { fake, sinks, bytes };
}

const RED = "\x1b[31m";
const RESET = "\x1b[0m";

describe("sink 4종의 개행·색 계약", () => {
  test("`writeOutput`은 텍스트 뒤에 `\\r\\n`을 한 번 붙인다", () => {
    const { sinks, bytes } = setup();

    sinks.writeOutput("2");

    expect(bytes()).toBe("2\r\n");
  });

  test("`writeOutput`에 든 `\\n`은 `\\r\\n`이 된다(배너 두 줄)", () => {
    const { sinks, bytes } = setup();

    sinks.writeOutput("a\nb");

    expect(bytes()).toBe("a\r\nb\r\n");
  });

  test("`writeError`는 줄 전체를 빨강으로 한 번 감싸고 `\\r\\n`을 붙인다", () => {
    const { sinks, bytes } = setup();

    sinks.writeError("Traceback\nZeroDivisionError");

    expect(bytes()).toBe("\x1b[31mTraceback\r\nZeroDivisionError\x1b[0m\r\n");
  });

  test("`write`는 조각 그대로 내고 개행을 붙이지 않는다", () => {
    const { sinks, bytes } = setup();

    sinks.write("x");
    expect(bytes()).toBe("x");

    sinks.write("\r50%");
    expect(bytes()).toBe("x\r50%");
  });

  test("`write`의 `\\n`은 `\\r\\n`으로 정규화된다", () => {
    const { sinks, bytes } = setup();

    sinks.write("a\nb\n");

    expect(bytes()).toBe("a\r\nb\r\n");
  });

  test("`write`의 빈 조각은 터미널에 아무것도 쓰지 않는다", () => {
    const { fake, sinks } = setup();
    const before = fake.written.length;

    sinks.write("");

    expect(fake.written.length - before).toBe(0);
  });

  test("`writeErrorRaw`는 조각마다 빨강을 열고 닫는다", () => {
    const { sinks, bytes } = setup();

    sinks.writeErrorRaw("err");
    sinks.writeErrorRaw("\n");

    expect(bytes()).toBe("\x1b[31merr\x1b[0m\x1b[31m\r\n\x1b[0m");
  });

  test("`writeErrorRaw`의 빈 조각은 색 이스케이프도 내지 않는다", () => {
    const { fake, sinks } = setup();
    const before = fake.written.length;

    sinks.writeErrorRaw("");

    expect(fake.written.length - before).toBe(0);
  });

  test("`writeErrorRaw`는 `\\r` 진행률 조각을 그대로 낸다", () => {
    const { sinks, bytes } = setup();

    sinks.writeErrorRaw("\rprog 50%");

    expect(bytes()).toBe("\x1b[31m\rprog 50%\x1b[0m");
  });

  test("stdout과 stderr 조각은 호출 순서대로 섞이고 stdout은 빨강이 아니다", () => {
    const { sinks, bytes } = setup();

    sinks.write("out\n");
    sinks.writeErrorRaw("err");
    sinks.writeErrorRaw("\n");
    sinks.write("out2\n");

    expect(bytes()).toBe(
      "out\r\n\x1b[31merr\x1b[0m\x1b[31m\r\n\x1b[0mout2\r\n",
    );
  });
});

describe("꼬리 추적", () => {
  test("개행 없는 `write` 뒤 꼬리는 그 텍스트다", () => {
    const { sinks } = setup();

    sinks.write("t");

    expect(sinks.tail()).toBe("t");
  });

  test("`write`의 마지막 `\\r` 뒤만 꼬리다", () => {
    const { sinks } = setup();

    sinks.write("\r30%");
    sinks.write("\r100%");

    expect(sinks.tail()).toBe("100%");
  });

  test("`writeOutput`은 꼬리를 비운다", () => {
    const { sinks } = setup();
    sinks.write("t");

    sinks.writeOutput("2");

    expect(sinks.tail()).toBe("");
  });

  test("`writeError`는 꼬리를 비운다", () => {
    const { sinks } = setup();
    sinks.write("t");

    sinks.writeError("E");

    expect(sinks.tail()).toBe("");
  });

  test("`writeErrorRaw` 조각은 빨강 감싸기째 꼬리에 남는다", () => {
    const { sinks } = setup();

    sinks.writeErrorRaw("e");

    expect(sinks.tail()).toBe(`${RED}e${RESET}`);
  });

  test("여러 줄 stderr 조각의 마지막 줄은 색을 이어받는다", () => {
    const { sinks } = setup();

    sinks.writeErrorRaw("l1\nl2");

    expect(sinks.tail()).toBe(`${RED}l2${RESET}`);
  });

  test("stdout·stderr 조각이 화면 순서대로 꼬리에 이어진다", () => {
    const { sinks } = setup();

    sinks.write("a");
    sinks.writeErrorRaw("b");

    expect(sinks.tail()).toBe(`a${RED}b${RESET}`);
  });

  test("닫지 않은 색은 줄 경계를 넘어 꼬리 앞에 붙는다", () => {
    const { sinks } = setup();

    sinks.write("\x1b[32mA\nB");

    expect(sinks.tail()).toBe("\x1b[32mB");
  });

  test("`resetTail()`은 꼬리를 비운다", () => {
    const { sinks } = setup();
    sinks.write("t");

    sinks.resetTail();

    expect(sinks.tail()).toBe("");
  });

  test("sink 세트마다 꼬리가 따로다", () => {
    const first = setup();
    first.sinks.write("t");

    const second = setup();

    expect(second.sinks.tail()).toBe("");
    expect(first.sinks.tail()).toBe("t");
  });
});
