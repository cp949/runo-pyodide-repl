/**
 * `<PythonRepl>`(RD-024): repl 패키지의 `createRepl`(xterm 대화형 콘솔)을 React 수명에 붙인다. 수명·fit·ref 규칙은
 * `<PythonRunner>`와 같다. 컨테이너 `div`에 xterm `Terminal`을 만들고(필요하면 `FitAddon`), REPL을 만들고, 언마운트(cleanup)에서
 * REPL → fit → `Terminal` 순으로 정리한다(14.5.5). StrictMode에서는 worker가 2개 만들어지고 1개가 terminate돼 살아 있는 것은
 * 1개다(첫 worker의 pyodide 로드 낭비는 수용한다, 08-session.md 8.2). 콜백(`onStatus`·`onCrash`·`onCopy`)은 latest-ref라
 * 인라인 람다여도 재마운트가 없고, `copyOnSelect`는 재렌더로 바꾸면 `setCopyOnSelect`가 불린다. 나머지 생성 옵션(`createWorker`·
 * `indexURL`·`topLevelAwait`·`terminalOptions`·`fit`)은 마운트 때만 읽는다(바꾸려면 소비자가 `key`로 재마운트한다).
 * `topLevelAwait`를 세션 도중 바꾸는 길은 handle의 `reset({ topLevelAwait })`뿐이다. `xterm.css`는 소비자가 import한다.
 */
import {
  createRepl,
  type ReplHandle,
  type ReplOptions,
} from "@cp949/runo-pyodide-repl";
import type { ITerminalInitOnlyOptions, ITerminalOptions } from "@xterm/xterm";
import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type Ref,
} from "react";
import { rejectDisposed, useCoreHandle, useLatest } from "./use-lifecycle";
import { mountTerminalView } from "./terminal-view";

/**
 * `PythonRepl`의 ref handle. 살아 있는 REPL이 없는 동안(마운트 전·재마운트 사이·언마운트 뒤)의 규칙은 `PythonRunner`와 같다:
 * `runSource`는 `RunRejectedError("disposed")`, `busy`는 `false`, 나머지는 no-op이다(`crossOriginIsolated`는 전역 값).
 */
export interface PythonReplHandle extends Pick<
  ReplHandle,
  "runSource" | "reset" | "setCopyOnSelect" | "busy" | "crossOriginIsolated"
> {
  /** xterm 화면에 포커스를 준다. 살아 있는 `Terminal`이 없으면 아무것도 하지 않는다. */
  focus(): void;
}

export interface PythonReplProps
  extends
    Omit<ReplOptions, "terminal" | "pyodide">,
    Omit<ComponentPropsWithoutRef<"div">, keyof ReplOptions> {
  /** pyodide 배포 위치. 마운트 때만 읽는다. 없으면 core 기본값. */
  indexURL?: string;
  /** xterm `Terminal` 옵션. 마운트 때만 읽고 그대로 넘긴다(기본값을 더하지 않는다). */
  terminalOptions?: ITerminalOptions & ITerminalInitOnlyOptions;
  /** 컨테이너 크기에 맞춰 열·행을 조절한다. 기본 `true`. 마운트 때만 읽는다. */
  fit?: boolean;
  ref?: Ref<PythonReplHandle>;
}

/** 살아 있는 REPL + 그 xterm 화면. `dispose()`가 REPL → fit → `Terminal` 순으로 정리한다. */
interface LiveRepl extends ReplHandle {
  focus(): void;
}

export function PythonRepl({
  ref,
  createWorker,
  indexURL,
  topLevelAwait,
  copyOnSelect,
  onCopy,
  onStatus,
  onCrash,
  terminalOptions,
  fit,
  ...divProps
}: PythonReplProps) {
  const latest = useLatest({
    createWorker,
    indexURL,
    topLevelAwait,
    copyOnSelect,
    onCopy,
    onStatus,
    onCrash,
    terminalOptions,
    fit,
  });
  const containerRef = useRef<HTMLDivElement>(null);

  const liveRef = useCoreHandle<LiveRepl>(() => {
    const mount = latest.current;
    const view = mountTerminalView(containerRef.current!, {
      terminalOptions: mount.terminalOptions,
      fit: mount.fit !== false,
    });
    let repl: ReplHandle;
    try {
      repl = createRepl({
        terminal: view.terminal,
        createWorker: mount.createWorker,
        pyodide:
          mount.indexURL === undefined
            ? undefined
            : { indexURL: mount.indexURL },
        topLevelAwait: mount.topLevelAwait,
        copyOnSelect: mount.copyOnSelect,
        // 래퍼는 동기 재진입을 그대로 통과시킨다(TRP-051): 안에서 상태를 가두지 않고 호출만 전달한다.
        onCopy: (result) => latest.current.onCopy?.(result),
        onStatus: (next) => latest.current.onStatus?.(next),
        onCrash: (message) => latest.current.onCrash?.(message),
      });
    } catch (error) {
      view.dispose();
      throw error;
    }
    return {
      runSource: (code) => repl.runSource(code),
      reset: (options) => repl.reset(options),
      setCopyOnSelect: (on) => repl.setCopyOnSelect(on),
      get busy() {
        return repl.busy;
      },
      get crossOriginIsolated() {
        return repl.crossOriginIsolated;
      },
      focus: () => view.terminal.focus(),
      dispose() {
        // 열린 읽기가 정리된 뒤에 화면을 뗀다(14.5.5). 순서를 뒤집어도 콘솔 경고는 나지 않으므로(TRP-064) 순서는 L0 시험(`Terminal.dispose` 시점의 live worker 수)이 지킨다.
        repl.dispose();
        view.dispose();
      },
    };
  });

  // `copyOnSelect`는 반응형이다. 마운트 effect 뒤에 돌아 생성 직후 같은 값을 한 번 더 설정하지만 무해하다.
  useEffect(() => {
    liveRef.current?.setCopyOnSelect(copyOnSelect !== false);
  }, [copyOnSelect, liveRef]);

  const [handle] = useState<PythonReplHandle>(() => ({
    runSource: (code) => liveRef.current?.runSource(code) ?? rejectDisposed(),
    reset: (options) => liveRef.current?.reset(options),
    setCopyOnSelect: (on) => liveRef.current?.setCopyOnSelect(on),
    focus: () => liveRef.current?.focus(),
    get busy() {
      return liveRef.current?.busy ?? false;
    },
    get crossOriginIsolated() {
      return (
        liveRef.current?.crossOriginIsolated ??
        globalThis.crossOriginIsolated === true
      );
    },
  }));
  useImperativeHandle(ref, () => handle, [handle]);

  return <div {...divProps} ref={containerRef} />;
}
