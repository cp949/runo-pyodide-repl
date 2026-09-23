import { Readline } from "@cp949/runo-xterm-readline";
import type { Terminal } from "@xterm/xterm";
import { createInterruptBuffer, SIGNAL } from "./protocol/interrupt-protocol";
import { createInterruptSender } from "./protocol/interrupt-sender";
import { startSession, type ReplSession } from "./session";
import { createSelectionCopy, type CopyResult } from "./terminal/selection-copy";
import { writeNotice } from "./terminal/notice";

export type { CopyResult };

/** 기본 pyodide CDN 위치. 끝 `/`를 포함한다(`00-architecture.md` 4.1). */
export const DEFAULT_PYODIDE_INDEX_URL =
  "https://cdn.jsdelivr.net/pyodide/v314.0.7/full/";

/** 비격리 페이지에서 세션을 시작하지 않는 이유를 알리는 터미널 안내 문구(ADR-0004). */
export const NOT_ISOLATED_WARNING =
  "경고: cross-origin isolation이 꺼져 있어 Python 세션을 시작하지 않습니다. 서버가 COOP/COEP 헤더를 보내야 합니다.";

/** `reset()`이 옛 세션 뒤에 남기는 안내 줄(청록, `08-session.md`). */
export const RESET_NOTICE =
  "[세션 리셋됨 — 이전 변수/import가 모두 초기화되었습니다]";

/**
 * 세션의 생애를 앱에 알리는 값. RD-004는 `loading`·`ready`·`load-failed`·`not-isolated`를 발행하고, RD-005부터
 * `terminated`(`exit()`)를 발행한다. `crashed`는 RD-010이 발행한다.
 */
export type ReplStatus =
  | "loading"
  | "ready"
  | "load-failed"
  | "not-isolated"
  | "terminated"
  | "crashed";

export interface ReplOptions {
  /** 호출자가 소유하는 xterm `Terminal`. 코어는 줄 편집기를 붙이기만 하고 dispose하지 않는다. */
  terminal: Terminal;
  /** 세션마다 불린다(리셋은 RD-010). 앱은 `new Worker(new URL("./repl.worker.ts", import.meta.url), { type: "module" })`를 돌려준다. */
  createWorker: () => Worker;
  /** 기본 CDN. 끝 `/`가 없으면 붙인다. */
  pyodide?: { indexURL?: string };
  /** 상태가 바뀔 때 부른다. `loading`은 `createRepl`이 반환하기 전에 동기로 온다. */
  onStatus?: (status: ReplStatus) => void;
  /** worker `error` 이벤트 또는 `crashed` 알림(첫 신호만) 뒤 `onStatus("crashed")` 다음에 부른다(RD-010). */
  onCrash?: (message: string) => void;
  /** 기본 `false`. `=== true`일 때만 켠다. 바꾸려면 `reset({ topLevelAwait })`(RD-012, `02-console-core.md` 5.4). */
  topLevelAwait?: boolean;
  /** 드래그 선택(`mouseup`) 시 자동 복사할지. 기본 `true`(`=== false`일 때만 끔). Ctrl+C 복사는 이 값과 무관하게 항상 동작한다(RD-017). */
  copyOnSelect?: boolean;
  /** 선택 복사(자동·Ctrl+C 모두) 결과를 알린다(RD-017). */
  onCopy?: (result: CopyResult) => void;
}

export interface ReplHandle {
  /**
   * worker와 RPC를 정리하고 대기 중인 읽기를 끝내며 줄 편집기를 뗀다. 두 번 불러도 안전하다.
   * `Terminal`은 dispose하지 않는다.
   */
  dispose(): void;
  /**
   * 화면·history를 유지한 채 worker를 새로 만든다(변수·import는 사라진다). 청록 안내 줄(`RESET_NOTICE`) 뒤 새 배너가
   * 뜬다. `dispose()` 뒤·`!isolated`면 no-op. 그 외 상태(`ready`·`terminated`·`crashed`·`load-failed`·`loading`)는
   * 전부 허용한다. 동기이며 안에서 `loading`을 동기로 발행하고 이후 새 worker의 `ready`/`load-failed`가 재발행한다.
   * `topLevelAwait`가 boolean이면 그 값으로 바꾸고, 생략·`undefined`면 마지막으로 적용한 값을 유지한다(RD-012).
   * 확인 대화상자·디바운스 없음.
   */
  reset(options?: { topLevelAwait?: boolean }): void;
  /** `globalThis.crossOriginIsolated === true`. 거짓이면 worker가 없다. */
  readonly crossOriginIsolated: boolean;
  /** 드래그 자동 복사 on/off를 바꾼다. 리셋 없음(`reset()`과 무관). `dispose()` 뒤 no-op(RD-017). */
  setCopyOnSelect(on: boolean): void;
}

function normalizeIndexUrl(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

export function createRepl(options: ReplOptions): ReplHandle {
  // 선택 복사 정책은 `Readline` 생성 앞에 만든다 — 훅이 vendor보다 먼저 걸려도 안전하게(`!isolated`와도 무관, 확정 8).
  const selectionCopy = createSelectionCopy(options.terminal, {
    copyOnSelect: options.copyOnSelect !== false,
    onCopy: options.onCopy ?? (() => {}),
  });
  // history는 세션(마운트) 동안 메모리에만 둔다. 새로고침 뒤에는 비어 있어야 한다. 세션을 넘어 산다(리셋은 RD-010).
  const readline = new Readline({
    persist: false,
    skipBlankHistory: true,
    onKeyEvent: (event) => selectionCopy.onKeyEvent(event),
  });
  options.terminal.loadAddon(readline);
  const onStatus = options.onStatus ?? (() => {});
  const isolated = globalThis.crossOriginIsolated === true;
  const indexURL = normalizeIndexUrl(
    options.pyodide?.indexURL ?? DEFAULT_PYODIDE_INDEX_URL,
  );

  let disposed = false;
  let session: ReplSession | undefined;
  // isolated일 때만 있다. not-isolated에서 reset()은 no-op(ReplHandle.reset 문서).
  let resetSession:
    | ((next?: { topLevelAwait?: boolean }) => void)
    | undefined;

  if (!isolated) {
    // SharedArrayBuffer가 없어 초기화 프레임을 만들 수 없다(ADR-0004, TRP-002). 폴백은 없다.
    writeNotice(readline, NOT_ISOLATED_WARNING, "warning");
    onStatus("not-isolated");
  } else {
    // 프레임에 넣는 것과 같은 SharedArrayBuffer 뷰를 송신기도 쓴다. reset()이 새 세션에도 같은 버퍼를 싣는다.
    const interruptBuffer = createInterruptBuffer();
    const interruptSender = createInterruptSender(interruptBuffer);
    // 마지막으로 적용한 값(sticky). 무인자 reset()·reset({})·reset({ topLevelAwait: undefined })는 이 값을 그대로 쓴다.
    let topLevelAwait = options.topLevelAwait === true;
    // 벤더 `Readline`은 활성 읽기가 없을 때만 부른다(읽기 중 Ctrl+C는 벤더가 같은 프롬프트를 다시 그린다).
    // 현재 세션을 `session` 변수로 늦게 읽는다: 리셋이 세션을 바꿔도 다시 등록할 필요가 없다.
    readline.setCtrlCHandler(() => {
      if (!session?.pythonRunning()) return;
      // tty 로컬 에코 흉내. 개행 없이 꼬리에 남아 다음 프롬프트·`input()` 프롬프트가 이어 그려진다(`t^Cx: `).
      session.echoCtrlC();
      interruptSender.send();
    });
    const spawnSession = () => {
      session = startSession({
        readline,
        terminal: options.terminal,
        interruptBuffer,
        interruptSender,
        createWorker: options.createWorker,
        indexURL,
        topLevelAwait,
        onStatus,
        onCrash: options.onCrash,
      });
    };
    spawnSession();
    onStatus("loading");

    resetSession = (next) => {
      // boolean이 명시된 경우에만 바꾼다. 생략·undefined는 마지막 값을 유지한다(sticky).
      if (typeof next?.topLevelAwait === "boolean")
        topLevelAwait = next.topLevelAwait;
      // 옛 세션의 열린 읽기를 cancelRead()로 끝내고 자원을 정리한다: cancelRead → endSession(송신기 취소) →
      // rpc.dispose() → worker.terminate()(session.terminate()).
      session?.terminate();
      // 옛 세션이 남겼을 SIGINT를 지운다. 리셋 직전 Ctrl+C가 새 세션의 시작 코드를 죽이지 않게 한다.
      Atomics.store(interruptBuffer, SIGNAL, 0);
      // 커서가 행 머리가 아니면 개행 뒤에, 행 머리면 바로 안내 줄을 그린다(TRP-006).
      if (options.terminal.buffer.active.cursorX !== 0) readline.write("\r\n");
      writeNotice(readline, RESET_NOTICE, "info");
      spawnSession();
      onStatus("loading");
    };
  }

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      // 게이트를 닫고 재전송을 멈춘다. 이후 도착하는 키·알림은 눌림을 보내지 않는다.
      session?.endSession();
      // 알림 핸들러가 dispose된 줄 편집기에 쓰지 않도록 RPC를 먼저 끊는다. `cancelRead()`가 추가로 앞서지만
      // 뒤이어 `readline.dispose()`가 돌아 관찰 가능한 차이는 없다.
      session?.terminate();
      // mousedown/mouseup 리스너를 뗀다. readline보다 먼저 떼도 순서상 문제 없다(서로 독립).
      selectionCopy.dispose();
      // 벤더 dispose가 멱등이라 term.dispose()가 addon을 다시 dispose해도 안전하다.
      readline.dispose();
    },
    reset(options) {
      if (disposed) return;
      resetSession?.(options);
    },
    get crossOriginIsolated() {
      return isolated;
    },
    setCopyOnSelect(on) {
      if (disposed) return;
      selectionCopy.setCopyOnSelect(on);
    },
  };
}
