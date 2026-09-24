/**
 * `<PythonRepl>` 시험(jsdom + React). 실제 `createRepl`·실제 `@xterm/xterm`·실제 `FitAddon`을 쓰고 worker만 가짜다
 * (`test-utils/fake-worker.ts`). `python-runner.test.tsx`와 같은 틀로 StrictMode 이중 마운트에서 살아 있는 worker·`.xterm` 1개,
 * 언마운트 정리, 정리 순서(14.5.5: repl → fit → terminal), 콜백 latest-ref, `copyOnSelect` 반응형, 생성 옵션 무시, ref handle
 * 위임 규칙(`runSource`·`reset({ topLevelAwait })`·`busy`)을 본다. fit 자체(크기 0 건너뜀·rAF 합침)는 `mountTerminalView`를 같이 쓰므로
 * `python-runner.test.tsx`가 본다 — 여기서는 배선(붙임·안 붙임)만 확인한다.
 */
import type { CopyResult } from "@cp949/runo-pyodide-terminal";
import {
  NOT_ISOLATED_WARNING,
  type ReplHandle,
  type ReplOptions,
  type ReplStatus,
} from "@cp949/runo-pyodide-repl";
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
import { PythonRepl, PythonRunner } from "./index";
import type {
  PythonReplHandle,
  PythonReplProps,
  PythonRunnerProps,
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
} from "./test-utils/harness";

enableActEnvironment();

const HOST_ID = "repl-host";

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
  ref: { current: PythonReplHandle | null };
  rerender(next: PythonReplProps): void;
  /** 컴포넌트가 그린 컨테이너 div. */
  host(): HTMLElement;
  /** 가장 최근에 open된 Terminal. */
  terminal(): Terminal;
}

function mount(
  initial: Partial<PythonReplProps> = {},
  { strict = false }: { strict?: boolean } = {},
): Probe {
  let current: PythonReplProps = props(initial);
  const ref: Probe["ref"] = { current: null };
  const element = () => {
    const app = (
      <PythonRepl {...current} ref={ref as unknown as Ref<PythonReplHandle>} />
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

function props(overrides: Partial<PythonReplProps> = {}): PythonReplProps {
  return {
    createWorker: factory.createWorker,
    "data-testid": HOST_ID,
    ...overrides,
  } as PythonReplProps;
}

/** `index`번째 worker가 부팅을 마쳐 `ready`를 알리게 하고 그 상태가 될 때까지 기다린다. */
async function becomeReady(
  probe: Probe,
  statuses: ReplStatus[],
  index = 0,
): Promise<void> {
  factory.workers[index]!.ready();
  await until(() => statuses.at(-1) === "ready");
  void probe;
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

/**
 * 준비된 worker가 `>>> ` 읽기를 열어 `runSource`를 받을 수 있는 상태(`busy` 거짓)로 만든다. 읽기 promise는 `runSource`가 응답할 때까지
 * 끝나지 않으므로 객체에 담아 돌려준다(async 함수는 반환한 promise를 풀어 버린다).
 */
async function openPrompt(
  probe: Probe,
  statuses: ReplStatus[],
  index = 0,
): Promise<{ read: Promise<unknown> }> {
  await becomeReady(probe, statuses, index);
  const read = factory.workers[index]!.readLine();
  // 프롬프트가 화면에 그려지면 열린 읽기다.
  await expect.poll(() => screenText(probe.terminal())).toContain(">>> ");
  return { read };
}

describe("PythonRepl: xterm·worker 수명", () => {
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
      onStatus: () => {},
      onCrash: () => {},
      onCopy: () => {},
    });
    for (let i = 0; i < 2; i += 1) {
      probe.rerender(
        props({
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

  test("생성 옵션(createWorker·indexURL·terminalOptions·fit·topLevelAwait)을 바꿔 재렌더해도 마운트 때 것을 유지한다", () => {
    const probe = mount({
      terminalOptions: { cols: 100, rows: 10 },
      topLevelAwait: false,
    });
    const replaced = vi.fn(factory.createWorker);
    probe.rerender(
      props({
        createWorker: replaced,
        indexURL: "https://cdn.example/other/",
        terminalOptions: { cols: 50, rows: 5 },
        fit: false,
        topLevelAwait: true,
      }),
    );
    expect(replaced).not.toHaveBeenCalled();
    expect(factory.workers).toHaveLength(1);
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(probe.terminal().cols).toBe(100);
    expect(probe.terminal().rows).toBe(10);
    // 값이 바뀌어도 이미 만든 세션의 프레임은 그대로다.
    expect(
      (factory.workers[0]!.init()!.driver as { topLevelAwait?: unknown })
        .topLevelAwait,
    ).toBe(false);
  });

  test("indexURL·topLevelAwait를 core에 넘긴다", () => {
    mount({
      indexURL: "https://cdn.example/pyodide",
      topLevelAwait: true,
    });
    const frame = factory.workers[0]!.init()!;
    // repl은 끝 `/`가 없으면 붙인다.
    expect(frame.pyodide.indexURL).toBe("https://cdn.example/pyodide/");
    expect(frame.driver).toMatchObject({ topLevelAwait: true });
  });

  test("topLevelAwait 생략은 false다", () => {
    mount();
    expect(factory.workers[0]!.init()!.driver).toMatchObject({
      topLevelAwait: false,
    });
  });

  test("정리 순서는 repl 먼저 terminal 나중이다(terminal이 dispose될 때 worker는 이미 terminate됐다)", async () => {
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
      className: "repl-box",
      style: { height: 240 },
      id: "repl-1",
    });
    expect(probe.terminal().cols).toBe(100);
    expect(probe.terminal().rows).toBe(10);
    const host = probe.host();
    expect(host.className).toBe("repl-box");
    expect(host.style.height).toBe("240px");
    expect(host.id).toBe("repl-1");
    expect(host.querySelector(".xterm")).not.toBeNull();
  });

  test("createWorker가 던지면 만든 Terminal을 정리하고 오류가 React로 전파된다", () => {
    // 격리가 아니면 createWorker를 부르지 않으므로 격리 상태에서 시험한다. 던지는 자식을 React가 처리하는 오류 경계는 없으므로 root 렌더가 던진다.
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    root = createRoot(container);
    expect(() =>
      act(() =>
        root!.render(
          <PythonRepl
            createWorker={() => {
              throw new Error("worker 생성 실패");
            }}
          />,
        ),
      ),
    ).toThrow("worker 생성 실패");
    // 생성 도중 던져도 열린 Terminal은 정리된다(누수 없음).
    expect(disposeSpy).toHaveBeenCalledTimes(openSpy.mock.calls.length);
    errors.mockRestore();
    root = undefined;
  });
});

describe("PythonRepl: 출력·콜백 latest-ref", () => {
  test("worker 출력이 xterm 화면에 그려진다", async () => {
    const statuses: ReplStatus[] = [];
    const probe = mount({ onStatus: (status) => statuses.push(status) });
    await becomeReady(probe, statuses);
    factory.workers[0]!.write("hello-screen");
    await expect
      .poll(() => screenText(probe.terminal()))
      .toContain("hello-screen");
  });

  test("재렌더로 바꾼 onStatus가 다음 통지부터 불리고 옛 함수는 불리지 않는다", async () => {
    const statusFirst = vi.fn();
    const seenSecond: ReplStatus[] = [];
    const statusSecond = vi.fn((status: ReplStatus) => seenSecond.push(status));
    const probe = mount({ onStatus: statusFirst });
    expect(statusFirst).toHaveBeenCalledWith("loading");
    probe.rerender(props({ onStatus: statusSecond }));
    await becomeReady(probe, seenSecond);
    expect(statusSecond).toHaveBeenCalledWith("ready");
    expect(statusFirst).not.toHaveBeenCalledWith("ready");
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

  test("onStatus는 ReplStatus를 받는다(loading·ready, 크래시 뒤 crashed)", async () => {
    const statuses: ReplStatus[] = [];
    const probe = mount({ onStatus: (status) => statuses.push(status) });
    await becomeReady(probe, statuses);
    act(() => factory.workers[0]!.dispatchError("boom"));
    expect(statuses).toEqual(["loading", "ready", "crashed"]);
  });

  test("격리되지 않으면 worker를 만들지 않고 not-isolated를 알리며 경고를 그린다", async () => {
    vi.stubGlobal("crossOriginIsolated", false);
    const statuses: ReplStatus[] = [];
    const probe = mount({ onStatus: (status) => statuses.push(status) });
    expect(factory.workers).toHaveLength(0);
    expect(statuses).toEqual(["not-isolated"]);
    expect(probe.ref.current!.crossOriginIsolated).toBe(false);
    await expect
      .poll(() => screenText(probe.terminal()))
      .toContain(NOT_ISOLATED_WARNING.slice(0, 20));
  });
});

describe("PythonRepl: copyOnSelect 반응형", () => {
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

describe("PythonRepl: fit 배선", () => {
  let fitSpy: ReturnType<typeof vi.spyOn>;
  let activateSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    FakeResizeObserver.instances = [];
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    installFakeRaf((name, value) => vi.stubGlobal(name, value));
    fitSpy = vi.spyOn(FitAddon.prototype, "fit").mockImplementation(() => {});
    activateSpy = vi.spyOn(FitAddon.prototype, "activate");
  });

  /** 컨테이너를 관찰하는 observer. xterm 내부 것이 섞이지 않게 대상으로 거른다. */
  function hostObservers(probe: Probe): FakeResizeObserver[] {
    return FakeResizeObserver.instances.filter((observer) =>
      observer.targets.includes(probe.host()),
    );
  }

  test("기본값(fit 생략)은 FitAddon을 붙이고 컨테이너에 ResizeObserver를 건다", () => {
    const probe = mount();
    expect(activateSpy).toHaveBeenCalledTimes(1);
    expect(hostObservers(probe)).toHaveLength(1);
  });

  test("fit={false}이면 FitAddon도 ResizeObserver도 만들지 않는다", () => {
    const probe = mount({ fit: false });
    expect(activateSpy).not.toHaveBeenCalled();
    expect(hostObservers(probe)).toHaveLength(0);
    expect(FakeResizeObserver.instances).toHaveLength(0);
    expect(fitSpy).not.toHaveBeenCalled();
  });

  test("언마운트하면 observer를 끊는다", async () => {
    const probe = mount();
    const observer = hostObservers(probe)[0]!;
    await unmount();
    expect(observer.disconnected).toBe(true);
  });
});

describe("PythonRepl: ref handle", () => {
  test("handle 객체는 StrictMode 재마운트에서도 같은 객체다", () => {
    const seen = new Set<PythonReplHandle>();
    let current: PythonReplHandle | null = null;
    const ref = (handle: PythonReplHandle | null) => {
      if (handle) seen.add(handle);
      current = handle;
    };
    root = createRoot(container);
    act(() =>
      root!.render(
        <StrictMode>
          <PythonRepl createWorker={factory.createWorker} ref={ref} />
        </StrictMode>,
      ),
    );
    expect(current).not.toBeNull();
    expect(seen.size).toBe(1);
  });

  test("ref가 붙는 시점(repl 생성 전)에는 runSource reject disposed·busy false이고 crossOriginIsolated는 전역 값이다", async () => {
    for (const isolated of [true, false]) {
      vi.stubGlobal("crossOriginIsolated", isolated);
      const seen: {
        busy: boolean;
        crossOriginIsolated: boolean;
        run: Promise<unknown>;
      }[] = [];
      // 콜백 ref는 레이아웃 단계에 불려 passive effect의 repl 생성보다 먼저다.
      const ref = (handle: PythonReplHandle | null) => {
        if (!handle) return;
        const run = handle.runSource("1");
        run.catch(() => {});
        seen.push({
          busy: handle.busy,
          crossOriginIsolated: handle.crossOriginIsolated,
          run,
        });
      };
      const local = createRoot(container);
      act(() =>
        local.render(
          <PythonRepl createWorker={factory.createWorker} ref={ref} />,
        ),
      );
      expect(seen).toHaveLength(1);
      expect(seen[0]!.busy).toBe(false);
      expect(seen[0]!.crossOriginIsolated).toBe(isolated);
      await expect(seen[0]!.run).rejects.toMatchObject({
        name: "RunRejectedError",
        reason: "disposed",
      });
      await act(async () => local.unmount());
    }
  });

  test("handle 키는 runSource·reset·setCopyOnSelect·busy·focus·crossOriginIsolated 6개뿐이다", () => {
    const probe = mount();
    expect(Object.keys(probe.ref.current!).sort()).toEqual([
      "busy",
      "crossOriginIsolated",
      "focus",
      "reset",
      "runSource",
      "setCopyOnSelect",
    ]);
    expectTypeOf<keyof PythonReplHandle>().toEqualTypeOf<
      | "runSource"
      | "reset"
      | "setCopyOnSelect"
      | "busy"
      | "focus"
      | "crossOriginIsolated"
    >();
  });

  test("마운트 뒤 runSource는 core runSource로 전달되고 결말이 돌아온다", async () => {
    const statuses: ReplStatus[] = [];
    const probe = mount({ onStatus: (status) => statuses.push(status) });
    const { read } = await openPrompt(probe, statuses);
    const run = probe.ref.current!.runSource("1 + 1");
    // 열린 읽기가 줄 대신 `{ source }`로 응답된다.
    await expect(read).resolves.toEqual({ source: "1 + 1" });
    // worker가 실행을 마치고 다음 읽기를 열면서 결말을 싣는다.
    void factory.workers[0]!.readLine(">>> ", { kind: "ok" });
    await expect(run).resolves.toMatchObject({ kind: "ok" });
  });

  test("StrictMode에서 handle의 runSource는 살아 있는(두 번째) worker로 간다", async () => {
    const statuses: ReplStatus[] = [];
    const probe = mount(
      { onStatus: (status) => statuses.push(status) },
      { strict: true },
    );
    const { read } = await openPrompt(probe, statuses, 1);
    void probe.ref.current!.runSource("x = 1").catch(() => {});
    await expect(read).resolves.toEqual({ source: "x = 1" });
  });

  test("busy는 살아 있는 repl의 값이다(실행 중이면 true)", async () => {
    const statuses: ReplStatus[] = [];
    const probe = mount({ onStatus: (status) => statuses.push(status) });
    await openPrompt(probe, statuses);
    expect(probe.ref.current!.busy).toBe(false);
    void probe.ref.current!.runSource("while True: pass").catch(() => {});
    expect(probe.ref.current!.busy).toBe(true);
  });

  test("worker가 로드되기 전(loading)의 runSource는 슬롯을 차지하고 두 번째 호출은 busy로 거부된다", async () => {
    const probe = mount();
    const first = probe.ref.current!.runSource("1");
    first.catch(() => {});
    await expect(probe.ref.current!.runSource("2")).rejects.toMatchObject({
      reason: "busy",
    });
    expect(probe.ref.current!.busy).toBe(true);
    await unmount();
    await expect(first).rejects.toMatchObject({ reason: "disposed" });
  });

  test("언마운트 뒤 낡은 handle은 runSource reject disposed·busy false·나머지 no-op이다", async () => {
    const statuses: ReplStatus[] = [];
    const probe = mount({ onStatus: (status) => statuses.push(status) });
    await becomeReady(probe, statuses);
    const handle = probe.ref.current!;
    await unmount();
    await expect(handle.runSource("1")).rejects.toMatchObject({
      name: "RunRejectedError",
      reason: "disposed",
    });
    expect(handle.busy).toBe(false);
    expect(() => handle.reset()).not.toThrow();
    expect(() => handle.reset({ topLevelAwait: true })).not.toThrow();
    expect(() => handle.setCopyOnSelect(false)).not.toThrow();
    expect(() => handle.focus()).not.toThrow();
    expect(handle.crossOriginIsolated).toBe(true);
    // 정리된 뒤 worker를 새로 만들지 않는다.
    expect(factory.workers).toHaveLength(1);
  });

  test("reset({ topLevelAwait: true })는 core reset으로 전달돼 새 worker를 만들고 값을 바꾼다", async () => {
    const statuses: ReplStatus[] = [];
    const probe = mount({ onStatus: (status) => statuses.push(status) });
    await becomeReady(probe, statuses);
    act(() => probe.ref.current!.reset({ topLevelAwait: true }));
    expect(factory.workers).toHaveLength(2);
    expect(factory.workers[0]!.terminated()).toBe(true);
    expect(factory.workers[1]!.init()!.driver).toMatchObject({
      topLevelAwait: true,
    });
    // 마지막 값 유지(sticky)는 core가 보관한다: 인자 없는 reset()이 같은 값을 다시 쓴다.
    act(() => probe.ref.current!.reset());
    expect(factory.workers).toHaveLength(3);
    expect(factory.workers[2]!.init()!.driver).toMatchObject({
      topLevelAwait: true,
    });
    act(() => probe.ref.current!.reset({ topLevelAwait: false }));
    expect(factory.workers[3]!.init()!.driver).toMatchObject({
      topLevelAwait: false,
    });
  });

  test("재렌더로 createWorker를 바꿔도 reset()은 마운트 때 것으로 새 worker를 만든다", async () => {
    const statuses: ReplStatus[] = [];
    const probe = mount({ onStatus: (status) => statuses.push(status) });
    await becomeReady(probe, statuses);
    const replaced = vi.fn(factory.createWorker);
    probe.rerender(props({ createWorker: replaced }));
    act(() => probe.ref.current!.reset());
    expect(replaced).not.toHaveBeenCalled();
    expect(factory.workers).toHaveLength(2);
  });

  test("crossOriginIsolated는 살아 있는 repl이 만들 때 정한 값이다(만든 뒤 전역이 바뀌어도 유지)", () => {
    const probe = mount();
    vi.stubGlobal("crossOriginIsolated", false);
    expect(probe.ref.current!.crossOriginIsolated).toBe(true);
  });

  test("reset()은 세션을 새로 시작해 loading을 다시 알린다", async () => {
    const statuses: ReplStatus[] = [];
    const probe = mount({ onStatus: (status) => statuses.push(status) });
    await becomeReady(probe, statuses);
    act(() => probe.ref.current!.reset());
    expect(statuses).toEqual(["loading", "ready", "loading"]);
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
      const ref = useRef<PythonReplHandle>(null);
      // 자식 effect(repl 생성)가 부모 effect보다 먼저 돈다. StrictMode 재마운트에서도 같은 순서다.
      useEffect(() => {
        ref.current?.focus();
      }, []);
      return <PythonRepl createWorker={factory.createWorker} ref={ref} />;
    }
    root = createRoot(container);
    act(() =>
      root!.render(
        <StrictMode>
          <Parent />
        </StrictMode>,
      ),
    );
    expect(focusSpy).toHaveBeenCalledTimes(2);
    const live = openSpy.mock.contexts.at(-1);
    expect(focusSpy.mock.contexts.at(-1)).toBe(live);
    expect(focusSpy.mock.contexts[0]).not.toBe(live);
    expect(container.querySelectorAll(".xterm")).toHaveLength(1);
  });
});

describe("PythonRepl: 타입", () => {
  test("props·handle은 하위 타입에서 유도돼 콜백·메서드 시그니처가 같다", () => {
    expectTypeOf<PythonReplProps["onStatus"]>().toEqualTypeOf<
      ReplOptions["onStatus"]
    >();
    expectTypeOf<PythonReplProps["onCrash"]>().toEqualTypeOf<
      ReplOptions["onCrash"]
    >();
    expectTypeOf<PythonReplProps["onCopy"]>().toEqualTypeOf<
      ReplOptions["onCopy"]
    >();
    expectTypeOf<PythonReplProps["onCopy"]>().toEqualTypeOf<
      ((result: CopyResult) => void) | undefined
    >();
    expectTypeOf<PythonReplProps["topLevelAwait"]>().toEqualTypeOf<
      ReplOptions["topLevelAwait"]
    >();
    expectTypeOf<PythonReplProps["copyOnSelect"]>().toEqualTypeOf<
      ReplOptions["copyOnSelect"]
    >();
    expectTypeOf<PythonReplHandle["runSource"]>().toEqualTypeOf<
      ReplHandle["runSource"]
    >();
    expectTypeOf<PythonReplHandle["reset"]>().toEqualTypeOf<
      ReplHandle["reset"]
    >();
    expectTypeOf<PythonReplHandle["busy"]>().toEqualTypeOf<
      ReplHandle["busy"]
    >();
    expectTypeOf<PythonReplHandle["crossOriginIsolated"]>().toEqualTypeOf<
      ReplHandle["crossOriginIsolated"]
    >();
  });

  test("onStatus의 상태 유니온은 REPL은 ReplStatus, Runner는 RunnerStatus라 섞이지 않는다", () => {
    type ReplStatusArg = Parameters<
      NonNullable<PythonReplProps["onStatus"]>
    >[0];
    type RunnerStatusArg = Parameters<
      NonNullable<PythonRunnerProps["onStatus"]>
    >[0];
    expectTypeOf<ReplStatusArg>().toEqualTypeOf<ReplStatus>();
    expectTypeOf<ReplStatusArg>().not.toEqualTypeOf<RunnerStatusArg>();
  });

  test("Terminal 객체·status·run·stop·clear는 handle에, terminal·pyodide는 props에 없다", () => {
    expectTypeOf<PythonReplHandle>().not.toHaveProperty("terminal");
    expectTypeOf<PythonReplHandle>().not.toHaveProperty("status");
    expectTypeOf<PythonReplHandle>().not.toHaveProperty("run");
    expectTypeOf<PythonReplHandle>().not.toHaveProperty("stop");
    expectTypeOf<PythonReplHandle>().not.toHaveProperty("clear");
    expectTypeOf<PythonReplHandle>().not.toHaveProperty("dispose");
    expectTypeOf<PythonReplProps>().not.toHaveProperty("terminal");
    expectTypeOf<PythonReplProps>().not.toHaveProperty("pyodide");
  });

  test("index는 PythonRepl·PythonRunner를 함께 내보낸다", () => {
    expect(typeof PythonRepl).toBe("function");
    expect(typeof PythonRunner).toBe("function");
  });
});
