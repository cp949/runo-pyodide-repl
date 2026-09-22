import { Readline } from "@cp949/runo-xterm-readline";
import type { Terminal } from "@xterm/xterm";
import { postInitFrame, type InitFrame } from "./protocol/init-frame";
import { createInterruptBuffer } from "./protocol/interrupt-protocol";
import { createInterruptSender } from "./protocol/interrupt-sender";
import { createRpc, type Rpc } from "./protocol/rpc";
import {
  createMailboxWriter,
  createStdinMailbox,
} from "./protocol/stdin-mailbox";
import { writeNotice } from "./terminal/notice";
import { createReadGuard } from "./terminal/read-guard";
import { createReplReader } from "./terminal/repl-reader";
import type { RewindTerminal } from "./terminal/rewind-tail";
import { createTerminalSinks } from "./terminal/sinks";
import { createInputReader } from "./terminal/stdin-reader";

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
  // history는 세션(마운트) 동안 메모리에만 둔다. 새로고침 뒤에는 비어 있어야 한다.
  const readline = new Readline({ persist: false });
  options.terminal.loadAddon(readline);
  const onStatus = options.onStatus ?? (() => {});
  const isolated = globalThis.crossOriginIsolated === true;

  let disposed = false;
  let session: { worker: Worker; rpc: Rpc; endSession: () => void } | undefined;

  if (!isolated) {
    // SharedArrayBuffer가 없어 초기화 프레임을 만들 수 없다(ADR-0004, TRP-002). 폴백은 없다.
    writeNotice(readline, NOT_ISOLATED_WARNING, "warning");
    onStatus("not-isolated");
  } else {
    // sink 세트는 세션마다 새로 만든다. 새 세션이 이전 꼬리를 물려받지 않게(05-output.md 4.1).
    const sinks = createTerminalSinks(readline);
    // xterm의 write 콜백은 `term.dispose()` 뒤에도 돈다(TRP-004). `rewindTail`이 flush 콜백에서 해제된 터미널의
    // buffer를 읽지 않도록, dispose 뒤에는 콜백을 전달하지 않는 뷰를 리더에 준다.
    const liveTerminal: RewindTerminal = {
      get cols() {
        return options.terminal.cols;
      },
      get buffer() {
        return options.terminal.buffer;
      },
      write: (text, callback) =>
        options.terminal.write(
          text,
          callback &&
            (() => {
              if (!disposed) callback();
            }),
        ),
    };
    const replReader = createReplReader(readline, liveTerminal, sinks);
    // stdin 리더도 같은 뷰를 받는다: `rewindTail`의 flush 콜백이 해제된 터미널의 buffer를 읽지 않게(TRP-004).
    const inputReader = createInputReader(readline, liveTerminal, sinks);
    // 프롬프트를 기다리는 동안 worker의 배경 콜백이 `input()`을 부르면 stdin 읽기가 REPL 읽기를 교체해 REPL 읽기가
    // 고아가 된다. stdin 읽기를 활성 REPL 읽기가 끝난 뒤로 미룬다(04-stdin-input.md 3.2).
    const guard = createReadGuard({
      readLine: (prompt: string) => replReader.read(prompt),
      readInput: () => inputReader.read(),
    });
    // 벤더 `Readline`은 열린 읽기를 교체하고 앞 promise를 끝내지 않는다. worker 루프는 응답을 받은 뒤에만 다시
    // 요청하므로 겹치는 요청은 오류로 거절한다.
    let reading = false;
    // 프레임에 넣는 것과 같은 SharedArrayBuffer 뷰를 송신기도 쓴다(RD-010 리셋이 이 버퍼를 재사용한다).
    const interruptBuffer = createInterruptBuffer();
    const interruptSender = createInterruptSender(interruptBuffer);
    // worker가 살아 있다. `sessionTerminated`·`loadFailed`·`dispose()`에서 거짓이 된다(리셋은 RD-010).
    let alive = true;
    // 수락한 `readLine` 요청의 읽기가 끝나기 전(응답이 포트에 올라가기 전).
    let readLinePending = false;
    // `readInput` 알림이 도착한 뒤 `deliver`/`fail`이 끝나기 전. worker는 그동안 메일박스에 정지해 있다.
    let inputReadsPending = 0;
    /**
     * main이 보는 "Python 실행 중"(03-ctrl-c.md 2.7). 거짓이면 눌림이 닿을 대상 코드가 없으므로 Ctrl+C를 에코도
     * 전송도 하지 않는다. 로딩 중(`ready` 전)은 참이다 — 부팅 중 눌림은 버퍼에 남고 worker의 연결 단계가 폐기한다(2.6).
     * `readLine` 응답 뒤~다음 요청 전(배경 콜백이 CPU를 잡는 구간)도 참이다(편차 2).
     */
    const pythonRunning = () =>
      alive && !readLinePending && inputReadsPending === 0;
    /**
     * 이 worker에서 실행할 코드가 더 없어진 지점(`exit()`·로드 실패·`dispose()`). 게이트를 닫고 재전송을 멈춘다.
     * 닫지 않으면 잔류 SIGNAL 2를 아무도 소비하지 않아 송신기가 5ms마다 영원히 점검한다(RD-012h(a)).
     */
    const endSession = () => {
      alive = false;
      interruptSender.cancel();
    };
    // 벤더 `Readline`은 활성 읽기가 없을 때만 부른다(읽기 중 Ctrl+C는 벤더가 같은 프롬프트를 다시 그린다).
    readline.setCtrlCHandler(() => {
      if (!pythonRunning()) return;
      // tty 로컬 에코 흉내. 개행 없이 꼬리에 남아 다음 프롬프트·`input()` 프롬프트가 이어 그려진다(`t^Cx: `).
      sinks.write("^C");
      interruptSender.send();
    });
    const channel = new MessageChannel();
    const mailbox = createStdinMailbox();
    const mailboxWriter = createMailboxWriter(mailbox);
    const frame: InitFrame = {
      kind: "init",
      rpcPort: channel.port2,
      interruptBuffer,
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
      // 꼬리 + 프롬프트를 그리고 Enter까지 한 줄을 읽어 응답한다. 요청의 나머지 인자(pending, cancelable)는 후속
      // RD(RD-013·014·015, RD-008)가 쓴다. 지금은 받지 않고 버린다.
      readLine: (prompt: string): Promise<string | null> => {
        // 요청이 온 순간 worker는 실행을 멈추고 줄을 기다린다. 보낸 눌림의 재전송은 여기서 멈춘다(03-ctrl-c.md 2.3).
        interruptSender.cancel();
        // 거절은 가드 바깥에서 한다. 거절된 promise를 가드가 활성 읽기로 추적하면 진짜 활성 REPL 읽기를 잃는다.
        if (reading) return Promise.reject(new Error("이미 읽는 중"));
        reading = true;
        readLinePending = true;
        return guard.readLine(prompt).finally(() => {
          reading = false;
          // 응답이 포트에 올라가기 전에 내린다: worker는 응답을 받는 대로 실행을 재개한다.
          readLinePending = false;
        });
      },
      // stdin 콜백 진입(worker는 이 알림 직후 메일박스에 정지한다). 응답 통로가 메일박스뿐이라 반환값이 없다.
      // `cancelable` 인자는 받지 않는다(RD-008이 취소를 넣을 때 쓴다).
      readInput: () => {
        // 이 알림 직후 worker는 메일박스에 정지한다. 보낸 눌림의 재전송을 멈춘다(03-ctrl-c.md 2.3).
        interruptSender.cancel();
        inputReadsPending += 1;
        void guard
          .readInput()
          .then(
            (line) => mailboxWriter.deliver(line),
            // dispose된 세션의 worker는 이미 terminate됐다. `fail()`의 `untilIdle`이 영영 안 풀릴 수 있어 쓰지 않는다.
            (error: unknown) =>
              disposed ? undefined : mailboxWriter.fail(String(error)),
          )
          .catch((error: unknown) =>
            console.error("[repl] stdin 응답 실패", error),
          )
          .finally(() => {
            // `deliver`/`fail`이 끝난 뒤에 내린다: 그 시점이 worker가 깨어나 실행을 재개하는 시점이다.
            inputReadsPending -= 1;
          });
      },
      // 종료는 터미널에 쓰지 않는다(3.14도 종료 메시지가 없다). worker는 살려 두고 복구는 RD-010 `reset()`이다.
      sessionTerminated: () => {
        endSession();
        onStatus("terminated");
      },
      ready: ({ pyodideVersion }: { pyodideVersion: string }) => {
        console.info("[repl] pyodide 준비", pyodideVersion);
        onStatus("ready");
      },
      // worker는 죽지 않는다. 접두사는 main이 붙이고 빨강 한 줄로 낸다(01-protocols.md 1.2).
      loadFailed: (message: string) => {
        endSession();
        sinks.writeError(`pyodide 로드 실패: ${message}`);
        onStatus("load-failed");
      },
    });
    const worker = options.createWorker();
    postInitFrame(worker, frame);
    session = { worker, rpc, endSession };
    onStatus("loading");
  }

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      // 게이트를 닫고 재전송을 멈춘다. 이후 도착하는 키·알림은 눌림을 보내지 않는다.
      session?.endSession();
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
