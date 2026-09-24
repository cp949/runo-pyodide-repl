/**
 * `<PythonRunner>` 시험(jsdom + React). 실제 `createTerminalRunner`·실제 `@xterm/xterm`·실제 `FitAddon`을 쓰고 worker만 가짜다
 * (`test-utils/fake-worker.ts`). StrictMode 이중 마운트에서 살아 있는 worker·`.xterm` 1개, 언마운트 정리, 정리 순서(14.5.5:
 * runner → fit → terminal), 콜백 latest-ref, `copyOnSelect` 반응형, fit(크기 0 건너뜀·rAF 합침), ref handle 위임 규칙을 본다.
 */
import type {
  TerminalRunnerHandle,
  TerminalRunnerOptions,
} from "@cp949/runo-pyodide-terminal";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { StrictMode, act, useEffect, useRef, type Ref } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  test,
  vi,
} from "vitest";
import { PythonRunner } from "./index";
import type {
  PythonRunnerHandle,
  PythonRunnerProps,
  RunnerStatus,
} from "./index";
import {
  createFakeWorkerFactory,
  type FakeWorkerFactory,
} from "./test-utils/fake-worker";
import {
  FakeResizeObserver,
  enableActEnvironment,
  installFakeRaf,
  until,
  type FakeRaf,
} from "./test-utils/harness";

enableActEnvironment();

const HOST_ID = "runner-host";

let factory: FakeWorkerFactory;
let container: HTMLElement;
let root: Root | undefined;
let openSpy: ReturnType<typeof vi.spyOn>;
let disposeSpy: ReturnType<typeof vi.spyOn>;
/** spy를 걸기 전의 원본 `Terminal.prototype.dispose`. */
const originalDispose = Terminal.prototype.dispose;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // jsdom에는 `crossOriginIsolated`가 없다. worker를 만드는 경로는 격리를 전제한다.
  vi.stubGlobal("crossOriginIsolated", true);
  factory = createFakeWorkerFactory();
  container = document.createElement("div");
  document.body.append(container);
  // 호출은 그대로 통과시키고 횟수·`this`(Terminal 인스턴스)만 기록한다.
  openSpy = vi.spyOn(Terminal.prototype, "open");
  disposeSpy = vi.spyOn(Terminal.prototype, "dispose");
  warnSpy = vi.spyOn(console, "warn");
});

afterEach(async () => {
  await unmount();
  container.remove();
  factory.dispose();
  FakeResizeObserver.instances = [];
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "clipboard");
});

async function unmount(): Promise<void> {
  if (!root) return;
  const mounted = root;
  root = undefined;
  await act(async () => mounted.unmount());
}

interface Probe {
  ref: { current: PythonRunnerHandle | null };
  rerender(next: PythonRunnerProps): void;
  /** 컴포넌트가 그린 컨테이너 div. */
  host(): HTMLElement;
  /** 가장 최근에 open된 Terminal. */
  terminal(): Terminal;
}

function mount(
  initial: Partial<PythonRunnerProps> = {},
  { strict = false }: { strict?: boolean } = {},
): Probe {
  let current: PythonRunnerProps = props(initial);
  const ref: Probe["ref"] = { current: null };
  const element = () => {
    const app = (
      <PythonRunner
        {...current}
        ref={ref as unknown as Ref<PythonRunnerHandle>}
      />
    );
    return strict ? <StrictMode>{app}</StrictMode> : app;
  };
  root = createRoot(container);
  act(() => root!.render(element()));
  return {
    ref,
    rerender(next) {
      current = next;
      act(() => root!.render(element()));
    },
    host: () =>
      container.querySelector<HTMLElement>(`[data-testid="${HOST_ID}"]`)!,
    terminal: () => openSpy.mock.contexts.at(-1) as Terminal,
  };
}

function props(overrides: Partial<PythonRunnerProps> = {}): PythonRunnerProps {
  return {
    createWorker: factory.createWorker,
    "data-testid": HOST_ID,
    ...overrides,
  } as PythonRunnerProps;
}

/** worker `ready`를 보내 상태를 `ready`로 만든다. */
async function becomeReady(probe: Probe, index = 0): Promise<void> {
  factory.workers[index]!.ready();
  await until(() => probe.ref.current?.status === "ready");
}

/** 터미널에 쓴 글이 화면 버퍼에 반영될 때까지 기다린다(xterm write는 비동기 파싱). */
async function screenText(terminal: Terminal): Promise<string> {
  await new Promise<void>((resolve) => terminal.write("", resolve));
  const lines: string[] = [];
  const buffer = terminal.buffer.active;
  for (let y = 0; y < buffer.length; y += 1) {
    lines.push(buffer.getLine(y)?.translateToString(true) ?? "");
  }
  return lines.join("\n");
}

describe("PythonRunner: xterm·worker 수명", () => {
  test("StrictMode 이중 마운트 뒤 살아 있는 worker와 .xterm은 1개다(worker 생성 2·terminate 1)", () => {
    mount({}, { strict: true });
    expect(factory.workers).toHaveLength(2);
    expect(factory.live()).toBe(1);
    expect(factory.workers[0]!.terminated()).toBe(true);
    expect(factory.workers[1]!.terminated()).toBe(false);
    expect(openSpy).toHaveBeenCalledTimes(2);
    expect(disposeSpy).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll(".xterm")).toHaveLength(1);
  });

  test("StrictMode 없이는 worker 1개와 Terminal 1개를 만든다", () => {
    mount();
    expect(factory.workers).toHaveLength(1);
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll(".xterm")).toHaveLength(1);
  });

  test("언마운트하면 worker 0개이고 Terminal을 dispose하며 .xterm이 사라진다", async () => {
    mount({}, { strict: true });
    await unmount();
    expect(factory.live()).toBe(0);
    expect(factory.workers).toHaveLength(2);
    expect(disposeSpy).toHaveBeenCalledTimes(2);
    expect(container.querySelectorAll(".xterm")).toHaveLength(0);
  });

  test("인라인 람다 콜백으로 재렌더해도 worker·Terminal을 다시 만들지 않는다", () => {
    const probe = mount({
      onOutput: () => {},
      onStatus: () => {},
      onCrash: () => {},
      onCopy: () => {},
    });
    for (let i = 0; i < 2; i += 1) {
      probe.rerender(
        props({
          onOutput: () => {},
          onStatus: () => {},
          onCrash: () => {},
          onCopy: () => {},
        }),
      );
    }
    expect(factory.workers).toHaveLength(1);
    expect(factory.workers[0]!.terminated()).toBe(false);
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(disposeSpy).not.toHaveBeenCalled();
  });

  test("생성 옵션(createWorker·terminalOptions·fit·filename·clearOnRun)을 바꿔 재렌더해도 마운트 때 것을 유지한다", () => {
    const probe = mount({ terminalOptions: { cols: 100, rows: 10 } });
    const replaced = vi.fn(factory.createWorker);
    probe.rerender(
      props({
        createWorker: replaced,
        terminalOptions: { cols: 50, rows: 5 },
        fit: false,
        filename: "other.py",
        clearOnRun: true,
      }),
    );
    expect(replaced).not.toHaveBeenCalled();
    expect(factory.workers).toHaveLength(1);
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(probe.terminal().cols).toBe(100);
    expect(probe.terminal().rows).toBe(10);
  });

  test("indexURL·filename·topLevelAwait를 core에 넘긴다", () => {
    mount({
      indexURL: "https://cdn.example/pyodide/",
      filename: "app.py",
      topLevelAwait: true,
    });
    const frame = factory.workers[0]!.init()!;
    expect(frame.pyodide.indexURL).toBe("https://cdn.example/pyodide/");
    expect(frame.driver).toMatchObject({
      filename: "app.py",
      topLevelAwait: true,
    });
  });

  test("clearOnRun을 core에 넘긴다(true면 run 시작 때 화면을 지운다, 기본은 지우지 않는다)", async () => {
    const cleared = mount({ clearOnRun: true });
    await becomeReady(cleared);
    factory.workers[0]!.write("old-output");
    await expect
      .poll(() => screenText(cleared.terminal()))
      .toContain("old-output");
    cleared.ref.current!.run("1").catch(() => {});
    await expect
      .poll(() => screenText(cleared.terminal()))
      .not.toContain("old-output");
    await unmount();

    const kept = mount();
    await becomeReady(kept, 1);
    factory.workers[1]!.write("old-output");
    await expect
      .poll(() => screenText(kept.terminal()))
      .toContain("old-output");
    kept.ref.current!.run("1").catch(() => {});
    await until(() => factory.workers[1]!.pending.length === 1);
    expect(await screenText(kept.terminal())).toContain("old-output");
  });

  test("정리 순서는 runner 먼저 terminal 나중이다(terminal이 dispose될 때 worker는 이미 terminate됐다)", async () => {
    const liveWhenTerminalDisposed: number[] = [];
    disposeSpy.mockImplementation(function (this: Terminal) {
      liveWhenTerminalDisposed.push(factory.live());
      return originalDispose.call(this);
    });
    mount({}, { strict: true });
    await unmount();
    expect(liveWhenTerminalDisposed).toEqual([0, 0]);
    // TRP-004 일반 가드: 정리 중 xterm의 해제된 저장소 경고가 없다. 순서를 뒤집어도 이 경고는 나지 않는다(위 순서 단언이 순서를 잡는다).
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test("terminalOptions를 Terminal에 넘기고 나머지 div 속성·className·style을 컨테이너에 준다", () => {
    const probe = mount({
      terminalOptions: { cols: 100, rows: 10 },
      className: "runner-box",
      style: { height: 240 },
      id: "runner-1",
    });
    expect(probe.terminal().cols).toBe(100);
    expect(probe.terminal().rows).toBe(10);
    const host = probe.host();
    expect(host.className).toBe("runner-box");
    expect(host.style.height).toBe("240px");
    expect(host.id).toBe("runner-1");
    expect(host.querySelector(".xterm")).not.toBeNull();
  });
});

describe("PythonRunner: 출력·콜백 latest-ref", () => {
  test("worker 출력이 xterm 화면에 그려진다", async () => {
    const probe = mount();
    await becomeReady(probe);
    factory.workers[0]!.write("hello-screen");
    await expect
      .poll(() => screenText(probe.terminal()))
      .toContain("hello-screen");
  });

  test("재렌더로 바꾼 onOutput·onStatus가 다음 통지부터 불리고 옛 함수는 불리지 않는다", async () => {
    const outputFirst = vi.fn();
    const outputSecond = vi.fn();
    const statusFirst = vi.fn();
    const statusSecond = vi.fn();
    const probe = mount({ onOutput: outputFirst, onStatus: statusFirst });
    expect(statusFirst).toHaveBeenCalledWith("loading");
    probe.rerender(props({ onOutput: outputSecond, onStatus: statusSecond }));
    await becomeReady(probe);
    expect(statusSecond).toHaveBeenCalledWith("ready");
    expect(statusFirst).not.toHaveBeenCalledWith("ready");
    factory.workers[0]!.write("x");
    await until(() => outputSecond.mock.calls.length === 1);
    expect(outputSecond).toHaveBeenCalledWith({ stream: "stdout", text: "x" });
    expect(outputFirst).not.toHaveBeenCalled();
  });

  test("마운트 때 준 inputProvider는 재렌더로 바꾼 최신 함수가 다음 입력 읽기를 받는다", async () => {
    const first = vi.fn(async () => "one");
    const second = vi.fn(async () => "two");
    const probe = mount({ inputProvider: first });
    await becomeReady(probe);
    probe.rerender(props({ inputProvider: second }));
    probe.ref.current!.run("input()").catch(() => {});
    await until(() => factory.workers[0]!.pending.length === 1);
    factory.workers[0]!.readInput();
    await until(() => second.mock.calls.length === 1);
    expect(first).not.toHaveBeenCalled();
  });

  test("inputProvider 없이 마운트하면 xterm에서 한 줄을 읽는다(공급자가 null을 돌려 읽기를 끝내지 않는다)", async () => {
    const probe = mount();
    await becomeReady(probe);
    probe.ref.current!.run("input()").catch(() => {});
    await until(() => factory.workers[0]!.pending.length === 1);
    factory.workers[0]!.readInput();
    // 읽기가 열리면 키 입력이 화면에 에코된다. 열리기 전 입력은 버려지므로 나타날 때까지 계속 보낸다.
    await expect
      .poll(async () => {
        act(() => probe.terminal().input("q"));
        return screenText(probe.terminal());
      })
      .toContain("q");
  });

  test("재렌더로 바꾼 onCrash가 크래시 통지를 받는다", () => {
    const first = vi.fn();
    const second = vi.fn();
    const probe = mount({ onCrash: first });
    probe.rerender(props({ onCrash: second }));
    act(() => factory.workers[0]!.dispatchError("boom"));
    expect(second).toHaveBeenCalledWith("boom");
    expect(first).not.toHaveBeenCalled();
  });
});

describe("PythonRunner: copyOnSelect 반응형", () => {
  /** 화면에 글을 쓰고 마우스로 드래그 선택했다가 놓는 동작을 흉내 낸다. */
  async function dragSelect(probe: Probe): Promise<void> {
    const terminal = probe.terminal();
    await new Promise<void>((resolve) => terminal.write("copy-me", resolve));
    terminal.select(0, 0, 7);
    terminal.element!.dispatchEvent(new MouseEvent("mousedown", { button: 0 }));
    document.dispatchEvent(new MouseEvent("mouseup"));
  }

  function stubClipboard(): ReturnType<typeof vi.fn> {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    return writeText;
  }

  test("prop을 토글하면 재마운트 없이 자동 복사가 켜지고 꺼진다", async () => {
    const writeText = stubClipboard();
    const onCopy = vi.fn();
    const probe = mount({ copyOnSelect: false, onCopy });
    await dragSelect(probe);
    expect(writeText).not.toHaveBeenCalled();

    probe.rerender(props({ copyOnSelect: true, onCopy }));
    await dragSelect(probe);
    await until(() => onCopy.mock.calls.length === 1);
    expect(writeText).toHaveBeenCalledWith("copy-me");
    expect(onCopy).toHaveBeenCalledWith({ ok: true, chars: 7 });

    probe.rerender(props({ copyOnSelect: false, onCopy }));
    await dragSelect(probe);
    expect(writeText).toHaveBeenCalledTimes(1);
    // 토글은 재마운트를 일으키지 않는다.
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(factory.workers).toHaveLength(1);
  });

  test("handle.setCopyOnSelect()로도 자동 복사를 바꾼다", async () => {
    const writeText = stubClipboard();
    const onCopy = vi.fn();
    const probe = mount({ copyOnSelect: false, onCopy });
    act(() => probe.ref.current!.setCopyOnSelect(true));
    await dragSelect(probe);
    await until(() => onCopy.mock.calls.length === 1);
    expect(writeText).toHaveBeenCalledWith("copy-me");
  });

  test("기본값은 자동 복사이고 재렌더로 바꾼 onCopy가 결과를 받는다", async () => {
    stubClipboard();
    const first = vi.fn();
    const second = vi.fn();
    const probe = mount({ onCopy: first });
    probe.rerender(props({ onCopy: second }));
    await dragSelect(probe);
    await until(() => second.mock.calls.length === 1);
    expect(first).not.toHaveBeenCalled();
  });
});

describe("PythonRunner: fit", () => {
  let raf: FakeRaf;
  let fitSpy: ReturnType<typeof vi.spyOn>;
  let activateSpy: ReturnType<typeof vi.spyOn>;
  let hostSize = { width: 0, height: 0 };

  beforeEach(() => {
    FakeResizeObserver.instances = [];
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    raf = installFakeRaf((name, value) => vi.stubGlobal(name, value));
    fitSpy = vi.spyOn(FitAddon.prototype, "fit").mockImplementation(() => {});
    activateSpy = vi.spyOn(FitAddon.prototype, "activate");
    hostSize = { width: 0, height: 0 };
    // 실제 레이아웃이 없으므로 컨테이너 div의 크기만 시험이 정한다(다른 요소는 0).
    const sizeOf = (element: Element, axis: "width" | "height") =>
      (element as HTMLElement).dataset.testid === HOST_ID ? hostSize[axis] : 0;
    vi.spyOn(Element.prototype, "clientWidth", "get").mockImplementation(
      function (this: Element) {
        return sizeOf(this, "width");
      },
    );
    vi.spyOn(Element.prototype, "clientHeight", "get").mockImplementation(
      function (this: Element) {
        return sizeOf(this, "height");
      },
    );
  });

  /** 마운트하고 xterm 자체가 예약한 rAF를 비워 이후 `raf.pending()`이 fit 것만 세게 한다. */
  function mountFit(
    initial: Partial<PythonRunnerProps> = {},
    mountOptions: { strict?: boolean } = {},
  ): Probe {
    const probe = mount(initial, mountOptions);
    raf.flush();
    return probe;
  }

  /** 컨테이너를 관찰하는 observer. xterm 내부 것이 섞이지 않게 대상으로 거른다. */
  function hostObservers(probe: Probe): FakeResizeObserver[] {
    return FakeResizeObserver.instances.filter((observer) =>
      observer.targets.includes(probe.host()),
    );
  }

  test("기본값(fit 생략)은 FitAddon을 붙이고 컨테이너에 ResizeObserver를 건다", () => {
    const probe = mountFit();
    expect(activateSpy).toHaveBeenCalledTimes(1);
    expect(hostObservers(probe)).toHaveLength(1);
  });

  test("fit={false}이면 FitAddon도 ResizeObserver도 만들지 않는다", () => {
    const probe = mountFit({ fit: false });
    expect(activateSpy).not.toHaveBeenCalled();
    expect(hostObservers(probe)).toHaveLength(0);
    expect(FakeResizeObserver.instances).toHaveLength(0);
    expect(fitSpy).not.toHaveBeenCalled();
  });

  test("컨테이너 크기가 0이면 마운트 직후·리사이즈 통지 뒤에도 fit()을 부르지 않는다", () => {
    const probe = mountFit();
    expect(fitSpy).not.toHaveBeenCalled();
    hostObservers(probe)[0]!.trigger();
    raf.flush();
    expect(fitSpy).not.toHaveBeenCalled();
  });

  test("가로만 0이거나 세로만 0이어도 건너뛴다", () => {
    const probe = mountFit();
    hostSize = { width: 300, height: 0 };
    hostObservers(probe)[0]!.trigger();
    raf.flush();
    hostSize = { width: 0, height: 200 };
    hostObservers(probe)[0]!.trigger();
    raf.flush();
    expect(fitSpy).not.toHaveBeenCalled();
  });

  test("크기가 있으면 마운트 직후 fit()을 한 번 부른다", () => {
    hostSize = { width: 400, height: 300 };
    mount();
    expect(fitSpy).toHaveBeenCalledTimes(1);
  });

  test("연속 통지 3번은 rAF 한 번의 fit()으로 합쳐진다", () => {
    const probe = mountFit();
    hostSize = { width: 400, height: 300 };
    const observer = hostObservers(probe)[0]!;
    observer.trigger();
    observer.trigger();
    observer.trigger();
    expect(raf.pending()).toBe(1);
    expect(fitSpy).not.toHaveBeenCalled();
    raf.flush();
    expect(fitSpy).toHaveBeenCalledTimes(1);
    // 합쳐진 뒤 다음 통지는 새 rAF를 예약한다.
    observer.trigger();
    expect(raf.pending()).toBe(1);
    raf.flush();
    expect(fitSpy).toHaveBeenCalledTimes(2);
  });

  test("언마운트하면 observer를 끊고 예약된 rAF를 취소해 이후 fit()이 없다", async () => {
    const probe = mountFit();
    hostSize = { width: 400, height: 300 };
    const observer = hostObservers(probe)[0]!;
    observer.trigger();
    expect(raf.pending()).toBe(1);
    await unmount();
    expect(observer.disconnected).toBe(true);
    expect(raf.pending()).toBe(0);
    raf.flush();
    expect(fitSpy).not.toHaveBeenCalled();
  });

  test("StrictMode에서는 observer 2개를 만들고 첫 것만 끊는다", () => {
    const probe = mount({}, { strict: true });
    const observers = hostObservers(probe);
    // 첫 마운트의 컨테이너 div는 같은 DOM 노드다(React가 재사용). 관찰 대상 기준으로 두 번 걸렸다.
    expect(observers).toHaveLength(2);
    expect(observers[0]!.disconnected).toBe(true);
    expect(observers[1]!.disconnected).toBe(false);
  });

  test("ResizeObserver가 없는 환경에서도 던지지 않는다", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    expect(() => mount()).not.toThrow();
    expect(activateSpy).toHaveBeenCalledTimes(1);
  });
});

describe("PythonRunner: ref handle", () => {
  test("handle 객체는 StrictMode 재마운트에서도 같은 객체다", () => {
    const seen = new Set<PythonRunnerHandle>();
    let current: PythonRunnerHandle | null = null;
    const ref = (handle: PythonRunnerHandle | null) => {
      if (handle) seen.add(handle);
      current = handle;
    };
    root = createRoot(container);
    act(() =>
      root!.render(
        <StrictMode>
          <PythonRunner createWorker={factory.createWorker} ref={ref} />
        </StrictMode>,
      ),
    );
    expect(current).not.toBeNull();
    expect(seen.size).toBe(1);
  });

  test("ref가 붙는 시점(runner 생성 전)에는 run reject disposed·stop idle이고 status는 첫 상태 규칙이다", async () => {
    for (const [isolated, expected] of [
      [true, "loading"],
      [false, "not-isolated"],
    ] as const) {
      vi.stubGlobal("crossOriginIsolated", isolated);
      const seen: {
        status: RunnerStatus;
        run: Promise<unknown>;
        stop: Promise<unknown>;
      }[] = [];
      // 콜백 ref는 레이아웃 단계에 불려 passive effect의 runner 생성보다 먼저다.
      const ref = (handle: PythonRunnerHandle | null) => {
        if (!handle) return;
        const run = handle.run("1");
        run.catch(() => {});
        seen.push({ status: handle.status, run, stop: handle.stop() });
      };
      const local = createRoot(container);
      act(() =>
        local.render(
          <PythonRunner createWorker={factory.createWorker} ref={ref} />,
        ),
      );
      expect(seen).toHaveLength(1);
      expect(seen[0]!.status).toBe(expected);
      await expect(seen[0]!.run).rejects.toMatchObject({ reason: "disposed" });
      await expect(seen[0]!.stop).resolves.toBe("idle");
      await act(async () => local.unmount());
    }
  });

  test("handle 키는 run·stop·reset·clear·setCopyOnSelect·status·focus 7개뿐이다", () => {
    const probe = mount();
    expect(Object.keys(probe.ref.current!).sort()).toEqual([
      "clear",
      "focus",
      "reset",
      "run",
      "setCopyOnSelect",
      "status",
      "stop",
    ]);
    expectTypeOf<keyof PythonRunnerHandle>().toEqualTypeOf<
      | "run"
      | "stop"
      | "reset"
      | "clear"
      | "setCopyOnSelect"
      | "status"
      | "focus"
    >();
  });

  test("마운트 뒤 run은 core run으로 전달되고 결과가 돌아온다", async () => {
    const probe = mount();
    await becomeReady(probe);
    const run = probe.ref.current!.run("print(1)");
    await until(() => factory.workers[0]!.pending.length === 1);
    expect(factory.workers[0]!.pending[0]!.code).toBe("print(1)");
    factory.workers[0]!.pending[0]!.resolve({
      kind: "ok",
      value: null,
    } as never);
    await expect(run).resolves.toMatchObject({ kind: "ok" });
  });

  test("StrictMode에서 handle의 run은 살아 있는(두 번째) worker로 간다", async () => {
    const probe = mount({}, { strict: true });
    await becomeReady(probe, 1);
    probe.ref.current!.run("1").catch(() => {});
    await until(() => factory.workers[1]!.pending.length === 1);
    expect(factory.workers[0]!.pending).toHaveLength(0);
  });

  test("언마운트 뒤 낡은 handle은 run reject disposed·stop idle·나머지 no-op이고 status는 마지막 값이다", async () => {
    const probe = mount();
    await becomeReady(probe);
    const handle = probe.ref.current!;
    await unmount();
    await expect(handle.run("1")).rejects.toMatchObject({
      name: "RunRejectedError",
      reason: "disposed",
    });
    await expect(handle.stop()).resolves.toBe("idle");
    expect(() => handle.reset()).not.toThrow();
    expect(() => handle.clear()).not.toThrow();
    expect(() => handle.setCopyOnSelect(false)).not.toThrow();
    expect(() => handle.focus()).not.toThrow();
    expect(handle.status).toBe("ready");
  });

  test("reset()은 worker를 새로 만든다", async () => {
    const probe = mount();
    await becomeReady(probe);
    act(() => probe.ref.current!.reset());
    expect(factory.workers).toHaveLength(2);
    expect(factory.workers[0]!.terminated()).toBe(true);
  });

  test("재렌더로 createWorker를 바꿔도 reset()은 마운트 때 것으로 새 worker를 만든다", async () => {
    const probe = mount();
    await becomeReady(probe);
    const replaced = vi.fn(factory.createWorker);
    probe.rerender(props({ createWorker: replaced }));
    act(() => probe.ref.current!.reset());
    expect(replaced).not.toHaveBeenCalled();
    expect(factory.workers).toHaveLength(2);
  });

  test("status는 핸들 값이다(loading에서 ready로)", async () => {
    const probe = mount();
    expect(probe.ref.current!.status).toBe("loading");
    await becomeReady(probe);
    expect(probe.ref.current!.status).toBe("ready");
  });

  test("격리되지 않으면 status가 not-isolated이고 worker를 만들지 않는다", () => {
    vi.stubGlobal("crossOriginIsolated", false);
    const statuses: RunnerStatus[] = [];
    const probe = mount({ onStatus: (status) => statuses.push(status) });
    expect(factory.workers).toHaveLength(0);
    expect(statuses).toEqual(["not-isolated"]);
    expect(probe.ref.current!.status).toBe("not-isolated");
  });

  test("focus()는 살아 있는 Terminal에 포커스를 준다", async () => {
    const probe = mount({}, { strict: true });
    const focusSpy = vi.spyOn(Terminal.prototype, "focus");
    act(() => probe.ref.current!.focus());
    expect(focusSpy).toHaveBeenCalledTimes(1);
    // 재마운트 뒤 살아 있는 것은 두 번째 Terminal이다.
    expect(focusSpy.mock.contexts[0]).toBe(probe.terminal());
    const handle = probe.ref.current!;
    await unmount();
    handle.focus();
    expect(focusSpy).toHaveBeenCalledTimes(1);
  });

  test("부모의 마운트 effect에서 부른 focus()는 StrictMode에서도 살아 있는 Terminal에 닿는다(autoFocus prop 불필요)", () => {
    const focusSpy = vi.spyOn(Terminal.prototype, "focus");
    function Parent() {
      const ref = useRef<PythonRunnerHandle>(null);
      // 자식 effect(runner 생성)가 부모 effect보다 먼저 돈다. StrictMode 재마운트에서도 같은 순서다.
      useEffect(() => {
        ref.current?.focus();
      }, []);
      return <PythonRunner createWorker={factory.createWorker} ref={ref} />;
    }
    root = createRoot(container);
    act(() =>
      root!.render(
        <StrictMode>
          <Parent />
        </StrictMode>,
      ),
    );
    // effect가 두 번(마운트·재마운트) 돌아 focus도 두 번이고, 마지막 것은 살아 있는 두 번째 Terminal이다.
    expect(focusSpy).toHaveBeenCalledTimes(2);
    const live = openSpy.mock.contexts.at(-1);
    expect(focusSpy.mock.contexts.at(-1)).toBe(live);
    expect(focusSpy.mock.contexts[0]).not.toBe(live);
    expect(container.querySelectorAll(".xterm")).toHaveLength(1);
  });

  test("clear()는 화면을 지운다", async () => {
    const probe = mount();
    await becomeReady(probe);
    factory.workers[0]!.write("to-be-cleared");
    await expect
      .poll(() => screenText(probe.terminal()))
      .toContain("to-be-cleared");
    act(() => probe.ref.current!.clear());
    await expect
      .poll(() => screenText(probe.terminal()))
      .not.toContain("to-be-cleared");
  });
});

describe("PythonRunner: 타입", () => {
  test("props·handle은 하위 타입에서 유도돼 콜백 시그니처가 같다", () => {
    expectTypeOf<PythonRunnerProps["onStatus"]>().toEqualTypeOf<
      TerminalRunnerOptions["onStatus"]
    >();
    expectTypeOf<PythonRunnerProps["inputProvider"]>().toEqualTypeOf<
      TerminalRunnerOptions["inputProvider"]
    >();
    expectTypeOf<PythonRunnerProps["onCopy"]>().toEqualTypeOf<
      TerminalRunnerOptions["onCopy"]
    >();
    expectTypeOf<PythonRunnerHandle["run"]>().toEqualTypeOf<
      TerminalRunnerHandle["run"]
    >();
    expectTypeOf<PythonRunnerHandle["status"]>().toEqualTypeOf<
      TerminalRunnerHandle["status"]
    >();
  });

  test("Terminal 객체와 interrupt·busy는 handle에 없다", () => {
    expectTypeOf<PythonRunnerHandle>().not.toHaveProperty("interrupt");
    expectTypeOf<PythonRunnerHandle>().not.toHaveProperty("busy");
    expectTypeOf<PythonRunnerHandle>().not.toHaveProperty("terminal");
  });
});
