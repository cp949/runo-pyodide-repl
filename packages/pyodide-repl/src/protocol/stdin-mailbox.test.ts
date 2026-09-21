// @vitest-environment node
/**
 * stdin 메일박스 시험(01-protocols.md 2절, ADR-0002). 실제 SharedArrayBuffer 위에서 실제 worker 스레드가
 * `Atomics.wait`로 정지하고, main 역할(시험 본문)이 `deliver`/`cancel`/`fail`로 깨운다.
 */
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { spawnRole } from "../test/thread";
import { createMailboxWriter, createStdinMailbox } from "./stdin-mailbox";

/** worker 스레드의 `wait()` 결과. 값(문자열 또는 취소 null) 또는 던진 오류의 메시지. */
type ReadResult =
  { ok: true; value: string | null } | { ok: false; message: string };

// ADR-0002: CAPACITY를 바꾸면 청크 시험을 같이 바꾼다. 상수를 import하지 않고 리터럴로 둬서 바꾸면 시험이 실패하게 한다.
const CAPACITY = 64 * 1024;

/** 위치마다 문자가 달라 청크 순서가 뒤바뀌거나 빠지면 비교에서 드러나는 ASCII 문자열(바이트 수 = 길이). */
function patterned(length: number): string {
  return Array.from({ length }, (_, index) =>
    String.fromCharCode(97 + (index % 26)),
  ).join("");
}

function setup() {
  const mailbox = createStdinMailbox();
  const writer = createMailboxWriter(mailbox);
  const role = spawnRole("mailbox-reader", mailbox);
  return {
    writer,
    /** worker가 `wait()`에 들어가게 하고 그 결과를 기다린다. */
    read(): Promise<ReadResult> {
      role.post("wait");
      return role.next<ReadResult>();
    },
  };
}

describe("한 줄 전달", () => {
  it("한 청크 문자열을 worker의 wait()가 그대로 받는다", async () => {
    const { writer, read } = setup();

    const reading = read();
    await writer.deliver("abc");

    await expect(reading).resolves.toEqual({ ok: true, value: "abc" });
  });
});

describe("청크 경계", () => {
  it("빈 문자열은 빈 문자열이다(취소 null과 구분된다)", async () => {
    const { writer, read } = setup();

    const reading = read();
    await writer.deliver("");

    await expect(reading).resolves.toEqual({ ok: true, value: "" });
  });

  it("정확히 64KiB는 한 청크로 전달된다", async () => {
    const { writer, read } = setup();
    const text = patterned(CAPACITY);

    const reading = read();
    await writer.deliver(text);

    await expect(reading).resolves.toEqual({ ok: true, value: text });
  });

  it("64KiB + 1바이트는 두 청크로 나뉘어 순서대로 이어 붙는다", async () => {
    const { writer, read } = setup();
    const text = patterned(CAPACITY + 1);

    const reading = read();
    await writer.deliver(text);

    await expect(reading).resolves.toEqual({ ok: true, value: text });
  });

  it("세 청크 이상도 이어 붙는다", async () => {
    const { writer, read } = setup();
    const text = patterned(2 * CAPACITY + 10);

    const reading = read();
    await writer.deliver(text);

    await expect(reading).resolves.toEqual({ ok: true, value: text });
  });

  // 청크는 바이트 단위로 자르므로 UTF-8 시퀀스가 중간에서 갈릴 수 있다. 문자는 CAPACITY - split 바이트 위치에서 시작해
  // 첫 청크에 split 바이트만 든다.
  it.each([
    { label: "3바이트 문자(가) 1바이트째에서 갈림", char: "가", split: 1 },
    { label: "3바이트 문자(가) 2바이트째에서 갈림", char: "가", split: 2 },
    { label: "4바이트 문자(😀) 1바이트째에서 갈림", char: "😀", split: 1 },
    { label: "4바이트 문자(😀) 2바이트째에서 갈림", char: "😀", split: 2 },
    { label: "4바이트 문자(😀) 3바이트째에서 갈림", char: "😀", split: 3 },
  ])(
    "멀티바이트 문자가 청크 경계에 걸려도 온전히 복원된다: $label",
    async ({ char, split }) => {
      const { writer, read } = setup();
      const text = `${patterned(CAPACITY - split)}${char}끝`;

      const reading = read();
      await writer.deliver(text);

      await expect(reading).resolves.toEqual({ ok: true, value: text });
    },
  );
});

describe("취소", () => {
  it("cancel하면 wait()가 null을 돌려준다", async () => {
    const { writer, read } = setup();

    const reading = read();
    await writer.cancel();

    await expect(reading).resolves.toEqual({ ok: true, value: null });
  });

  it("취소 뒤 다음 읽기는 새 값을 정상적으로 받는다", async () => {
    const { writer, read } = setup();
    const cancelled = read();
    await writer.cancel();
    await cancelled;

    const next = read();
    await writer.deliver("다음 줄");

    await expect(next).resolves.toEqual({ ok: true, value: "다음 줄" });
  });
});

describe("오류", () => {
  it("fail하면 wait()가 그 메시지의 Error를 던진다", async () => {
    const { writer, read } = setup();

    const reading = read();
    await writer.fail("입력 장치 오류");

    await expect(reading).resolves.toEqual({
      ok: false,
      message: "입력 장치 오류",
    });
  });

  it("오류 뒤 다음 읽기는 새 값을 정상적으로 받는다", async () => {
    const { writer, read } = setup();
    const failed = read();
    await writer.fail("일시 오류");
    await failed;

    const next = read();
    await writer.deliver("복구");

    await expect(next).resolves.toEqual({ ok: true, value: "복구" });
  });

  // 메시지도 64KiB 고정 데이터 영역에 담긴다. 넘치면 문자 경계에서 잘라 깨진 문자가 남지 않게 한다.
  it("64KiB를 넘는 메시지는 온전한 문자까지만 잘라 전달한다", async () => {
    const { writer, read } = setup();

    const reading = read();
    await writer.fail("가".repeat(30_000));

    // "가"는 3바이트라 65536바이트에는 21845자(65535바이트)까지 든다.
    await expect(reading).resolves.toEqual({
      ok: false,
      message: "가".repeat(21_845),
    });
  });
});

// worker가 표식(취소·오류)을 가져가기 전에 main이 다음 값을 deliver하면 main은 STATE가 IDLE로 돌아오길 기다린다. worker가
// IDLE로 되돌릴 때 notify하지 않으면 그 대기는 영영 깨어나지 않는다. 여기서는 worker가 wait()에 들어가지 않은 채 표식이 쓰이고,
// 그 뒤에 worker가 두 번 읽는다.
describe("표식 직후의 deliver", () => {
  it.each([
    {
      label: "cancel",
      publish: (writer: ReturnType<typeof setup>["writer"]) => writer.cancel(),
      first: { ok: true, value: null },
    },
    {
      label: "fail",
      publish: (writer: ReturnType<typeof setup>["writer"]) =>
        writer.fail("오류"),
      first: { ok: false, message: "오류" },
    },
  ])(
    "worker가 가져가기 전에 deliver해도 멈추지 않는다: $label",
    async ({ publish, first }) => {
      const { writer, read } = setup();

      await publish(writer);
      const delivering = writer.deliver("다음 줄");
      const firstResult = await read();
      const secondResult = read();

      expect(firstResult).toEqual(first);
      await delivering;
      await expect(secondResult).resolves.toEqual({
        ok: true,
        value: "다음 줄",
      });
    },
  );
});

// main 쪽 `untilIdle()`은 `Atomics.waitAsync`로 기다리고, 없는 환경(Firefox 등)에서는 setTimeout(1ms) 폴링으로 기다린다.
// 어느 경로를 탔는지 결정적으로 보려고 worker가 wait()에 들어가기 전에 deliver를 먼저 시작한다: 첫 청크가 소비되지 않은 채라
// main은 두 번째 청크 앞에서 반드시 대기에 들어간다.
describe("IDLE 복귀 대기 방식", () => {
  type WaitAsync = (
    typedArray: Int32Array,
    index: number,
    value: number,
  ) => unknown;
  const atomics = Atomics as unknown as { waitAsync?: WaitAsync };

  /** 1ms 폴링 타이머 호출 수. */
  function watchPollTimers() {
    const spy = vi.spyOn(globalThis, "setTimeout");
    onTestFinished(() => spy.mockRestore());
    return () => spy.mock.calls.filter(([, delay]) => delay === 1).length;
  }

  /** main이 첫 청크를 쓰고 두 번째 청크 앞 대기에 들어갈 때까지 이벤트 루프를 돌린다. */
  const untilMainWaits = () =>
    new Promise<void>((resolve) => setImmediate(resolve));

  it("Atomics.waitAsync가 없으면 setTimeout(1ms) 폴링으로 기다려 2청크를 전달한다", async () => {
    const original = Object.getOwnPropertyDescriptor(Atomics, "waitAsync");
    Object.defineProperty(Atomics, "waitAsync", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    onTestFinished(() => {
      if (original) Object.defineProperty(Atomics, "waitAsync", original);
    });
    const pollTimers = watchPollTimers();
    const { writer, read } = setup();
    const text = patterned(CAPACITY + 1);

    const delivering = writer.deliver(text);
    await untilMainWaits();
    expect(pollTimers()).toBeGreaterThan(0);
    const reading = read();

    await delivering;
    await expect(reading).resolves.toEqual({ ok: true, value: text });
  });

  it("Atomics.waitAsync가 있으면 폴링하지 않고 그것으로 기다린다", async () => {
    expect(typeof atomics.waitAsync).toBe("function");
    const waitAsync = vi.spyOn(
      atomics as { waitAsync: WaitAsync },
      "waitAsync",
    );
    onTestFinished(() => waitAsync.mockRestore());
    const pollTimers = watchPollTimers();
    const { writer, read } = setup();
    const text = patterned(CAPACITY + 1);

    const delivering = writer.deliver(text);
    await untilMainWaits();
    expect(waitAsync).toHaveBeenCalled();
    const reading = read();

    await delivering;
    await expect(reading).resolves.toEqual({ ok: true, value: text });
    expect(pollTimers()).toBe(0);
  });
});
