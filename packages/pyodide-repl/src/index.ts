import { Readline } from "@cp949/runo-xterm-readline";
import type { Terminal } from "@xterm/xterm";
import { createInterruptBuffer } from "./protocol/interrupt-protocol";
import { createInterruptSender } from "./protocol/interrupt-sender";
import { startSession, type ReplSession } from "./session";
import { writeNotice } from "./terminal/notice";

/** 기본 pyodide CDN 위치. 끝 `/`를 포함한다(`00-architecture.md` 4.1). */
export const DEFAULT_PYODIDE_INDEX_URL =
  "https://cdn.jsdelivr.net/pyodide/v314.0.7/full/";

/** 비격리 페이지에서 세션을 시작하지 않는 이유를 알리는 터미널 안내 문구(ADR-0004). */
export const NOT_ISOLATED_WARNING =
  "경고: cross-origin isolation이 꺼져 있어 Python 세션을 시작하지 않습니다. 서버가 COOP/COEP 헤더를 보내야 합니다.";

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

/**
 * RD-004 시점의 부분 구현이다. 나머지 옵션(`topLevelAwait`는 RD-012, `onCrash`는 RD-010)은 그것을 쓰는 RD가
 * 추가한다(`00-architecture.md` 4.1).
 */
export interface ReplOptions {
  /** 호출자가 소유하는 xterm `Terminal`. 코어는 줄 편집기를 붙이기만 하고 dispose하지 않는다. */
  terminal: Terminal;
  /** 세션마다 불린다(리셋은 RD-010). 앱은 `new Worker(new URL("./repl.worker.ts", import.meta.url), { type: "module" })`를 돌려준다. */
  createWorker: () => Worker;
  /** 기본 CDN. 끝 `/`가 없으면 붙인다. */
  pyodide?: { indexURL?: string };
  /** 상태가 바뀔 때 부른다. `loading`은 `createRepl`이 반환하기 전에 동기로 온다. */
  onStatus?: (status: ReplStatus) => void;
}

export interface ReplHandle {
  /**
   * worker와 RPC를 정리하고 대기 중인 읽기를 끝내며 줄 편집기를 뗀다. 두 번 불러도 안전하다.
   * `Terminal`은 dispose하지 않는다.
   */
  dispose(): void;
  /** `globalThis.crossOriginIsolated === true`. 거짓이면 worker가 없다. */
  readonly crossOriginIsolated: boolean;
}

function normalizeIndexUrl(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

export function createRepl(options: ReplOptions): ReplHandle {
  // history는 세션(마운트) 동안 메모리에만 둔다. 새로고침 뒤에는 비어 있어야 한다. 세션을 넘어 산다(리셋은 RD-010).
  const readline = new Readline({ persist: false });
  options.terminal.loadAddon(readline);
  const onStatus = options.onStatus ?? (() => {});
  const isolated = globalThis.crossOriginIsolated === true;

  let disposed = false;
  let session: ReplSession | undefined;

  if (!isolated) {
    // SharedArrayBuffer가 없어 초기화 프레임을 만들 수 없다(ADR-0004, TRP-002). 폴백은 없다.
    writeNotice(readline, NOT_ISOLATED_WARNING, "warning");
    onStatus("not-isolated");
  } else {
    // 프레임에 넣는 것과 같은 SharedArrayBuffer 뷰를 송신기도 쓴다(RD-010 리셋이 이 버퍼를 재사용한다).
    const interruptBuffer = createInterruptBuffer();
    const interruptSender = createInterruptSender(interruptBuffer);
    // 벤더 `Readline`은 활성 읽기가 없을 때만 부른다(읽기 중 Ctrl+C는 벤더가 같은 프롬프트를 다시 그린다).
    // 현재 세션을 `session` 변수로 늦게 읽는다: 리셋(RD-010)이 세션을 바꿔도 다시 등록할 필요가 없다.
    readline.setCtrlCHandler(() => {
      if (!session?.pythonRunning()) return;
      // tty 로컬 에코 흉내. 개행 없이 꼬리에 남아 다음 프롬프트·`input()` 프롬프트가 이어 그려진다(`t^Cx: `).
      session.echoCtrlC();
      interruptSender.send();
    });
    session = startSession({
      readline,
      terminal: options.terminal,
      interruptBuffer,
      interruptSender,
      createWorker: options.createWorker,
      indexURL: normalizeIndexUrl(
        options.pyodide?.indexURL ?? DEFAULT_PYODIDE_INDEX_URL,
      ),
      onStatus,
    });
    onStatus("loading");
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
      // 벤더 dispose가 멱등이라 term.dispose()가 addon을 다시 dispose해도 안전하다.
      readline.dispose();
    },
    get crossOriginIsolated() {
      return isolated;
    },
  };
}
