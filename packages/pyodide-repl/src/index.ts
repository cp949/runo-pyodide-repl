import { Readline } from "@cp949/runo-xterm-readline";
import type { Terminal } from "@xterm/xterm";
import { postInitFrame, type InitFrame } from "./protocol/init-frame";
import { createInterruptBuffer } from "./protocol/interrupt-protocol";
import { createRpc, type Rpc } from "./protocol/rpc";
import { createStdinMailbox } from "./protocol/stdin-mailbox";
import { writeNotice } from "./terminal/notice";
import { createTerminalSinks } from "./terminal/sinks";

/** 기본 pyodide CDN 위치. 끝 `/`를 포함한다(`00-architecture.md` 4.1). */
export const DEFAULT_PYODIDE_INDEX_URL =
  "https://cdn.jsdelivr.net/pyodide/v314.0.7/full/";

/** 비격리 페이지에서 세션을 시작하지 않는 이유를 알리는 터미널 안내 문구(ADR-0004). */
export const NOT_ISOLATED_WARNING =
  "경고: cross-origin isolation이 꺼져 있어 Python 세션을 시작하지 않습니다. 서버가 COOP/COEP 헤더를 보내야 합니다.";

/**
 * 세션의 생애를 앱에 알리는 값. RD-004는 `loading`·`ready`·`load-failed`·`not-isolated`만 발행한다.
 * `terminated`는 RD-005, `crashed`는 RD-010이 발행한다.
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
   * 프롬프트를 그리고 Enter까지 한 줄을 읽어 돌려준다. 값은 편집 버퍼 그대로다.
   * 임시 API다. RD-005에서 worker의 REPL 루프가 읽기를 요청하면 핸들에서 빠진다.
   *
   * 열린 읽기가 있는 동안 다시 부르면 `Error`로 reject한다(벤더 `Readline`은 열린 읽기를 교체하고
   * 앞 promise를 끝내지 않는다). `dispose()`나 그 뒤의 호출도 `Error`로 reject한다.
   */
  readLine(prompt: string): Promise<string>;
  /**
   * worker와 RPC를 정리하고 대기 중인 읽기를 reject하며 줄 편집기를 뗀다. 두 번 불러도 안전하다.
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
  // history는 세션(마운트) 동안 메모리에만 둔다. 새로고침 뒤에는 비어 있어야 한다.
  const readline = new Readline({ persist: false });
  options.terminal.loadAddon(readline);
  const onStatus = options.onStatus ?? (() => {});
  const isolated = globalThis.crossOriginIsolated === true;

  let reading = false;
  let disposed = false;
  let session: { worker: Worker; rpc: Rpc } | undefined;

  if (!isolated) {
    // SharedArrayBuffer가 없어 초기화 프레임을 만들 수 없다(ADR-0004, TRP-002). 폴백은 없다.
    writeNotice(readline, NOT_ISOLATED_WARNING, "warning");
    onStatus("not-isolated");
  } else {
    // sink 세트는 세션마다 새로 만든다. 새 세션이 이전 꼬리를 물려받지 않게(05-output.md 4.1).
    const sinks = createTerminalSinks(readline);
    const channel = new MessageChannel();
    const mailbox = createStdinMailbox();
    const frame: InitFrame = {
      kind: "init",
      rpcPort: channel.port2,
      interruptBuffer: createInterruptBuffer(),
      stdinCtrl: mailbox.ctrl,
      stdinData: mailbox.data,
      topLevelAwait: false, // 옵션은 RD-012가 추가한다
      pyodide: {
        indexURL: normalizeIndexUrl(
          options.pyodide?.indexURL ?? DEFAULT_PYODIDE_INDEX_URL,
        ),
      },
    };
    const rpc = createRpc(channel.port1, {
      write: (text: string) => sinks.write(text),
      writeErrorRaw: (text: string) => sinks.writeErrorRaw(text),
      writeOutput: (text: string) => sinks.writeOutput(text),
      writeError: (text: string) => sinks.writeError(text),
      ready: ({ pyodideVersion }: { pyodideVersion: string }) => {
        console.info("[repl] pyodide 준비", pyodideVersion);
        onStatus("ready");
      },
      // worker는 죽지 않는다. 접두사는 main이 붙이고 빨강 한 줄로 낸다(01-protocols.md 1.2).
      loadFailed: (message: string) => {
        sinks.writeError(`pyodide 로드 실패: ${message}`);
        onStatus("load-failed");
      },
    });
    const worker = options.createWorker();
    postInitFrame(worker, frame);
    session = { worker, rpc };
    onStatus("loading");
  }

  return {
    readLine(prompt) {
      if (disposed) return Promise.reject(new Error("repl disposed"));
      if (reading) return Promise.reject(new Error("이미 읽는 중"));
      reading = true;
      return readline.read(prompt).finally(() => {
        reading = false;
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      // 알림 핸들러가 dispose된 줄 편집기에 쓰지 않도록 RPC를 먼저 끊는다.
      session?.rpc.dispose();
      session?.worker.terminate();
      // 벤더 dispose가 멱등이라 term.dispose()가 addon을 다시 dispose해도 안전하다.
      readline.dispose();
    },
    get crossOriginIsolated() {
      return isolated;
    },
  };
}
