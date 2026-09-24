/**
 * REPL main driver(RD-020). core 세션(`startCoreSession`, `@cp949/runo-pyodide-core`)이 worker·프레임·RPC·`readInput` 처리·게이트를
 * 맡고, 이 모듈은 REPL 화면 상호작용을 낸다: sink·줄 편집 정책(`autoIndent`·`blockHistory`·`tabReader`)·리더(`replReader`·
 * `inputReader`)·읽기 가드, RPC 핸들러 `readLine`·`writeOutput`·`writeError`, 게이트 재료(`isIdle` = `readLinePending || cancelSettling`),
 * 종료 시 읽기 정리. 세션마다 새로 만든다(`00-architecture.md` 4.2, `08-session.md` 8.1).
 */
import { ReadCancelledError } from "@cp949/runo-xterm-readline";
import type { Readline } from "@cp949/runo-xterm-readline";
import type { Terminal } from "@xterm/xterm";
import type { InterruptSender, MainDriver, OutputChunk } from "@cp949/runo-pyodide-core";
import type { ReplDriverOptions } from "./driver-options";
import { createAutoIndent } from "./terminal/auto-indent";
import { createBlockHistory } from "./terminal/block-history";
import { mergeReadOptions } from "./terminal/read-options";
import { createReadGuard } from "./terminal/read-guard";
import { createReplReader } from "./terminal/repl-reader";
import type { RewindTerminal } from "./terminal/rewind-tail";
import { createTerminalSinks } from "./terminal/sinks";
import { createInputReader } from "./terminal/stdin-reader";
import { createTabReader } from "./terminal/tab-reader";
import type { SourceCompletion } from "./worker/complete-source";

export interface ReplMainDriverOptions {
  /** 핸들 소유. 세션을 넘어 산다(history 유지). */
  readline: Readline;
  /** 호출자가 소유하는 xterm `Terminal`. */
  terminal: Terminal;
  /** 핸들 소유. `readLine`·`readInput` 도착과 Tab 취소가 부른다. */
  interruptSender: InterruptSender;
  /** 초기화 프레임 `driver` 필드로 실린다. */
  topLevelAwait: boolean;
  /**
   * worker의 `complete`를 부른다(core 세션의 `call`). 실제 Tab을 누를 때(세션이 이미 시작된 뒤)만 실행되므로 core 세션을
   * 이 함수가 늦게 참조해도 된다.
   */
  complete: (source: string, pending: string | undefined) => Promise<SourceCompletion>;
}

export interface ReplMainDriver {
  /** core 세션에 넘기는 driver. */
  driver: MainDriver;
  /** core 출력 계약 `{ stream, text }` → sink. stdout은 `write`, stderr는 `writeErrorRaw`(원문). */
  output(chunk: OutputChunk): void;
  /** 세션의 sink로 `^C`를 에코한다(tty 로컬 에코 흉내, 꼬리 추적에 반영). */
  echoCtrlC(): void;
}

export function createReplMainDriver(
  options: ReplMainDriverOptions,
): ReplMainDriver {
  const { readline, terminal, interruptSender, topLevelAwait, complete } =
    options;

  // 종료(`terminate` 훅) 뒤 참. core의 `ended`와 같은 시점에 선다(core가 먼저 세우고 훅을 부른다).
  let ended = false;
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
  // 세션 소유: lastUsedIndentation은 이 세션 동안 유지되고, reset()이 새 세션(새 객체)을 만들면 4칸으로
  // 돌아간다(08-session.md 8.1, 확정 3).
  const autoIndent = createAutoIndent(readline);
  // 세션 소유: 기준점·pendingBlock은 세션과 함께 버려진다. 리셋 시 대기 중 블록은 `terminate()`가
  // 버린다(08-session.md 8.1).
  const blockHistory = createBlockHistory(readline);
  // 세션 소유: 세대·큐·왕복 상태(`requesting`)는 이 세션 동안 유지된다(RD-015 DELTA-04). `complete`는 core 세션의
  // `call`을 클로저로 참조한다 — 이 클로저는 실제 Tab을 누를 때(세션이 이미 시작된 뒤)만 실행되므로 선언 순서는 문제가 되지
  // 않는다(TS는 중첩 함수 안의 참조에 TDZ를 적용하지 않는다).
  const tabReader = createTabReader(readline, {
    complete,
    interruptCompletion: () => interruptSender.send(),
  });
  const replReader = createReplReader(readline, liveTerminal, sinks, (pending) =>
    mergeReadOptions(
      blockHistory.readOptions(pending),
      autoIndent.readOptions(pending),
      tabReader.readOptions(pending),
    ),
  );
  // stdin 리더도 같은 뷰를 받는다: `rewindTail`의 flush 콜백이 해제된 터미널의 buffer를 읽지 않게(TRP-004).
  const inputReader = createInputReader(readline, liveTerminal, sinks);
  // 프롬프트를 기다리는 동안 worker의 배경 콜백이 `input()`을 부르면 stdin 읽기가 REPL 읽기를 교체해 REPL 읽기가
  // 고아가 된다. stdin 읽기를 활성 REPL 읽기가 끝난 뒤로 미룬다(04-stdin-input.md 3.2).
  const guard = createReadGuard({
    readLine: (prompt: string, pending: string | undefined, cancelable: boolean) =>
      replReader.read(prompt, pending, cancelable),
    readInput: (cancelable: boolean) => inputReader.read(cancelable),
  });
  // 벤더 `Readline`은 열린 읽기를 교체하고 앞 promise를 끝내지 않는다. worker 루프는 응답을 받은 뒤에만 다시
  // 요청하므로 겹치는 요청은 오류로 거절한다.
  let reading = false;
  // 수락한 `readLine` 요청의 읽기가 끝나기 전(응답이 포트에 올라가기 전).
  let readLinePending = false;
  /**
   * REPL 읽기를 취소(`null` 응답)한 뒤 다음 요청이 도착하기 전. 이 구간에는 벤더에 활성 읽기가 없어 Ctrl+C가
   * `setCtrlCHandler`로 오는데, 그 눌림을 보내면 아무도 소비하지 않은 SIGINT가 남아 다음 `push`가 죽는다(TRP-009).
   * `readLine` 도착·`readInput` 도착(`inputRequested`)·`inputReadsPending → 0`(`inputResumed`)에서 내린다(= worker가 코드를
   * 돌리기 시작하는 모든 지점). `input()` 취소에는 세우지 않는다: 취소 뒤 사용자 코드(`except KeyboardInterrupt` 뒤
   * 계산)가 계속 돌므로 그 구간의 Ctrl+C는 중단이어야 한다.
   */
  let cancelSettling = false;

  const driver: MainDriver = {
    options: { topLevelAwait } satisfies ReplDriverOptions,
    handlers: {
      writeOutput: (text: string) => sinks.writeOutput(text),
      writeError: (text: string) => sinks.writeError(text),
      // 꼬리 + 프롬프트를 그리고 Enter까지 한 줄을 읽어 응답한다. 취소(Ctrl+C)는 `null` 응답이고, worker의 루프가
      // `run(null)`로 `KeyboardInterrupt`를 낸다. `pending`은 자동 들여쓰기 프리필의 재료다(RD-013).
      readLine: (
        prompt: string,
        pending: string | undefined,
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
        return guard.readLine(prompt, pending, cancelable).then(
          (line) => {
            reading = false;
            // 응답이 포트에 올라가기 전에 내린다: worker는 응답을 받는 대로 실행을 재개한다.
            readLinePending = false;
            // 이번 세대의 읽기가 끝났다(Enter·취소 둘 다). 왕복 중 취소됐으면 여기서 인터럽트가 나간다.
            tabReader.readEnded(line);
            // 취소 응답 뒤에는 다음 요청이 도착할 때까지 게이트를 닫는다(TRP-009).
            if (line === null) {
              cancelSettling = true;
              // 취소한 블록은 첫 줄까지 history에서 지운다(06-editing.md 6.4). worker 쪽 `run(null)`의
              // `clearPending()`과 짝.
              blockHistory.discard();
            }
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
    },
    /**
     * core 게이트 `pythonRunning = alive && inputReadsPending === 0 && !isIdle()`의 재료. 프롬프트 입력을 기다리는 동안
     * (`readLinePending`)과 취소 응답 뒤 다음 요청 전(`cancelSettling`)은 눌림이 닿을 대상 코드가 없다. `readLine` 응답 뒤~
     * 다음 요청 전(배경 콜백이 CPU를 잡는 구간)은 유휴가 아니다(편차 2). 단, 그 응답이 취소였으면 `cancelSettling`이 막는다.
     */
    isIdle: () => readLinePending || cancelSettling,
    readInput: (cancelable) => guard.readInput(cancelable),
    // reset()의 cancelRead()로 끝난 옛 읽기(확정 10).
    isReadCancelled: (error) => error instanceof ReadCancelledError,
    // 알림이 도착했다 = worker가 사용자 코드 안에서 입력을 기다린다. 앞 취소의 방어 구간이 여기서 끝난다.
    inputRequested: () => {
      cancelSettling = false;
    },
    // 재개 지점이므로 앞 취소의 방어도 함께 내린다(`input()` 취소 뒤 계산 중단이 막히지 않게).
    inputResumed: () => {
      cancelSettling = false;
    },
    // 호환 경고는 core 세션이 이미 냈다(문제가 있을 때만). 여기서는 버전 정보 로그만 남긴다.
    onReady: (payload) => {
      console.info("[repl] pyodide 준비", payload.pyodideVersion);
    },
    // worker는 죽지 않는다. 접두사는 main이 붙이고 빨강 한 줄로 낸다(01-protocols.md 1.2).
    onLoadFailed: (message) => {
      sinks.writeError(`pyodide 로드 실패: ${message}`);
    },
    terminate: () => {
      ended = true;
      // REPL 읽기가 열려 있으면 입력을 기다리던 블록이다 — 버린다. 실행 중·`exit()`로 끝난 블록은
      // `reading`이 거짓이라 남는다(확정 5). `reading`은 REPL 읽기 전용(`readInput`은 별도).
      if (reading) blockHistory.discard();
      // tabReader를 동기로 끝낸다(ended=true, queuedTabs=[]) — 뒤이은 core의 rpc.dispose()가 대기 중인
      // complete 요청을 reject하면 `.catch().finally(drainQueue)`가 마이크로태스크에서 큐를 다시
      // 처리하려 든다. 여기서 먼저 끝내 두지 않으면 그 처리가 취소된 세션의 buffer/cursor를 읽어
      // (cancelRead()는 state를 건드리지 않는다) 엉뚱한 삽입을 터미널에 쓴다(DELTA-04a
      // Important-2). requesting이 참이면 interruptCompletion()(=interruptSender.send())도
      // 함께 불리는데 뒤이어 worker.terminate()가 오므로 무해하다.
      tabReader.readEnded(null);
      readline.cancelRead();
    },
  };

  return {
    driver,
    output: ({ stream, text }) => {
      if (stream === "stdout") sinks.write(text);
      else sinks.writeErrorRaw(text);
    },
    echoCtrlC() {
      sinks.write("^C");
    },
  };
}
