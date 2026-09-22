// @vitest-environment node
/**
 * Ctrl+C 연결(`connectInterrupts`) 시험(03-ctrl-c.md 2.6, TRP-027). 순서 — SIGINT 핸들러 설치 → 남은 SIGINT 폐기 →
 * interrupt buffer 연결 — 이 부팅 중 눌림으로부터 시작 코드를 지킨다. 폴링은 버퍼를 연결한 뒤에야 시작하므로 연결이
 * 먼저이면 그 사이에 쓴 눌림을 pyodide 기본 핸들러가 받아 시작 코드가 `KeyboardInterrupt`로 죽는다.
 * 실제 pyodide(node)를 mock 없이 쓴다. `setInterruptBuffer`는 폴링이 시작되는 순간을 만들려고 원본 호출 직전에 훅을
 * 끼워 감쌀 뿐 원본을 그대로 부른다.
 */
import { loadPyodide, type PyodideInterface } from "pyodide";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import {
  ACK,
  SIGNAL,
  acknowledgeInterrupt,
  createInterruptBuffer,
  discardPendingInterrupt,
  readRequestSeq,
  signalInterrupt,
} from "../protocol/interrupt-protocol";
import { createConsole } from "./console";
import { connectInterrupts } from "./interrupt-buffer";

let pyodide: PyodideInterface;

beforeAll(async () => {
  pyodide = await loadPyodide();
}, 60_000);

/** 이 시험이 연결한 버퍼. `afterEach`가 떼고 비운다. */
let connected: Int32Array | undefined;

afterEach(() => {
  // 스파이를 먼저 풀어 원본으로 버퍼를 뗀다. 남은 SIGINT가 다음 시험의 실행을 끊지 않도록 비우고 핸들러를 기본으로 되돌린다.
  vi.restoreAllMocks();
  pyodide.setInterruptBuffer(
    undefined as unknown as Parameters<
      PyodideInterface["setInterruptBuffer"]
    >[0],
  );
  if (connected) discardPendingInterrupt(connected);
  connected = undefined;
  pyodide.runPython(
    "import signal\nsignal.signal(signal.SIGINT, signal.default_int_handler)",
  );
});

/** 폴링이 여러 번 일어나는 짧은 바쁜 루프(약 25ms). 폴링이 대기 중인 SIGINT를 읽으면 핸들러가 돈다. */
const BUSY = "for _ in range(10**6): pass";

/** 새 콘솔·새 버퍼와 `boot.ts`가 넣는 세 클로저. `discard`는 호출 순서를 보려고 `vi.fn`으로 감싼다. */
function setup() {
  const { pyconsole } = createConsole(
    pyodide,
    { write: () => {}, writeErrorRaw: () => {} },
    { topLevelAwait: false },
  );
  const buffer = createInterruptBuffer();
  connected = buffer;
  const discard = vi.fn(() => discardPendingInterrupt(buffer));
  const deps = {
    ack: () => acknowledgeInterrupt(buffer),
    seq: () => readRequestSeq(buffer),
    discard,
  };
  return { pyconsole, buffer, deps, discard };
}

/** 원본 `setInterruptBuffer`를 부르기 직전에 `hook`을 실행한다. 폴링이 시작되는 순간에 무슨 일이 일어나는지를 만든다. */
function beforeConnect(hook: () => void) {
  const original = pyodide.setInterruptBuffer.bind(pyodide);
  return vi
    .spyOn(pyodide, "setInterruptBuffer")
    .mockImplementation((buffer) => {
      hook();
      original(buffer);
    });
}

describe("connectInterrupts", () => {
  test("폴링이 시작될 때 SIGINT 핸들러가 이미 설치돼 있다", () => {
    const { pyconsole, buffer, deps } = setup();
    let handlerAtConnect: unknown;
    beforeConnect(() => {
      handlerAtConnect = pyodide.runPython(
        "import signal\nsignal.getsignal(signal.SIGINT).__name__",
      );
    });

    connectInterrupts(pyodide, pyconsole, buffer, deps);

    expect(handlerAtConnect).toBe("sigint_handler");
  });

  test("폴링이 시작되는 순간 쓰인 눌림을 핸들러가 받아 버리고 시작 코드가 죽지 않는다", () => {
    const { pyconsole, buffer, deps } = setup();
    beforeConnect(() => signalInterrupt(buffer));

    connectInterrupts(pyodide, pyconsole, buffer, deps);
    // 연결 직후 도는 Python 실행이 그 눌림을 폴링으로 읽는다. 사용자 프레임(`<console>`)이 없어 핸들러가 버린다.
    expect(() => pyodide.runPython(BUSY)).not.toThrow();

    expect(Atomics.load(buffer, ACK)).toBe(1);
    expect(Atomics.load(buffer, SIGNAL)).toBe(0);
  });

  test("연결 전에 쓰인 SIGINT는 지우고 ack한다", () => {
    const { pyconsole, buffer, deps } = setup();
    signalInterrupt(buffer);

    connectInterrupts(pyodide, pyconsole, buffer, deps);

    // 실행 전에 슬롯을 본다: 폴링이 아니라 연결 절차가 지운 것이어야 한다. [SIGNAL, ACK, SEQ, 예약]
    expect([...buffer]).toEqual([0, 1, 1, 0]);
    expect(() => pyodide.runPython(BUSY)).not.toThrow();
    expect(Atomics.load(buffer, ACK)).toBe(1);
  });

  test("연결 전에 눌림이 없으면 ack는 그대로다", () => {
    const { pyconsole, buffer, deps } = setup();

    connectInterrupts(pyodide, pyconsole, buffer, deps);

    expect([...buffer]).toEqual([0, 0, 0, 0]);
  });

  test("폐기가 버퍼 연결보다 먼저다", () => {
    const { pyconsole, buffer, deps, discard } = setup();
    const setInterruptBuffer = vi.spyOn(pyodide, "setInterruptBuffer");

    connectInterrupts(pyodide, pyconsole, buffer, deps);

    expect(setInterruptBuffer).toHaveBeenCalledWith(buffer);
    // 폴링이 시작된 뒤에 지우면 폴링이 ack 없이 SIGNAL을 지울 수 있다(TRP-027).
    expect(discard.mock.invocationCallOrder[0]).toBeLessThan(
      setInterruptBuffer.mock.invocationCallOrder[0]!,
    );
  });
});
