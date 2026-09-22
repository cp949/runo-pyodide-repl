/**
 * 세션 하나(worker 1개)가 필요로 하는 자원·게이트(`00-architecture.md` 4.2). `reset()`(RD-010)이 통째로
 * 교체하는 단위다. 핸들(`index.ts`)이 소유하는 `readline`·`interruptBuffer`·`interruptSender`·Ctrl+C 핸들러는
 * 세션을 넘어 산다.
 */
import { ReadCancelledError } from "@cp949/runo-xterm-readline";
import type { Readline } from "@cp949/runo-xterm-readline";
import type { Terminal } from "@xterm/xterm";
import type { ReplStatus } from "./index";
import { postInitFrame, type InitFrame } from "./protocol/init-frame";
import type { InterruptSender } from "./protocol/interrupt-sender";
import { createRpc, type Rpc } from "./protocol/rpc";
import {
  createMailboxWriter,
  createStdinMailbox,
} from "./protocol/stdin-mailbox";
import { createReadGuard } from "./terminal/read-guard";
import { createReplReader } from "./terminal/repl-reader";
import type { RewindTerminal } from "./terminal/rewind-tail";
import { createTerminalSinks } from "./terminal/sinks";
import { createInputReader } from "./terminal/stdin-reader";

export interface StartSessionOptions {
  /** 핸들 소유. 세션을 넘어 산다(history 유지). */
  readline: Readline;
  /** 호출자가 소유하는 xterm `Terminal`. */
  terminal: Terminal;
  /** 핸들 소유. 리셋이 새 세션에도 같은 버퍼를 싣는다. */
  interruptBuffer: Int32Array;
  /** 핸들 소유. */
  interruptSender: InterruptSender;
  /** 세션마다 불린다. */
  createWorker: () => Worker;
  /** 끝 `/`가 붙은 pyodide CDN 위치. */
  indexURL: string;
  /** 초기화 프레임에 그대로 싣는다. 값을 바꾸려면 새 세션(RD-012). */
  topLevelAwait: boolean;
  /** 상태가 바뀔 때 부른다. */
  onStatus: (status: ReplStatus) => void;
  /** worker `error` 이벤트 또는 `crashed` 알림(첫 신호만) 뒤 부른다. */
  onCrash?: (message: string) => void;
}

export interface ReplSession {
  /** main이 보는 "Python 실행 중"(`03-ctrl-c.md` 2.7). 거짓이면 Ctrl+C를 에코도 전송도 하지 않는다. */
  pythonRunning(): boolean;
  /** 세션의 sink로 `^C`를 에코한다(핸들의 Ctrl+C 핸들러가 부른다. tty 로컬 에코 흉내, 꼬리 추적에 반영). */
  echoCtrlC(): void;
  /**
   * 이 세션에서 실행할 코드가 더 없어진 지점(`exit()`·로드 실패). 게이트를 닫고 재전송을 멈춘다. 닫지 않으면
   * 잔류 SIGNAL 2를 아무도 소비하지 않아 송신기가 5ms마다 영원히 점검한다(RD-012h(a)).
   */
  endSession(): void;
  /**
   * 옛 읽기를 끝내고(`readline.cancelRead()`) 세션 자원을 정리한다: `ended=true` → `cancelRead()` →
   * `endSession()` → `rpc.dispose()` → `worker.terminate()`.
   */
  terminate(): void;
  /** `terminate()` 뒤 참. */
  readonly ended: boolean;
}

export function startSession(options: StartSessionOptions): ReplSession {
  const {
    readline,
    terminal,
    interruptBuffer,
    interruptSender,
    createWorker,
    indexURL,
    topLevelAwait,
    onStatus,
    onCrash,
  } = options;

  let ended = false;
  // 크래시 신호(worker error 이벤트·crashed 알림)는 먼저 온 것만 반영한다(확정 1).
  let crashed = false;
  // sink 세트는 세션마다 새로 만든다. 새 세션이 이전 꼬리를 물려받지 않게(05-output.md 4.1).
  const sinks = createTerminalSinks(readline);
  // xterm의 write 콜백은 `term.dispose()` 뒤에도 돈다(TRP-004). `rewindTail`이 flush 콜백에서 해제된 터미널의
  // buffer를 읽지 않도록, 세션이 끝난 뒤에는 콜백을 전달하지 않는 뷰를 리더에 준다.
  const liveTerminal: RewindTerminal = {
    get cols() {
      return terminal.cols;
    },
    get buffer() {
      return terminal.buffer;
    },
    write: (text, callback) =>
      terminal.write(
        text,
        callback &&
          (() => {
            if (!ended) callback();
          }),
      ),
  };
  const replReader = createReplReader(readline, liveTerminal, sinks);
  // stdin 리더도 같은 뷰를 받는다: `rewindTail`의 flush 콜백이 해제된 터미널의 buffer를 읽지 않게(TRP-004).
  const inputReader = createInputReader(readline, liveTerminal, sinks);
  // 프롬프트를 기다리는 동안 worker의 배경 콜백이 `input()`을 부르면 stdin 읽기가 REPL 읽기를 교체해 REPL 읽기가
  // 고아가 된다. stdin 읽기를 활성 REPL 읽기가 끝난 뒤로 미룬다(04-stdin-input.md 3.2).
  const guard = createReadGuard({
    readLine: (prompt: string, cancelable: boolean) =>
      replReader.read(prompt, cancelable),
    readInput: (cancelable: boolean) => inputReader.read(cancelable),
  });
  // 벤더 `Readline`은 열린 읽기를 교체하고 앞 promise를 끝내지 않는다. worker 루프는 응답을 받은 뒤에만 다시
  // 요청하므로 겹치는 요청은 오류로 거절한다.
  let reading = false;
  // 세션이 살아 있다. `sessionTerminated`·`loadFailed`·`terminate()`에서 거짓이 된다.
  let alive = true;
  // 수락한 `readLine` 요청의 읽기가 끝나기 전(응답이 포트에 올라가기 전).
  let readLinePending = false;
  // `readInput` 알림이 도착한 뒤 `deliver`/`fail`이 끝나기 전. worker는 그동안 메일박스에 정지해 있다.
  let inputReadsPending = 0;
  /**
   * REPL 읽기를 취소(`null` 응답)한 뒤 다음 요청이 도착하기 전. 이 구간에는 벤더에 활성 읽기가 없어 Ctrl+C가
   * `setCtrlCHandler`로 오는데, 그 눌림을 보내면 아무도 소비하지 않은 SIGINT가 남아 다음 `push`가 죽는다(TRP-009).
   * `readLine` 도착·`readInput` 도착·`inputReadsPending → 0`에서 내린다(= worker가 코드를 돌리기 시작하는 모든 지점).
   * `input()` 취소에는 세우지 않는다: 취소 뒤 사용자 코드(`except KeyboardInterrupt` 뒤 계산)가 계속 돌므로 그
   * 구간의 Ctrl+C는 중단이어야 한다.
   */
  let cancelSettling = false;
  /**
   * main이 보는 "Python 실행 중"(03-ctrl-c.md 2.7). 거짓이면 눌림이 닿을 대상 코드가 없으므로 Ctrl+C를 에코도
   * 전송도 하지 않는다. 로딩 중(`ready` 전)은 참이다 — 부팅 중 눌림은 버퍼에 남고 worker의 연결 단계가 폐기한다(2.6).
   * `readLine` 응답 뒤~다음 요청 전(배경 콜백이 CPU를 잡는 구간)도 참이다(편차 2). 단, 그 응답이 취소였으면
   * `cancelSettling`이 막는다.
   */
  const pythonRunning = () =>
    alive && !readLinePending && inputReadsPending === 0 && !cancelSettling;
  const endSession = () => {
    alive = false;
    interruptSender.cancel();
  };
  /**
   * worker가 죽었거나(전역 `error`) 부팅 뒤 루프가 잡히지 않은 예외로 끝났을 때(`crashed` 알림) 부른다. 첫 신호만
   * 반영한다(확정 1). 터미널에는 쓰지 않는다 — 앱의 Alert가 보여준다(확정 9). worker는 terminate하지 않는다(복구는
   * `reset()`).
   */
  const crash = (message: string) => {
    if (ended || crashed) return;
    crashed = true;
    endSession();
    onStatus("crashed");
    onCrash?.(message);
  };
  const channel = new MessageChannel();
  const mailbox = createStdinMailbox();
  const mailboxWriter = createMailboxWriter(mailbox);
  const frame: InitFrame = {
    kind: "init",
    rpcPort: channel.port2,
    interruptBuffer,
    stdinCtrl: mailbox.ctrl,
    stdinData: mailbox.data,
    topLevelAwait,
    pyodide: { indexURL },
  };
  const rpc: Rpc = createRpc(channel.port1, {
    write: (text: string) => sinks.write(text),
    writeErrorRaw: (text: string) => sinks.writeErrorRaw(text),
    writeOutput: (text: string) => sinks.writeOutput(text),
    writeError: (text: string) => sinks.writeError(text),
    // 꼬리 + 프롬프트를 그리고 Enter까지 한 줄을 읽어 응답한다. 취소(Ctrl+C)는 `null` 응답이고, worker의 루프가
    // `run(null)`로 `KeyboardInterrupt`를 낸다. `pending`은 후속 RD(RD-013·014·015)가 쓰는 위치 인자다.
    readLine: (
      prompt: string,
      _pending: string | undefined,
      cancelable: boolean,
    ): Promise<string | null> => {
      // 요청이 온 순간 worker는 실행을 멈추고 줄을 기다린다. 보낸 눌림의 재전송은 여기서 멈춘다(03-ctrl-c.md 2.3).
      interruptSender.cancel();
      // 요청이 도착했다 = worker가 다음 줄을 기다린다. 앞 취소의 방어 구간이 여기서 끝난다.
      cancelSettling = false;
      // 거절은 가드 바깥에서 한다. 거절된 promise를 가드가 활성 읽기로 추적하면 진짜 활성 REPL 읽기를 잃는다.
      if (reading) return Promise.reject(new Error("이미 읽는 중"));
      reading = true;
      readLinePending = true;
      return guard.readLine(prompt, cancelable).then(
        (line) => {
          reading = false;
          // 응답이 포트에 올라가기 전에 내린다: worker는 응답을 받는 대로 실행을 재개한다.
          readLinePending = false;
          // 취소 응답 뒤에는 다음 요청이 도착할 때까지 게이트를 닫는다(TRP-009).
          if (line === null) cancelSettling = true;
          return line;
        },
        (error: unknown) => {
          reading = false;
          readLinePending = false;
          // reset()의 cancelRead()로 끝난 옛 읽기는 응답 없이 조용히 끝낸다(확정 10) — 이 세션의 worker는
          // 이미 종료 중이라 응답을 기다리지 않는다. 영영 풀리지 않는 promise를 돌려 rpc가 응답을 보내지 않게 한다.
          if (error instanceof ReadCancelledError)
            return new Promise<string | null>(() => {});
          throw error;
        },
      );
    },
    // stdin 콜백 진입(worker는 이 알림 직후 메일박스에 정지한다). 응답 통로가 메일박스뿐이라 반환값이 없다.
    // 취소(Ctrl+C)는 `mailbox.cancel()`이고, worker의 stdin 콜백이 그것을 `KeyboardInterrupt`로 바꾼다.
    readInput: (cancelable: boolean) => {
      // 이 알림 직후 worker는 메일박스에 정지한다. 보낸 눌림의 재전송을 멈춘다(03-ctrl-c.md 2.3).
      interruptSender.cancel();
      // 알림이 도착했다 = worker가 사용자 코드 안에서 입력을 기다린다. 앞 취소의 방어 구간이 여기서 끝난다.
      cancelSettling = false;
      inputReadsPending += 1;
      void guard
        .readInput(cancelable)
        .then(
          (line) =>
            line === null
              ? mailboxWriter.cancel()
              : mailboxWriter.deliver(line),
          (error: unknown) => {
            // reset()의 cancelRead()로 끝난 옛 읽기는 메일박스에 아무것도 남기지 않는다(확정 10).
            if (error instanceof ReadCancelledError) return undefined;
            // 세션이 끝난 뒤의 worker는 이미 terminate됐다. `fail()`의 `untilIdle`이 영영 안 풀릴 수 있어
            // 쓰지 않는다(TRP-003, 확정 14).
            return ended ? undefined : mailboxWriter.fail(String(error));
          },
        )
        .catch((error: unknown) =>
          console.error("[repl] stdin 응답 실패", error),
        )
        .finally(() => {
          // `deliver`/`cancel`/`fail`이 끝난 뒤에 내린다: 그 시점이 worker가 깨어나 실행을 재개하는 시점이다.
          inputReadsPending -= 1;
          // 재개 지점이므로 앞 취소의 방어도 함께 내린다(`input()` 취소 뒤 계산 중단이 막히지 않게).
          cancelSettling = false;
        });
    },
    // 종료는 터미널에 쓰지 않는다(3.14도 종료 메시지가 없다). worker는 살려 두고 복구는 `reset()`이다.
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
    // 부팅 뒤(REPL 루프)의 잡히지 않은 예외(01-protocols.md 1.2). worker는 살아 있을 수 있다.
    crashed: ({ message }: { message: string }) => crash(message),
  });
  const worker = createWorker();
  // worker 스레드 자체가 죽은 경우(crashed 알림이 오지 않는 실패)를 보완한다(01-protocols.md 1.2).
  const onWorkerError = (event: ErrorEvent) => {
    crash(event.message || "worker가 알 수 없는 이유로 종료됨");
  };
  worker.addEventListener("error", onWorkerError);
  postInitFrame(worker, frame);

  return {
    pythonRunning,
    echoCtrlC() {
      sinks.write("^C");
    },
    endSession,
    terminate() {
      ended = true;
      readline.cancelRead();
      endSession();
      worker.removeEventListener("error", onWorkerError);
      rpc.dispose();
      worker.terminate();
    },
    get ended() {
      return ended;
    },
  };
}
