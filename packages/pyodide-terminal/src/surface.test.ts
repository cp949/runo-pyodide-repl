/**
 * `createTerminalSurface`·`surface.openIo()` 시험(terminal-surface DELTA-01). 실제 벤더 `Readline`·실제 sink·실제 선택 복사를
 * 가짜 터미널(`@repo/pyodide-testkit/fake-terminal`)에 붙인다. worker·core는 쓰지 않는다.
 * 소비자(`createTerminalRunner`·`createRepl`)가 어떤 정책으로 부르는지는 보지 않고 surface 계약만 본다:
 * 조립(선택 복사 ↔ `Readline`), 위젯 수명 정리, 세션 수명(`openIo`)의 게이트(TRP-004)·sinks 분리.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  createFakeTerminal,
  type FakeTerminal,
} from "@repo/pyodide-testkit/fake-terminal";
import { createTerminalSurface, type TerminalSurface } from "./surface";

/** 매크로태스크 한 번. `rewindTail`의 await 사슬(마이크로태스크 여러 번)이 끝나기를 기다린다. */
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function stubClipboard() {
  const writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
  return writeText;
}

/** 드래그로 선택을 만든 뒤 마우스를 놓는 사건(`mousedown` → `mouseup`). 선택 텍스트는 호출자가 `select`로 정한다. */
function drag(fake: FakeTerminal) {
  fake.term.element!.dispatchEvent(new MouseEvent("mousedown", { button: 0 }));
  document.dispatchEvent(new MouseEvent("mouseup"));
}

/** 끝나지 않는 읽기의 결과를 시험이 멈추지 않고 잡는다. */
function observe<T>(promise: Promise<T>) {
  const outcome: {
    state: "pending" | "resolved" | "rejected";
    value?: unknown;
  } = { state: "pending" };
  promise.then(
    (value) => {
      outcome.state = "resolved";
      outcome.value = value;
    },
    (reason: unknown) => {
      outcome.state = "rejected";
      outcome.value = reason;
    },
  );
  return outcome;
}

const surfaces: TerminalSurface[] = [];
function setup(
  terminalOptions: Parameters<typeof createFakeTerminal>[0] = {},
  options: Parameters<typeof createTerminalSurface>[1] = {},
) {
  const fake = createFakeTerminal({ withElement: true, ...terminalOptions });
  const surface = createTerminalSurface(fake.term, {
    readline: { persist: false },
    ...options,
  });
  surfaces.push(surface);
  return { fake, surface };
}

afterEach(() => {
  for (const surface of surfaces.splice(0)) surface.dispose();
  Reflect.deleteProperty(navigator, "clipboard");
  localStorage.clear();
});

describe("openIo 게이트(TRP-004)", () => {
  test("close() 전에는 write 콜백을 전달하고 close() 뒤에는 전달하지 않는다", () => {
    const { fake, surface } = setup({ asyncWrite: true });
    const io = surface.openIo();
    const before = vi.fn();
    const after = vi.fn();

    io.terminal.write("a", before);
    fake.flush();
    io.close();
    io.terminal.write("b", after);
    fake.flush();

    expect(before).toHaveBeenCalledTimes(1);
    expect(after).not.toHaveBeenCalled();
    // 콜백을 전달하지 않을 뿐 write 자체는 터미널에 간다.
    expect(fake.written).toContain("b");
  });

  test("콜백 없는 write는 close() 뒤에도 그대로 터미널에 쓴다", () => {
    const { fake, surface } = setup();
    const io = surface.openIo();

    io.close();
    io.terminal.write("x");

    expect(fake.written).toContain("x");
  });

  test("cols와 buffer는 터미널 값을 그대로 읽는다", () => {
    const { fake, surface } = setup({ cols: 42 });
    const io = surface.openIo();

    expect(io.terminal.cols).toBe(42);
    expect(io.terminal.buffer).toBe(fake.term.buffer);
  });

  test("폭을 넘는 꼬리를 정리하려고 flush를 기다리는 중 close·dispose·terminal.dispose 해도 해제된 터미널의 buffer를 읽지 않는다", async () => {
    const { fake, surface } = setup({ asyncWrite: true });
    const io = surface.openIo();
    io.sinks.write("x".repeat(50));
    const read = observe(io.inputReader.read(false));
    await tick();

    io.close();
    surface.dispose();
    fake.term.dispose();
    fake.flush();
    await tick();

    expect(fake.disposedBufferReads).toBe(0);
    // 게이트가 flush 콜백을 막았으므로 읽기는 열리지 않은 채 남는다(dispose가 끝내 주지도 않는다).
    expect(read.state).toBe("pending");
  });

  test("한 io의 close()는 다른 io의 게이트에 영향을 주지 않는다", () => {
    const { fake, surface } = setup({ asyncWrite: true });
    const first = surface.openIo();
    const second = surface.openIo();
    const onFirst = vi.fn();
    const onSecond = vi.fn();

    first.terminal.write("a", onFirst);
    second.terminal.write("b", onSecond);
    first.close();
    fake.flush();

    expect(onFirst).not.toHaveBeenCalled();
    expect(onSecond).toHaveBeenCalledTimes(1);
  });

  test("close()는 여러 번 불러도 안전하고 닫힌 상태를 유지한다", () => {
    const { fake, surface } = setup({ asyncWrite: true });
    const io = surface.openIo();
    const callback = vi.fn();

    io.close();
    expect(() => io.close()).not.toThrow();
    io.terminal.write("a", callback);
    fake.flush();

    expect(callback).not.toHaveBeenCalled();
  });

  test("surface.dispose()는 열린 io를 닫지 않는다(닫는 시점은 소비자가 정한다)", () => {
    const { fake, surface } = setup({ asyncWrite: true });
    const io = surface.openIo();
    const whileOpen = vi.fn();
    const afterClose = vi.fn();

    surface.dispose();
    io.terminal.write("a", whileOpen);
    fake.flush();
    io.close();
    io.terminal.write("b", afterClose);
    fake.flush();

    expect(whileOpen).toHaveBeenCalledTimes(1);
    expect(afterClose).not.toHaveBeenCalled();
  });
});

describe("openIo 세션 분리", () => {
  test("호출마다 서로 다른 sinks를 만들고 꼬리를 공유하지 않는다", () => {
    const { surface } = setup();
    const first = surface.openIo();
    const second = surface.openIo();

    first.sinks.write("첫 세션 출력");

    expect(second.sinks).not.toBe(first.sinks);
    expect(first.sinks.tail()).toBe("첫 세션 출력");
    expect(second.sinks.tail()).toBe("");
    expect(second.inputReader).not.toBe(first.inputReader);
    expect(second.terminal).not.toBe(first.terminal);
  });

  test("sinks는 surface의 Readline으로 쓴다", () => {
    const { fake, surface } = setup();
    const io = surface.openIo();

    io.sinks.write("hello");

    expect(fake.written.join("")).toContain("hello");
  });

  test("inputReader는 같은 io의 sinks 꼬리를 프롬프트로 쓰고 읽기를 시작하며 꼬리를 비운다", async () => {
    const { fake, surface } = setup();
    const io = surface.openIo();
    const other = surface.openIo();
    io.sinks.write("이름: ");
    other.sinks.write("다른 세션");

    const read = io.inputReader.read(false);
    await tick();
    fake.type("kim\r");

    await expect(read).resolves.toBe("kim");
    expect(fake.written.join("")).toContain("이름: ");
    expect(io.sinks.tail()).toBe("");
    expect(other.sinks.tail()).toBe("다른 세션");
  });

  test("inputReader의 flush 대기는 같은 io의 게이트를 따른다: 다른 io가 열려 있어도 닫힌 io의 읽기는 열리지 않는다", async () => {
    const { fake, surface } = setup({ asyncWrite: true });
    const closing = surface.openIo();
    const open = surface.openIo();
    closing.sinks.write("x".repeat(50));
    open.sinks.write("y".repeat(50));
    const closingRead = observe(closing.inputReader.read(false));
    const openRead = observe(open.inputReader.read(false));
    await tick();

    closing.close();
    fake.flush();
    await tick();
    fake.flush();

    // 닫힌 io의 리더는 flush 콜백을 받지 못해 읽기를 열지 못한다. 열린 io의 리더는 읽기를 열어(꼬리 재그리기) 입력을 기다린다.
    expect(closingRead.state).toBe("pending");
    fake.type("z\r");
    await tick();
    expect(openRead).toMatchObject({ state: "resolved", value: "z" });
    expect(closing.sinks.tail()).toBe("x".repeat(50));
    expect(open.sinks.tail()).toBe("");
  });
});

describe("선택 복사 조립", () => {
  test("선택이 있을 때 Ctrl+C는 복사하고 선택을 지운다(onKeyEvent 배선)", async () => {
    const writeText = stubClipboard();
    const onCopy = vi.fn();
    const { fake } = setup({}, { onCopy });
    fake.select("복사할 글");

    const passedToXterm = fake.keyDown({ key: "c", ctrlKey: true });
    await tick();

    expect(passedToXterm).toBe(false);
    expect(writeText).toHaveBeenCalledWith("복사할 글");
    expect(onCopy).toHaveBeenCalledWith({ ok: true, chars: 5 });
    expect(fake.clearSelectionCalls).toBe(1);
  });

  test("선택이 없으면 Ctrl+C는 복사하지 않고 선택도 지우지 않는다", async () => {
    const writeText = stubClipboard();
    const { fake } = setup();

    fake.keyDown({ key: "c", ctrlKey: true });
    await tick();

    expect(writeText).not.toHaveBeenCalled();
    expect(fake.clearSelectionCalls).toBe(0);
  });

  test("copyOnSelect 기본은 참이라 드래그 선택을 자동 복사한다", async () => {
    const writeText = stubClipboard();
    const onCopy = vi.fn();
    const { fake } = setup({}, { onCopy });
    fake.select("abc");

    drag(fake);
    await tick();

    expect(writeText).toHaveBeenCalledWith("abc");
    expect(onCopy).toHaveBeenCalledWith({ ok: true, chars: 3 });
  });

  test("copyOnSelect: false면 처음부터 자동 복사하지 않지만 Ctrl+C 복사는 한다", async () => {
    const writeText = stubClipboard();
    const { fake } = setup({}, { copyOnSelect: false });
    fake.select("abc");

    drag(fake);
    expect(writeText).not.toHaveBeenCalled();

    fake.keyDown({ key: "c", ctrlKey: true });
    expect(writeText).toHaveBeenCalledTimes(1);
  });

  test("setCopyOnSelect로 자동 복사를 끄고 다시 켠다", () => {
    const writeText = stubClipboard();
    const { fake, surface } = setup();
    fake.select("abc");

    surface.setCopyOnSelect(false);
    drag(fake);
    expect(writeText).not.toHaveBeenCalled();

    surface.setCopyOnSelect(true);
    drag(fake);
    expect(writeText).toHaveBeenCalledTimes(1);
  });

  test("onCopy를 주지 않아도 복사 결과 알림에서 던지지 않는다", async () => {
    stubClipboard();
    const { fake } = setup();
    fake.select("abc");
    const errors: unknown[] = [];
    const onError = (event: PromiseRejectionEvent) => errors.push(event.reason);
    window.addEventListener("unhandledrejection", onError);

    drag(fake);
    await tick();
    window.removeEventListener("unhandledrejection", onError);

    expect(errors).toEqual([]);
  });
});

describe("Readline 옵션", () => {
  test("readline 옵션이 Readline에 전달된다: typeAhead: false면 읽기 밖 입력을 버린다", async () => {
    const discarding = setup(
      {},
      { readline: { persist: false, typeAhead: false } },
    );
    discarding.fake.type("ab");
    const first = discarding.surface.openIo().inputReader.read(false);
    await tick();
    discarding.fake.type("\r");
    await expect(first).resolves.toBe("");

    // 기본(typeAhead 켜짐)이면 읽기 밖 입력이 다음 읽기에 이어진다(대조).
    const keeping = setup();
    keeping.fake.type("ab");
    const second = keeping.surface.openIo().inputReader.read(false);
    await tick();
    keeping.fake.type("\r");
    await expect(second).resolves.toBe("ab");
  });

  test("readline 옵션이 Readline에 전달된다: skipBlankHistory면 빈 줄을 history에 남기지 않는다", async () => {
    const skipping = setup(
      {},
      { readline: { persist: false, skipBlankHistory: true } },
    );
    const first = skipping.surface.openIo().inputReader.read(false);
    await tick();
    skipping.fake.type("\r");
    await first;
    expect(skipping.surface.readline.getHistory().entries).toEqual([]);

    // 기본은 빈 줄도 남긴다(대조).
    const keeping = setup();
    const second = keeping.surface.openIo().inputReader.read(false);
    await tick();
    keeping.fake.type("\r");
    await second;
    expect(keeping.surface.readline.getHistory().entries).toEqual([""]);
  });

  test("options.readline이 없어도 조립된다", () => {
    const fake = createFakeTerminal({ withElement: true });
    const surface = createTerminalSurface(fake.term);
    surfaces.push(surface);

    expect(surface.readline).toBeDefined();
    expect(() => surface.openIo()).not.toThrow();
  });
});

describe("dispose", () => {
  test("선택 복사 리스너를 뗀다", () => {
    const writeText = stubClipboard();
    const { fake, surface } = setup();
    surface.dispose();
    fake.select("abc");

    drag(fake);

    expect(writeText).not.toHaveBeenCalled();
  });

  test("Readline을 뗀다: 열린 읽기는 reject되고 새 읽기는 시작되지 않는다", async () => {
    const { fake, surface } = setup();
    const io = surface.openIo();
    const open = observe(io.inputReader.read(false));
    await tick();

    surface.dispose();
    await tick();

    expect(open.state).toBe("rejected");
    expect(open.value).toEqual(new Error("readline disposed"));
    // 리스너를 뗐으므로 키 입력은 아무 일도 하지 않는다.
    const before = fake.written.length;
    fake.type("q\r");
    expect(fake.written).toHaveLength(before);
    const late = observe(surface.readline.read(""));
    await tick();
    expect(late.state).toBe("rejected");
  });

  test("여러 번 불러도 안전하다", () => {
    const { surface } = setup();

    surface.dispose();

    expect(() => surface.dispose()).not.toThrow();
  });

  test("dispose 뒤 setCopyOnSelect는 아무 일도 하지 않는다", () => {
    const writeText = stubClipboard();
    const { fake, surface } = setup({}, { copyOnSelect: false });
    surface.dispose();
    fake.select("abc");

    expect(() => surface.setCopyOnSelect(true)).not.toThrow();
    drag(fake);

    expect(writeText).not.toHaveBeenCalled();
  });
});

describe("loadAddon 실패", () => {
  test("loadAddon이 던지면 조립한 선택 복사를 떼고 그 예외를 그대로 던진다", () => {
    const writeText = stubClipboard();
    const fake = createFakeTerminal({ withElement: true });
    const failure = new Error("loadAddon 실패");
    vi.spyOn(fake.term, "loadAddon").mockImplementation(() => {
      throw failure;
    });

    expect(() => createTerminalSurface(fake.term)).toThrow(failure);
    fake.select("abc");
    drag(fake);

    expect(writeText).not.toHaveBeenCalled();
  });
});
