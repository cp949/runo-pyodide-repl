/**
 * 컴포넌트·hook이 공유하는 수명 로직(RD-024). core 핸들을 effect 안에서 만들고 cleanup에서 `dispose()`하며, 컴포넌트 수명 내내
 * 같은 함수 객체가 "지금 살아 있는 핸들"로 위임하게 한다(StrictMode의 mount → cleanup → mount에서 핸들만 교체된다).
 * 핸들이 없는 동안(마운트 전·cleanup과 재마운트 사이·언마운트 뒤)의 규칙은 14.3과 같다: `run`은 `RunRejectedError("disposed")`,
 * `stop()`은 `"idle"`, `busy`는 `false`, 나머지는 no-op.
 */
import {
  RunRejectedError,
  type RunResult,
  type RunnerStatus,
  type StopResult,
} from "@cp949/runo-pyodide-core";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

/** `createRunner`의 첫 상태와 같은 규칙(격리 여부)이다. 핸들 생성 전에도 첫 렌더의 `status`가 맞도록 쓴다. */
export function initialRunnerStatus(): RunnerStatus {
  return globalThis.crossOriginIsolated === true ? "loading" : "not-isolated";
}

/**
 * 렌더마다 최신 값을 담는 ref. 콜백을 core에 한 번만 넘기고 부를 때 `.current`를 읽어 항상 최신 함수를 호출한다.
 * 레이아웃 효과에서 갱신하므로 같은 컴포넌트의 passive effect(핸들 생성)는 이미 최신 값을 본다.
 */
export function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}

/**
 * `create()`를 마운트 effect 안에서 한 번 부르고 cleanup에서 `dispose()`한다. 반환 ref는 살아 있는 핸들이고 cleanup부터 다음
 * 마운트의 `create()`가 끝날 때까지 `null`이다. `create`는 마운트 시점의 최신 렌더 것을 쓴다(생성 옵션은 마운트 때만 읽는다).
 * `create()`가 던지면(옵션 검증 오류·`createWorker` 예외) effect 오류로 React가 처리한다.
 */
export function useCoreHandle<H extends { dispose(): void }>(
  create: () => H,
): RefObject<H | null> {
  const handleRef = useRef<H | null>(null);
  const createRef = useLatest(create);
  useEffect(() => {
    const handle = createRef.current();
    handleRef.current = handle;
    return () => {
      handleRef.current = null;
      handle.dispose();
    };
  }, [createRef]);
  return handleRef;
}

/** `run`·`stop`·`reset`을 가진 핸들(core `RunnerHandle`·terminal `TerminalRunnerHandle` 공통). */
export interface RunnerLike {
  run(code: string): Promise<RunResult>;
  stop(): Promise<StopResult>;
  reset(): void;
}

export interface RunnerDelegates {
  run(code: string): Promise<RunResult>;
  stop(): Promise<StopResult>;
  reset(): void;
}

export function rejectDisposed(): Promise<never> {
  return Promise.reject(
    new RunRejectedError(
      "disposed",
      "핸들이 없다(마운트 전이거나 언마운트됐다)",
    ),
  );
}

/** `ref`의 지금 핸들로 위임하는 `run`·`stop`·`reset`. 반환 함수는 컴포넌트 수명 내내 같은 참조여야 하므로 한 번만 만든다. */
export function useRunnerDelegates(
  ref: RefObject<RunnerLike | null>,
): RunnerDelegates {
  const [delegates] = useState<RunnerDelegates>(() => ({
    run: (code) => ref.current?.run(code) ?? rejectDisposed(),
    stop: () => ref.current?.stop() ?? Promise.resolve<StopResult>("idle"),
    reset: () => {
      ref.current?.reset();
    },
  }));
  return delegates;
}
