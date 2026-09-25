/**
 * `./worker` 모듈 배선: `bridge()`가 coincident를 한 번만 부르고(같은 worker에서 여러 번 부르면 부트스트랩 상태가 새로 만들어져
 * 안전하지 않다), `ffi`를 노출하지 않으며, 모듈 평가 시점에 부트스트랩 관찰 리스너를 건다. `coincident/window/worker`는 가짜로
 * 바꾼다(실제 모듈은 평가 때 worker 전역의 message 리스너를 걸고 부트스트랩을 기다린다). 평가 시점 동작을 보려고 시험마다 모듈을
 * 새로 불러온다. jsdom의 `self`에는 worker 전역 표지가 없어 `WorkerGlobalScope`를 가짜로 세운다.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const fake = vi.hoisted(() => {
  const fakeWindow = { document: { title: "문서" }, parent: "부모" };
  return {
    fakeWindow,
    coincident: vi.fn(async () => ({
      proxy: { slow: () => 1 },
      native: true,
      window: fakeWindow,
      ffi: { evaluate: () => "위험" },
      transfer: () => [],
      isWindowProxy: () => false,
    })),
  };
});

vi.mock("coincident/window/worker", () => ({ default: fake.coincident }));

/** 모듈이 건 message 리스너. 시험이 끝나면 전역에서 치워 다음 시험으로 새지 않게 한다. */
const registered: Array<{ listener: EventListener; capture: boolean }> = [];

function pretendWorkerScope() {
  vi.stubGlobal(
    "WorkerGlobalScope",
    class {
      static [Symbol.hasInstance]() {
        return true;
      }
    },
  );
}

async function evaluateModule() {
  vi.resetModules();
  return import("./worker");
}

beforeEach(() => {
  fake.coincident.mockClear();
  const add = self.addEventListener.bind(self) as typeof self.addEventListener;
  vi.spyOn(self, "addEventListener").mockImplementation(
    (type: string, listener: unknown, options?: unknown) => {
      if (type === "message")
        registered.push({
          listener: listener as EventListener,
          capture:
            options === true ||
            (typeof options === "object" &&
              options !== null &&
              (options as AddEventListenerOptions).capture === true),
        });
      add(type, listener as EventListener, options as AddEventListenerOptions);
    },
  );
});

afterEach(() => {
  for (const { listener, capture } of registered.splice(0))
    self.removeEventListener("message", listener, capture);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("bridge()", () => {
  test("여러 번 불러도 coincident는 한 번만 호출되고 같은 결과를 돌려준다", async () => {
    const { bridge } = await evaluateModule();

    const [a, b] = await Promise.all([bridge(), bridge()]);
    const c = await bridge();

    expect(fake.coincident).toHaveBeenCalledTimes(1);
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  test("coincident는 옵션 없이 부른다(serviceWorker 등을 통과시키지 않는다)", async () => {
    const { bridge } = await evaluateModule();

    await bridge();

    expect(fake.coincident).toHaveBeenCalledWith();
  });

  test("proxy·window·native만 노출하고 ffi 등 나머지는 노출하지 않는다", async () => {
    const { bridge } = await evaluateModule();

    const result = await bridge();

    expect(Object.keys(result).sort()).toEqual(["native", "proxy", "window"]);
    expect(result.native).toBe(true);
    expect(result.window).toBe(fake.fakeWindow);
  });

  test("모듈을 불러오는 것만으로는 coincident를 호출하지 않는다", async () => {
    await evaluateModule();

    expect(fake.coincident).not.toHaveBeenCalled();
  });
});

describe("domBridge()", () => {
  test("이름이 dom-bridge인 플러그인을 돌려준다", async () => {
    const { domBridge } = await evaluateModule();

    expect(domBridge().name).toBe("dom-bridge");
  });
});

describe("모듈 평가 시점 부트스트랩 관찰(worker 전역)", () => {
  test("모듈을 평가하면 캡처 단계 message 리스너가 걸린다", async () => {
    pretendWorkerScope();

    await evaluateModule();

    expect(registered.filter((entry) => entry.capture)).toHaveLength(1);
  });

  test("worker 전역이 아니면 모듈을 평가해도 리스너를 걸지 않는다(시험이 남의 전역을 오염하지 않는다)", async () => {
    await evaluateModule();

    expect(registered).toEqual([]);
  });

  test("부트스트랩(배열) 없이 prepare하면 첫 정적 import 위반 오류, 받은 뒤에는 통과한다", async () => {
    pretendWorkerScope();
    const { domBridge } = await evaluateModule();
    const registerJsModule = vi.fn();
    const pyodide = { registerJsModule } as never;

    await expect(domBridge().prepare({ pyodide })).rejects.toThrow(
      "첫 정적 import",
    );
    expect(fake.coincident).not.toHaveBeenCalled();

    self.dispatchEvent(
      new MessageEvent("message", { data: ["uid", false, -1] }),
    );
    await domBridge().prepare({ pyodide });

    expect(registerJsModule).toHaveBeenCalledTimes(1);
  });

  test("core init 프레임(객체)만 받은 상태는 부트스트랩 수신이 아니다", async () => {
    pretendWorkerScope();
    const { domBridge } = await evaluateModule();

    self.dispatchEvent(new MessageEvent("message", { data: { kind: "init" } }));

    await expect(
      domBridge().prepare({ pyodide: { registerJsModule() {} } as never }),
    ).rejects.toThrow("첫 정적 import");
  });
});
