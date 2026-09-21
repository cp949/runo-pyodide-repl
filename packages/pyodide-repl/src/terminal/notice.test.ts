/**
 * 세션 밖 안내 줄(`writeNotice`) 시험. 비격리 경고(노랑)와 RD-010의 리셋 안내(청록)가 쓰는 함수로,
 * 실제 `Readline` + 가짜 터미널에서 나간 바이트를 그대로 비교한다. pyodide는 쓰지 않는다.
 */
import { Readline } from "@cp949/runo-xterm-readline";
import { describe, expect, test } from "vitest";
import { createFakeTerminal } from "../test/fake-terminal";
import { writeNotice } from "./notice";
import { createTerminalSinks } from "./sinks";

function setup() {
  const fake = createFakeTerminal();
  const readline = new Readline({ persist: false });
  fake.term.loadAddon(readline);
  const bytes = () => fake.written.join("");
  return { readline, bytes };
}

describe("안내 줄", () => {
  test("`warning`은 노랑으로 감싼 한 줄을 낸다", () => {
    const { readline, bytes } = setup();

    writeNotice(readline, "경고", "warning");

    expect(bytes()).toBe("\x1b[33m경고\x1b[0m\r\n");
  });

  test("`info`는 청록으로 감싼 한 줄을 낸다", () => {
    const { readline, bytes } = setup();

    writeNotice(readline, "리셋", "info");

    expect(bytes()).toBe("\x1b[36m리셋\x1b[0m\r\n");
  });

  // 실제로는 생기지 않는 시나리오다. 안내 줄이 sink를 거치지 않는다는 경계를 고정한다.
  test("안내 줄은 세션 sink의 꼬리와 무관하다", () => {
    const { readline } = setup();
    const sinks = createTerminalSinks(readline);
    sinks.write("t");

    writeNotice(readline, "경고", "warning");

    expect(sinks.tail()).toBe("t");
  });
});
