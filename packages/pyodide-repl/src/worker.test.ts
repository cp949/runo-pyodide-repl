/**
 * worker 진입점 `runReplWorker()` 시험.
 * main이 worker 생성 직후 보내는 첫 메시지(초기화 프레임)를 받아 console.log로 에코하는지 확인한다.
 * 프레임을 놓치지 않으려면 호출 즉시(첫 await 이전) 리스너가 걸려 있어야 한다(01-protocols.md 4절).
 */
import { afterEach, expect, test, vi } from "vitest";
import { runReplWorker } from "./worker";

/** worker 전역(jsdom에서는 window)에 main이 보낸 것과 같은 message 이벤트를 던진다. */
function receive(data: unknown) {
  self.dispatchEvent(new MessageEvent("message", { data }));
}

const initFrame = {
  kind: "init",
  topLevelAwait: false,
  pyodide: { indexURL: "https://cdn.jsdelivr.net/pyodide/v314.0.7/full/" },
};

afterEach(() => {
  vi.restoreAllMocks();
});

test("호출 직후 도착한 초기화 프레임을 console.log로 에코한다", () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  runReplWorker();

  receive(initFrame);

  expect(log).toHaveBeenCalledTimes(1);
  expect(log.mock.calls[0]).toContain(initFrame);
});

test("첫 메시지의 kind가 init이 아니면 console.error로 알리고 에코하지 않는다", () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  runReplWorker();

  receive({ kind: "other" });

  expect(error).toHaveBeenCalledTimes(1);
  expect(log).not.toHaveBeenCalled();
});

test("첫 메시지만 처리하고 이후 네이티브 message는 무시한다", () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  runReplWorker();

  receive(initFrame);
  receive(initFrame);
  receive({ kind: "other" });

  expect(log).toHaveBeenCalledTimes(1);
  expect(error).not.toHaveBeenCalled();
});
