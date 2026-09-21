/**
 * worker 진입점 `runReplWorker()` 시험.
 * main이 worker 생성 직후 보내는 첫 메시지(초기화 프레임)를 검증해 부팅 시퀀스(`bootReplWorker`)를 시작하는지 확인한다.
 * 부팅 시퀀스 자체(pyodide 로드·ready·배너)는 worker/boot.test.ts가 보므로 여기서는 mock으로 막는다.
 * 프레임을 놓치지 않으려면 호출 즉시(첫 await 이전) 리스너가 걸려 있어야 한다(01-protocols.md 4절).
 */
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createInterruptBuffer } from "./protocol/interrupt-protocol";
import { createStdinMailbox } from "./protocol/stdin-mailbox";
import { runReplWorker } from "./worker";
import { bootReplWorker } from "./worker/boot";

vi.mock("./worker/boot", () => ({ bootReplWorker: vi.fn(async () => {}) }));

/** worker 전역(jsdom에서는 window)에 main이 보낸 것과 같은 message 이벤트를 던진다. */
function receive(data: unknown) {
  self.dispatchEvent(new MessageEvent("message", { data }));
}

/** main이 보내는 것과 같은 모양의 올바른 초기화 프레임. */
function createInitFrame() {
  const { port1, port2 } = new MessageChannel();
  ports.push(port1, port2);
  const mailbox = createStdinMailbox();
  return {
    kind: "init",
    rpcPort: port1,
    interruptBuffer: createInterruptBuffer(),
    stdinCtrl: mailbox.ctrl,
    stdinData: mailbox.data,
    topLevelAwait: false,
    pyodide: { indexURL: "https://cdn.jsdelivr.net/pyodide/v314.0.7/full/" },
  };
}

const ports: MessagePort[] = [];

beforeEach(() => {
  vi.mocked(bootReplWorker).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const port of ports.splice(0)) port.close();
});

test("올바른 프레임이면 console.error 없이 부팅을 시작한다", () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  runReplWorker();
  const initFrame = createInitFrame();

  receive(initFrame);

  expect(error).not.toHaveBeenCalled();
  expect(bootReplWorker).toHaveBeenCalledTimes(1);
  // toContain·toEqual은 MessagePort의 순환 내부 참조를 따라가다 스택이 넘친다. 같은 객체인지만 본다.
  const [frame, deps] = vi.mocked(bootReplWorker).mock.calls[0] ?? [];
  expect(frame === initFrame).toBe(true);
  expect(typeof deps?.loadPyodide).toBe("function");
});

test("첫 메시지의 kind가 init이 아니면 console.error로 알리고 부팅하지 않는다", () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  runReplWorker();

  receive({ kind: "other" });

  expect(error).toHaveBeenCalledTimes(1);
  expect(bootReplWorker).not.toHaveBeenCalled();
});

test("첫 메시지만 처리하고 이후 네이티브 message는 무시한다", () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  runReplWorker();
  const initFrame = createInitFrame();

  receive(initFrame);
  receive(initFrame);
  receive({ kind: "other" });

  expect(bootReplWorker).toHaveBeenCalledTimes(1);
  expect(error).not.toHaveBeenCalled();
});

// kind만 보고 통과시키면 필드가 빠진 프레임이 뒤 단계(pyodide 로드, 메일박스 대기)에서 원인을 알 수 없는 오류로 터진다.
test("kind는 init이지만 필드가 빠진 프레임은 필드 이름을 담아 console.error로 알리고 부팅하지 않는다", () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  runReplWorker();
  const frame: Record<string, unknown> = createInitFrame();
  delete frame.interruptBuffer;

  receive(frame);

  expect(bootReplWorker).not.toHaveBeenCalled();
  expect(error).toHaveBeenCalledTimes(1);
  expect(String(error.mock.calls[0])).toContain("interruptBuffer");
});
