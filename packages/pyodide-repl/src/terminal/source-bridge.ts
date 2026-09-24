/**
 * `runSource(code)`의 main driver 쪽 조율(RD-022a, 확정 1·6~13). 세션(worker)마다 하나. 핸들의 슬롯(`SourceLink`)과 `readLine` 핸들러·
 * 줄 편집기(`takeRead`)·꼬리 추적을 잇는다.
 *
 * 흐름(프롬프트가 열려 있을 때): `send(code)`가 열린 읽기를 `takeRead()`로 가져가(제출·history 없이, 프롬프트·입력 행을 지운다) 텍스트·
 * 커서를 보존하고 → 그 읽기가 `ReadTakenError`로 끝나면 `readLine` 핸들러가 `taken()`으로 응답을 `{ source }`로 만든다 → worker가 실행하고
 * 결말을 다음 `readLine` 요청에 싣는다 → `request()`가 결말을 슬롯에 알리고 → 보존한 줄을 `prefill`·`prefillCursor`로 복원한 읽기가
 * 화면에 그려진 뒤(`readOpened`의 write 콜백) 슬롯이 결말로 resolve한다(확정 9).
 * 첫 프롬프트 전(`loading`)에 대기하던 코드는 첫 요청에서 읽기를 열지 않고 바로 `{ source }`로 응답한다(`request()`).
 *
 * 벤더는 프롬프트 전체(꼬리 `a>>> `의 `a` 포함)를 지우므로 그린 뒤 지워진 꼬리를 이 모듈이 다시 쓴다(확정 11, 판단 허용 6).
 */
import { ReadTakenError } from "@cp949/runo-xterm-readline";
import type { Readline } from "@cp949/runo-xterm-readline";
import type { RewindTerminal, TerminalSinks } from "@cp949/runo-pyodide-terminal/internal";
import type { ReadLineOutcome, ReadLineSourceReply } from "../repl-protocol";
import type { SourceLink } from "../run-source";
import type { ReplReadOptions } from "./read-options";

/**
 * 지금 `runSource`를 받아들일 수 있는가. `wait` = 첫 프롬프트 전(`loading`, 슬롯이 기다린다), `open` = 프롬프트가 화면에 그려져 있고
 * 입력을 기다린다(가져갈 수 있다), `busy` = 그 밖(블록 입력·Python 실행·`input()` 대기·Tab 왕복·프롬프트가 그려지기 전).
 */
export type SourcePrompt = "wait" | "busy" | "open";

export interface SourceBridgeDeps {
  readline: Pick<Readline, "takeRead">;
  /** 화면 쓰기 순서를 재는 데 쓴다(`write("", cb)` 콜백은 앞선 쓰기·벤더 읽기 그리기 뒤에 온다). */
  terminal: Pick<RewindTerminal, "write">;
  sinks: Pick<TerminalSinks, "write" | "tail">;
  /** Tab `complete` 왕복이 진행 중인가. 왕복 중에는 `printAbove` 재그리기가 낄 수 있어 가져가지 않는다. */
  tabRequesting(): boolean;
  link: SourceLink;
}

export interface SourceBridge {
  /**
   * `readLine` 요청이 도착했다(겹침 거절을 통과한 요청). 결말이 실려 왔으면 슬롯에 알리고 복원한 읽기가 그려지면 정착하도록 예약한다.
   * 대기 슬롯을 실행하는 요청이면 읽기를 열지 않고 돌려줄 응답 `{ source }`를 준다. 그 밖에는 `undefined`(평소 읽기).
   */
  request(info: {
    pending: string | undefined;
    outcome: ReadLineOutcome | undefined;
  }): ReadLineSourceReply | undefined;
  /** 평소 읽기를 시작한다(`readLine` 핸들러가 `guard.readLine`을 부르기 직전). */
  readStarting(): void;
  /** REPL reader가 `readline.read()`를 열었다. `tail`은 프롬프트 앞에 붙인 꼬리다. */
  readOpened(read: Promise<unknown>, tail: string): void;
  /** 합성한 읽기 옵션에 복원할 줄(텍스트·커서)을 덮어쓴다. 읽기마다 한 번 부른다. */
  restoreOptions(options: ReplReadOptions): ReplReadOptions;
  /** 읽기 rejection이 `takeRead()` 때문이면 그 코드를 담은 응답을 준다. 아니면 `undefined`. */
  taken(error: unknown): ReadLineSourceReply | undefined;
  /** worker의 `input()` 읽기 알림 도착·응답 완료. 프롬프트가 열린 채 배경 `input()`이 대기하면 가져가지 않는다. */
  inputRequested(): void;
  inputResumed(): void;
  /** `runSource()` 거부 판정과 `busy` 게터가 함께 쓰는 재료(부작용 없음). */
  prompt(): SourcePrompt;
  /** 열린 읽기를 가져가고 화면을 준비한다. 받아들일 수 없으면 아무것도 하지 않고 `false`. */
  send(code: string): boolean;
}

export function createSourceBridge(deps: SourceBridgeDeps): SourceBridge {
  const { readline, terminal, sinks, link } = deps;

  // 첫 `readLine` 요청이 도착했다(그 전에는 `loading`).
  let sawRequest = false;
  // 최근 요청이 블록 입력(`... `)인가(`pending !== undefined`).
  let blockPending = false;
  // 열린 읽기의 단계. `opening` = 요청을 수락했고 아직 그려지지 않았다, `open` = 그려져 입력을 기다린다.
  let readState: "none" | "opening" | "open" = "none";
  // 읽기마다 오른다. 끝난 읽기의 늦은 콜백을 버린다.
  let readSeq = 0;
  // 열린 읽기의 프롬프트 앞에 붙은 꼬리(없으면 "").
  let openTail = "";
  // 진행 중인 stdin(`input()`) 읽기 수.
  let inputPending = 0;
  // `send()`가 가져간 코드. 읽기가 `ReadTakenError`로 끝나면 응답으로 나간다.
  let takenCode: string | undefined;
  // 다음 읽기에 복원할 줄.
  let restore: { text: string; cursor: number } | undefined;
  // 결말을 실은 요청의 읽기가 그려지면 슬롯을 정착시킨다.
  let settleOnDraw = false;

  const prompt = (): SourcePrompt => {
    if (!sawRequest) return "wait";
    if (
      readState !== "open" ||
      blockPending ||
      inputPending > 0 ||
      deps.tabRequesting()
    ) {
      return "busy";
    }
    return "open";
  };

  return {
    request({ pending, outcome }) {
      sawRequest = true;
      blockPending = pending !== undefined;
      if (outcome !== undefined) {
        link.receive(outcome);
        settleOnDraw = true;
        return undefined;
      }
      if (pending !== undefined) return undefined;
      const source = link.claim();
      if (source === undefined) return undefined;
      // 화면에는 아무것도 그리지 않았다. 미종결 꼬리가 있으면 새 줄에서 출력을 시작한다(14.5.4 행 머리 규칙).
      restore = undefined;
      if (sinks.tail() !== "") sinks.write("\r\n");
      return { source };
    },
    readStarting() {
      readSeq += 1;
      readState = "opening";
    },
    readOpened(read, tail) {
      const seq = readSeq;
      openTail = tail;
      const ended = () => {
        if (seq === readSeq) readState = "none";
      };
      read.then(ended, ended);
      // 벤더 `read()`가 이미 그리기 콜백을 큐에 넣었다. 이 콜백은 그 뒤에 오므로 그때는 벤더가 프롬프트·복원한 줄을 그리는 write를
      // 냈고 쌓인 type-ahead도 재생한 뒤다.
      terminal.write("", () => {
        if (seq !== readSeq) return;
        if (readState === "opening") readState = "open";
        // 정착은 읽기 상태와 떼어 낸다: type-ahead의 Enter로 복원한 읽기가 이미 끝났어도(xterm이 write 처리를 끊어 그 사이 `ended`가
        // 돌았을 때) 그 읽기는 그려졌으므로 여기서 정착한다. 다음 읽기로 미루면 제출된 명령이 끝날 때까지 resolve하지 않는다.
        if (settleOnDraw) {
          settleOnDraw = false;
          // 그리기 write는 벤더 콜백 안에서 나와 이 콜백보다 뒤에 큐에 섰다. 한 번 더 기다려 그것들이 처리된 뒤에 정착한다(확정 9).
          terminal.write("", () => link.settle());
        }
      });
    },
    restoreOptions(options) {
      const line = restore;
      restore = undefined;
      if (line === undefined || line.text === "") return options;
      // 자동 들여쓰기 프리필보다 우선한다.
      return { ...options, prefill: line.text, prefillCursor: line.cursor };
    },
    taken(error) {
      if (!(error instanceof ReadTakenError) || takenCode === undefined) {
        return undefined;
      }
      const source = takenCode;
      takenCode = undefined;
      return { source };
    },
    inputRequested() {
      inputPending += 1;
    },
    inputResumed() {
      inputPending = Math.max(0, inputPending - 1);
    },
    prompt,
    send(code) {
      if (prompt() !== "open") return false;
      const line = readline.takeRead();
      if (line === undefined) return false;
      // 읽기는 여기서 끝났다. `ReadTakenError` 처리는 `readLine` 핸들러의 몫이다.
      readState = "none";
      takenCode = code;
      restore = line;
      // 벤더가 꼬리까지 지웠으므로 다시 쓴다. 꼬리가 열어 둔 색은 프롬프트가 닫았을 것이라 닫아 준다.
      if (openTail !== "") sinks.write(`${openTail}\x1b[0m\r\n`);
      return true;
    },
  };
}
