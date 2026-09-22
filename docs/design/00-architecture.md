# 아키텍처

## 1. 목표와 제약

- 브라우저에서 pyodide(`314.0.7`, Python 3.14.2)를 Web Worker에서 실행하고, 메인 스레드의 xterm.js 터미널로 **CPython 3.14 기본 대화형 REPL(`python`)과 같은 조작감**을 제공한다. 동등성 판정은 주관이 아니라 3.14.4 pty 실측과의 화면 행 비교다(`09-testing.md`, `10-parity-deviations.md`).
- 프롬프트 대기 중 worker 이벤트 루프는 살아 있다(asyncio 콜백이 돈다). 이 점은 `python`이 아니라 `python -m asyncio` 쪽에 정렬한 의도적 선택이다([ADR-0005](../adr/0005-input-stays-blocking-prompt-stays-async.md)).
- `input()`·`sys.stdin` 읽기만 worker를 멈추는 동기 대기다. pyodide `setStdin` 콜백이 문자열 동기 반환을 요구하고, CPython 의미(대기 중 다른 콜백이 돌지 않음)를 지키기 위해서다.
- 실행 환경은 **cross-origin isolated** 페이지다(`SharedArrayBuffer` 필요, [ADR-0004](../adr/0004-cross-origin-isolation-required.md)). 격리되지 않은 페이지에서는 초기화 프레임이 요구하는 `SharedArrayBuffer` 뷰를 만들 수 없으므로 시작 시 감지해 worker 없이 터미널에 경고만 낸다(세션이 없다). Service Worker 우회는 범위 밖이다.
- 이전 구현(`/work/cp949/pyodide-samples/apps/repl`)이 쓰던 coincident 동기 브리지는 쓰지 않는다([ADR-0001](../adr/0001-no-sync-bridge-library.md)). 그 위의 기능 규칙은 그대로 계승한다(`02`~`08`).

## 2. 프로세스 모델과 채널

```text
┌──────────── main (브라우저 메인 스레드) ────────────┐   ┌──────────── worker ────────────┐
│ xterm.js Terminal                                    │   │ pyodide (CDN loadPyodide)       │
│ @cp949/runo-xterm-readline (벤더링)                  │   │ pyodide.console.PyodideConsole  │
│ 코어 main 쪽: sink·꼬리·읽기 브리지·자동 들여쓰기·  │   │ 코어 worker 쪽: REPL 루프·      │
│   블록 히스토리·Tab 리더·인터럽트 송신기            │   │   submission-runner·SIGINT 핸들러│
│ apps/demo: React 셸(버튼·Chip·스위치)                │   │   ·stdin 콜백·완성 후처리        │
└──────┬───────────────┬────────────────────┬─────────┘   └────┬──────────────┬─────────────┘
       │ ① RPC         │ ② stdin 메일박스   │ ③ interrupt buffer │              │
       │ MessagePort   │ SAB(제어 4칸+데이터)│ SAB Int32Array(4)  │              │
       └───────────────┴────────────────────┴────────────────────┘──────────────┘
```

| 채널 | 매체 | 방향 | 동기성 | 나르는 것 |
| --- | --- | --- | --- | --- |
| ① RPC | 전용 `MessageChannel` 포트 | 양방향 | 비동기(요청/응답, 알림) | `readLine` 요청(worker→main), `complete` 요청(main→worker), 출력 알림 4종, `ready`/`loadFailed`/`sessionTerminated`, `readInput` 알림 |
| ② stdin 메일박스 | `SharedArrayBuffer` | main→worker(응답만) | worker `Atomics.wait` 블로킹 | `input()` 한 줄(UTF-8 청크) 또는 취소·오류 표식 |
| ③ interrupt buffer | `SharedArrayBuffer` `Int32Array(4)` | main→worker(신호), worker→main(ack) | pyodide 폴링(비동기) | SIGINT(2)·ack·요청 번호 |

원칙:

- **기본은 비동기다.** 동기 대기는 ②의 `input()` 하나뿐이다. 출력 알림은 worker를 멈추지 않는다.
- **순서는 포트 하나로 보장한다.** 출력 알림과 `readInput` 알림, `readLine` 요청이 같은 포트를 타므로 main은 항상 "출력 → 읽기 요청" 순서로 받는다. `input("x: ")`의 `x: ` 꼬리가 읽기 시작 전에 도착한다는 규칙(`04-stdin-input.md` 3.3)은 여기에 의존한다.
- **worker가 ② 대기 중이면 ①에 답하지 못한다.** 그 구간에 main→worker 요청(`complete`)을 배치하지 않는다. main이 보내는 유일한 신호는 ③이다.
- ③은 postMessage로 대체할 수 없다. Python이 동기 실행 중이면 worker 이벤트 루프가 돌지 않아 메시지를 받지 못하고, pyodide는 `setInterruptBuffer`로 넘긴 버퍼를 실행 중간에 폴링한다.

프로토콜 세부(메시지 형식, 슬롯 배치, 상태 전이)는 `01-protocols.md`에 있다.

## 3. 생명주기

### 3.1 시작

0. `crossOriginIsolated`가 거짓이면 main은 worker를 만들지 않는다. 안내 줄(`writeNotice`, `05-output.md` 4.1)로 경고만 내고 `onStatus('not-isolated')`를 부른 뒤 끝난다(ADR-0004). 아래 1~5는 격리된 페이지의 절차다.
1. main이 `Terminal`·`Readline`을 만든다(세션과 무관하게 마운트당 1회).
2. main이 `MessageChannel`, interrupt buffer, stdin 메일박스를 만들고 worker를 생성한다(`createWorker()` 팩토리).
3. main이 **초기화 프레임 하나**를 `worker.postMessage`로 보낸다: RPC 포트(transfer), interrupt buffer, 메일박스 두 뷰, `topLevelAwait`, pyodide `indexURL`. worker 스크립트는 첫 `await` 이전에 `message` 리스너를 걸어 이 프레임을 받는다. 프레임은 하나뿐이라 구분자(`instanceof`)가 필요 없다.
4. worker가 pyodide를 로드하고 콘솔을 만든 뒤 `ready` 알림(또는 `loadFailed`)을 보낸다. 로드 실패는 worker를 죽이지 않는다.
5. worker가 SIGINT 핸들러 설치 → interrupt buffer 연결 → `setStdin` → 감시 타이머 시작 → 배너 출력 → REPL 루프 진입(`03-ctrl-c.md` 2.6 순서).
   `createConsole` 직후 `suppressWebLoopReraise(pyodide, { warn })`(WebLoop의 `KeyboardInterrupt`·`SystemExit` 재보고 억제, `03-ctrl-c.md` 2.8)를 한 번 부르고, 이어서 `connectInterrupts(pyodide, repl.pyconsole, frame.interruptBuffer, { ack, seq, discard, warn })`(조각 교체 → 핸들러 설치 → 폐기 → 연결, 반환값은 `InterruptIdle`)를 부른 뒤 `pyodide.setStdin({ stdin: createStdinCallback({ requestInput, wait, signalInterrupt, checkInterrupt }) })`를 건다(`requestInput` = `rpc.notify("readInput", …)`, `wait` = `createMailboxReader(...).wait`). 전부 `try` 블록 안이라 던지면 `loadFailed`로 간다. 감시 타이머(`startInterruptWatch`)는 `ready`·배너 뒤·REPL 루프 직전에 켜고, 루프가 끝나면 `finally`에서 `stopWatch()`·`interruptIdle.destroy()`로 정리한다.

### 3.2 REPL 루프(worker)

```text
loop:
  setAtPrompt(true)                                                      # 감시 타이머의 프롬프트 유휴 폐기가 읽는다
  line = await rpc.call('readLine', prompt, pending, cancelable=true)   # 비동기, 이벤트 루프 살아 있음
  setAtPrompt(false)                                                     # 응답(취소 null 포함) 직후, 폐기보다 먼저
  discardPendingInterrupt(buffer)                                       # 대상 코드 없는 SIGINT 폐기 (RD-007 완료)
  result = await runner.run(line)                                        # null이면 취소 처리
  if result.exit: notify('sessionTerminated'); break
  prompt, pending = result.prompt, result.pending
```

프롬프트 대기 중 main→worker `complete` 요청에 답한다(RD-015). 실행 중 도착한 요청은 빈 후보로 답한다.

루프(`worker/repl-loop.ts`의 `runReplLoop(deps)`)는 `complete` 응답(RD-015)을 빼면 위 그대로다. `protocol/`을 import하지 않고 `readLine`·`setAtPrompt`(RD-009)·`discardPendingInterrupt`(RD-007)·`run`·`onTerminated`·`onError`를 주입받으며 `boot.ts`가 RPC 래퍼와 `atPrompt` 변수를 만든다. 호출 순서는 시험이 고정한다: `setAtPrompt(true)` → `readLine` → `setAtPrompt(false)` → `discardPendingInterrupt` → `run`. 오류 정책: `run`이 `KeyboardInterrupt`가 아닌 오류를 던지면 `onError`(`console.error` + 빨간 `repl 내부 오류: …` + `clearPending()`) 뒤 `>>> `로 계속한다. `readLine` 요청이 reject되면 `rpc disposed`(main의 `dispose()`)일 때는 조용히, 그 밖의 이유면 `console.error`만 남기고 루프를 끝낸다.

### 3.3 `input()`(worker, 동기)

```text
stdin 콜백(cancelable=true):
  rpc.notify('readInput', cancelable)      # 포트에 먼저 올린다(앞선 출력 뒤에 FIFO로 도착)
  text = mailbox.wait()                    # Atomics.wait — 이 사이 worker는 완전히 멈춘다
  null이면 signalInterrupt(buffer) → pyodide.checkInterrupt() → EINTR → KeyboardInterrupt
```

main은 `readInput` 알림을 받으면 read-guard(활성 REPL 읽기 뒤로 미룸)를 거쳐 readline으로 한 줄을 읽고 `mailbox.deliver(text)`, Ctrl+C면 `mailbox.cancel()`, 읽기가 실패하면(dispose가 아닐 때) `mailbox.fail(String(error))`로 worker를 깨워 `OSError`로 드러낸다(`04-stdin-input.md` 3.2). `stdin-callback`은 그 `null`을 `signalInterrupt()` → `checkInterrupt()`로 바꿔 `input()` 호출 지점의 `KeyboardInterrupt`를 만들고, `checkInterrupt()`가 던지지 않으면 `console.warn` 뒤 EOF로 떨어진다(RD-008, `04-stdin-input.md` 3.1).

### 3.4 세션 리셋·크래시·종료

- 리셋(`ReplHandle.reset()`, RD-010)은 worker 교체다. 화면·history는 유지된다. 순서(자동 들여쓰기 단위
  초기화는 RD-013 몫): 벤더 `readline.cancelRead()`로 옛 세션의 열린 읽기를 화면·history를 건드리지 않고
  끝낸다 → 인터럽트 송신기 취소 → interrupt buffer `SIGNAL=0` → RPC dispose → 이전 worker `terminate()`
  → 커서가 행 머리가 아니면 개행 → 청록 안내 줄 → 새 worker + 새 초기화 프레임(`08-session.md` 8.1).
  interrupt buffer는 세션 간 **재사용**(ack·요청 번호가 이어진다), 메일박스·sink 세트는 worker마다 **새로**
  만든다.
- worker `error` 이벤트·부팅 예외 → `crashed` 상태 + `onCrash(message)` → 앱이 재시작 버튼을 띄운다(RD-010,
  `08-session.md`).
- `exit()`/`quit()`/`SystemExit` → `sessionTerminated` 알림 → 앱이 안내를 띄우고, 복구 경로는 리셋뿐이다.

## 4. 패키지 구조와 공개 인터페이스

```text
packages/
  xterm-readline/        @cp949/runo-xterm-readline — strtok/xterm-readline 1.2.2 벤더링(TS 소스), ADR-0003
  pyodide-repl/          @cp949/runo-pyodide-repl — 프레임워크 무관 코어(main 쪽 + worker 쪽 + 프로토콜 + Python 스크립트)
apps/
  demo/                  Vite + React 19 데모 셸. 코어를 소비하는 유일한 앱. UI 상태(Chip·버튼·스위치)만 가진다.
```

### 4.1 `@cp949/runo-pyodide-repl` export

```ts
// main 쪽 진입점
export function createRepl(options: ReplOptions): ReplHandle

interface ReplOptions {
  terminal: Terminal                       // @xterm/xterm. 호출자가 만들고 dispose한다
  createWorker: () => Worker               // 리셋마다 다시 호출된다
  pyodide?: { indexURL?: string }          // 기본 CDN https://cdn.jsdelivr.net/pyodide/v314.0.7/full/
  topLevelAwait?: boolean                  // 기본 false. 바꾸려면 reset()
  onStatus?: (s: ReplStatus) => void       // 'loading' | 'ready' | 'load-failed' | 'not-isolated' | 'terminated' | 'crashed'
  onCrash?: (message: string) => void
}

interface ReplHandle {
  reset(options?: { topLevelAwait?: boolean }): void   // worker 교체. 화면 유지
  dispose(): void                                       // worker 종료·리스너 해제. Terminal은 호출자가 소유
  readonly crossOriginIsolated: boolean                 // 거짓이면 worker가 없다(경고만 낸 상태)
}

// worker 쪽 진입점(앱의 얇은 worker 파일이 부른다)
export function runReplWorker(): void                   // '@cp949/runo-pyodide-repl/worker'
```

`ReplOptions`는 `terminal`·`createWorker`(필수)·`pyodide?`·`onStatus?`·`onCrash?`(RD-010)·`topLevelAwait?`(RD-012, 기본 `false`, `=== true`만 켠다)이고 `ReplHandle`은 `dispose()`·`reset(options?)`·`crossOriginIsolated`다. RD-003·004의 임시 `readLine(prompt)` 핸들 API는 RD-005에서 빠졌다. 줄 읽기는 worker가 보내는 `readLine` 요청이 유일한 경로다. `onStatus`는 `loading`(`createRepl` 반환 전에 동기로)·`ready`·`load-failed`·`not-isolated`·`terminated`(`sessionTerminated` 알림)를 발행하고 `crashed`는 RD-010이 발행한다. `sessionTerminated`는 터미널에 쓰지 않고 worker도 종료하지 않는다. `ready`의 `pyodideVersion`은 main이 `console.info`로만 남긴다. 로드 실패는 worker를 죽이지 않고 main도 terminate하지 않는다. `dispose()`는 `rpc.dispose()` → `worker.terminate()` → `readline.dispose()` 순서이고 두 번 불러도 안전하다.

`reset(options?: { topLevelAwait?: boolean }): void`(RD-010이 무인자로 추가, RD-012가 옵션을 더했다). `topLevelAwait`가 boolean이면 그 값으로 바꾸고, 생략·`undefined`면 마지막으로 적용한 값을 유지한다(sticky, 핸들이 보관, getter는 없다). `disposed`·`!isolated`면 no-op, 그 외 상태는 전부 허용한다. 순서·게이트는 3.4·`08-session.md` 8.1.

main의 `readLine` 핸들러는 `createReplReader`로 꼬리 + 프롬프트를 그려 한 줄을 읽어 응답한다(`04-stdin-input.md` 3.3). 열린 읽기가 있는 동안 도착한 요청은 `Error("이미 읽는 중")`로 거절한다(벤더 `Readline`은 열린 읽기를 교체하고 앞 promise를 끝내지 않는다). 요청 시그니처는 `readLine(prompt, pending, cancelable)`이고 `cancelable`은 리더에 그대로 전달한다(RD-008). `pending`은 아직 무시하며 RD-013·014가 쓴다. 리더에는 `dispose()` 뒤 write 콜백을 전달하지 않는 터미널 뷰를 준다. xterm은 `term.dispose()` 뒤에도 대기 중인 write 콜백을 실행하므로, `rewindTail`이 flush를 기다리는 중에 dispose되면 그 콜백이 해제된 `buffer`를 읽는다(`docs/traps/TRP-004`). 뷰가 이 콜백을 막는다.

`readline?` 옵션은 두지 않는다. 호출자가 준 `Readline`은 `persist: false`를 보장할 수 없고, auto-indent·tab 래퍼는 코어가 만든 인스턴스를 감싼다. 코어는 `terminal.loadAddon(readline)`과 `readline.dispose()`만 하고 `Terminal`은 dispose하지 않는다. `term.dispose()`도 로드된 addon을 dispose하므로 `Readline.dispose()`는 멱등이다(`06-editing.md` 6.1).

앱의 worker 파일은 두 줄이다: `import { runReplWorker } from '@cp949/runo-pyodide-repl/worker'; runReplWorker()`. 앱은 `new Worker(new URL('./repl.worker.ts', import.meta.url), { type: 'module' })`로 만든다. worker 파일에 top-level `await`가 들어갈 수 있으므로 Vite `worker.format`은 `'es'`여야 한다. RD-001에서 확인했다: `es`는 빌드가 성공하고 번들 끝에 `await`가 남는다. 기본 `iife`는 `[UNSUPPORTED_FEATURE] Top-level await is currently not supported with the 'iife' output format`으로 실패한다. 앱의 얇은 worker 파일이 패키지 서브패스를 import하는 이 방식은 dev(소스 해석)와 build·preview(`dist` 해석) 양쪽에서 동작한다(4.4).

### 4.2 코어 모듈 지도

깊은 모듈(작은 인터페이스, 큰 구현)을 seam으로 삼고 통신은 주입한다. 이전 구현에서 순수 함수·콜백 주입으로 격리돼 있던 모듈은 이름을 유지해 이식 비용을 줄인다(`12-previous-implementation.md` 4절).

```text
packages/pyodide-repl/src/
  index.ts                 createRepl (main 쪽 조립, readline·interruptBuffer·sender·Ctrl+C 핸들러·dispose만)
  session.ts               세션 1개의 자원·게이트. reset()(RD-010)이 통째로 교체하는 단위      ← 08-session.md
  worker.ts                runReplWorker (프레임 검증 → CDN 로더를 주입해 boot 호출)
  protocol/
    rpc.ts                 MessagePort 위 요청/응답/알림          ← 01-protocols.md 1절
    stdin-mailbox.ts       SAB 메일박스 (main: deliver/cancel/fail, worker: wait)   ← 01 2절
    interrupt-protocol.ts  interrupt buffer 슬롯·원자 연산         ← 01 3절, 03-ctrl-c.md
    interrupt-sender.ts    송신·점검·재전송 상태기계(main 절반)      ← 03 2.3
    init-frame.ts          초기화 프레임 타입·검증                  ← 01 4절
  terminal/                main 쪽. Terminal·Readline에만 의존
    sinks.ts               sink 4종 + 꼬리 추적                      ← 05-output.md
    output-tail.ts
    notice.ts              세션 밖 안내 줄(writeNotice)              ← 05-output.md 4.1
    rewind-tail.ts         꼬리가 폭을 넘으면 첫 행까지 커서를 올림     ← 04 3.3 (repl-reader·stdin-reader 공용)
    repl-reader.ts         꼬리 + '>>> ' 합성 읽기                   ← 04 3.3
    stdin-reader.ts        input() 읽기(꼬리 그대로, SGR 리셋 없음)     ← 04 3.3
    read-guard.ts          stdin 읽기를 활성 REPL 읽기 뒤로(순서만)    ← 04 3.2
    auto-indent.ts         순수 계산                                  ← 06 6.3
    auto-indent-reader.ts  read()/readKey 래핑(벤더링 export만 사용)
    block-history.ts       블록 → history 항목 하나                   ← 06 6.4
    history-filter.ts
    tab-completion.ts      순수 로직                                  ← 07
    tab-reader.ts          Tab 가로채기·큐·목록 재그리기
    selection-copy.ts      Ctrl+Shift+C                              ← 06 6.6
  worker/                  worker 쪽. pyodide 프록시에만 의존(boot.ts는 조립 모듈이라 예외, 아래)
    boot.ts                부팅 시퀀스(로드 → 콘솔 → ready → 배너 → 루프)  ← 01 5절 S1
    repl-loop.ts           REPL 루프(readLine → run, 종료·오류 정책)    ← 00 3.2
    load-pyodide.ts        CDN 동적 import(브라우저 전용, 시험은 npm loadPyodide 주입)
    console.ts             PyodideConsole 생성·runLine·await_fut·정규화  ← 02 5.1
    submission-runner.ts   제출 실행 규칙(한 줄 제출 + 여러 줄 분할·줄 흘림, RD-011)  ← 02 5.2
    multiline.py           split_paste 본체(`.py?raw`, 파싱 + 2차 compile)         ← 02 5.2
    multiline.ts           loadSplitPaste(pyodide) — multiline.py를 별도 namespace에서 실행
    multiline-corpus.json  split_paste 코퍼스 27개(이름·소스, node + 실제 pyodide 차등 검증) ← 09 9.1
    top-level-await.ts
    interrupt-buffer.ts    connectInterrupts(설치 → 폐기 → 연결)       ← 03 2.6
    sigint-handler.ts      SIGINT 핸들러(`sigint-handler.py`, `.py?raw`)  ← 03 2.4
    interrupt-watch.ts     감시 타이머                                ← 03 2.5
    stdin-callback.ts      readInput 알림 → wait() → null이면 signal+check           ← 04 3.1
    sink-writer.ts         전역 stdout/stderr Writer                   ← 05 4.2
    complete-source.ts     완성 후처리·ZipStdlibModuleCompleter        ← 07 7.5
    webloop-reraise.ts                                                 ← 03 2.8
```

Python 소스는 `.py?raw`로 임포트한다(vite는 내장 지원, tsdown/rolldown은 `tsdown.config.ts`의 `raw-text` 플러그인 + `src/py-modules.d.ts` 타입 선언). 적용 파일: `console-helpers.py`·`sleep-slice.py`·`sigint-handler.py`·`webloop-reraise.py`·`multiline.py`(RD-011). `runPython(SOURCE, { globals, filename })`의 `filename`은 `<console-helpers>`처럼 `<…>` 꺾쇠 이름을 쓴다(트레이스백에 새면 알아보기 위한 것, 절단은 코드 객체로 한다).

`terminal/`은 `protocol/`을 import하지 않는다(읽기 함수·sink를 `index.ts`가 주입). `worker/`도 마찬가지다(`worker.ts`가 주입). 예외는 `worker/boot.ts`다. 부팅 시퀀스를 조립하는 모듈이라 `createRpc`·`createMailboxReader`·`InitFrame`과 `acknowledgeInterrupt`·`readRequestSeq`·`discardPendingInterrupt`를 import해 `connectInterrupts`의 `{ ack, seq, discard }`와 루프의 `discardPendingInterrupt`를 클로저로 넣고, pyodide 로더는 `worker.ts`가 주입한다(브라우저는 CDN 로더, node 시험은 npm `loadPyodide`). `console.ts`·`sink-writer.ts`·`top-level-await.ts`는 `protocol/`을 import하지 않고 sink 함수를 받는다. `repl-loop.ts`와 `submission-runner.ts`도 `readLine`·`run`·출력 함수를 주입받고, `stdin-callback.ts`도 `requestInput`·`wait`·`signalInterrupt`·`checkInterrupt`를 주입받으며(뒤 둘은 `boot.ts`가 `() => signalInterrupt(interruptBuffer)`·`() => pyodide.checkInterrupt()`로 넣는다), RPC 래퍼는 `boot.ts`가 만든다. 그래서 이전 구현의 시험(가짜 터미널, node+실제 pyodide)이 그대로 옮겨진다.

### 4.3 apps/demo

React 19 + Vite 8. `ReplView` 컴포넌트가 `createRepl`을 마운트 시 1회 호출하고, 상태(`crossOriginIsolated` Chip, `ready` Chip, 세션 리셋 버튼, top-level await 스위치, 종료·크래시 Alert)만 React state로 둔다. StrictMode 이중 마운트에서 `dispose()`가 두 번 불려도 안전해야 한다(`08-session.md` 8.2). UI 라이브러리는 정하지 않았다(이전 구현은 MUI v9였고, 이 데모에는 필수가 아니다).

RD-010 시점의 데모(`ReplView.tsx`)는 `createRepl({ terminal, createWorker, onStatus: setStatus, onCrash: setCrashMessage })`를 부르고 핸들을 `useRef`에 보관한다. plain 요소만 쓴다(라이브러리 없음):

- `<output data-testid="status">`: 상태 텍스트, 상시.
- `<button data-testid="reset" disabled={!isolated}>`: `handle.reset()`을 부른다. `isolated`는 `globalThis.crossOriginIsolated === true`(모듈 최상위 상수, RD-010 확정 8). 상시 렌더한다.
- `<label><input type="checkbox" data-testid="top-level-await" disabled={!isolated} /> top-level await</label>`(RD-012): React state(`useState(false)`, 저장 없음, 새로고침하면 항상 꺼짐)가 소유하고 `onChange`가 즉시 `handle.reset({ topLevelAwait: checked })`를 부른다(양방향 모두, 규칙은 "스위치 변경 = 세션 리셋"). 터미널·배너에는 표시하지 않는다. 리셋 버튼·크래시 재시작은 무인자라 코어가 보관한 마지막 값을 그대로 유지한다(sticky).
- `status === "terminated"` → `<div role="alert" data-testid="terminated">Python session terminated. "세션 리셋" 버튼으로 새 세션을 시작하세요.</div>`.
- `status === "crashed"` → `<div role="alert" data-testid="crashed">worker가 예기치 않게 종료됐습니다: {crashMessage} <button data-testid="restart">재시작</button></div>`. `restart`는 `reset()`을 부르고 `crashMessage` state를 비운다 — 리셋이 `loading`을 동기 발행하므로 Alert는 상태 전이로 자연히 사라진다.
- 터미널(`<div data-testid="terminal">`)은 `crashed` 중에도 계속 렌더한다(이전 구현과 다른 선택: 화면에 남은 출력이 단서가 된다).

RD-005 시점에는 `onStatus`만 있었고 `terminated`도 `<p data-testid="terminated">Python session terminated.</p>`(버튼 없음)였다 — 위가 RD-010이 대체한 최종 형태다.

### 4.4 워크스페이스 빌드 규칙

RD-001에서 클린 체크아웃(`dist` 없음)으로 재현한 결과다.

- 패키지 `exports`의 조건 순서는 `development`(`./src/*.ts`) → `types`(`./dist/*.d.mts`) → `default`(`./dist/*.mjs`)다. Vite는 dev에서 `development`를, build·preview에서 `default`를 고른다(`dist` 없이 `vite build`만 돌리면 실패해서 확인). 새 패키지나 서브패스를 추가하면 `development` 항목도 함께 둔다. 빠지면 `pnpm dev`에서 vite가 `dist`보다 먼저 떠서 `Failed to resolve import ...`(500)를 내고, 실패한 해석을 캐시해 `dist`가 생겨도 vite를 재시작하기 전까지 복구되지 않는다. worker 오류는 브라우저 콘솔에만 남는다.
- 루트 `pnpm dev`는 `apps/demo`만 띄운다(`turbo run dev --filter=demo`). 패키지의 `dev`(`tsdown --watch`)는 `dist`를 지우고 다시 써서 `build`와 경합하므로 필요할 때 `pnpm --filter <패키지> dev`로 따로 실행한다.
- `check-types`는 `^build`에 의존한다. 앱이 패키지 타입을 `dist/*.d.mts`에서 읽으므로 d.ts가 먼저 있어야 한다. 이전 값(`^check-types`)은 클린 상태에서 `TS2307: Cannot find module '@cp949/runo-pyodide-repl/worker'`로 실패했다. `customConditions`로 소스를 읽게 하면 앱의 컴파일러 옵션(`noUncheckedIndexedAccess`)이 벤더링한 xterm-readline 소스를 검사하므로 쓰지 않는다.
- `pnpm preview`는 `build`에 의존한다.

## 5. 이전 구현 대비 무엇이 사라지고 무엇이 남는가

사라지는 것: coincident 의존과 포크, reflected-ffi 옵션, 응답 프레임 변환 함정(TRP-010), 초기 handshake와 공존하기 위한 "최초 `await` 이전 등록·`instanceof` 구분" 규칙, 출력 조각마다 worker가 멈추는 동기 왕복, worker가 main에 설정을 되묻는 호출(`getTopLevelAwait`는 초기화 프레임으로 대체), `reportSync`(`crossOriginIsolated`는 main이 직접 안다).

남는 것: cross-origin isolation 요구(interrupt buffer 때문에 어차피 필요), `input()` 대기 중 worker 정지(의도된 의미), read-guard, SIGINT 프로토콜 전체(pyodide 폴링의 비원자성은 통신 방식과 무관), xterm-readline 계열 함정(벤더링으로 소스에서 처리).

## 6. 호스팅 요구

- dev·preview·정적 배포 모두 `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`를 응답 헤더로 보내야 한다. 이전 구현은 dev 서버에만 걸어 두어 `vite preview`와 빌드 산출물에서 `crossOriginIsolated === false`였다. 새 구현은 `apps/demo/vite.config.ts`의 `server.headers`와 `preview.headers` 둘 다에 넣고, README에 배포 시 요구를 적는다. `apps/demo/src/vite-config.test.ts`가 두 곳과 `worker.format`을 시험한다. RD-001에서 dev와 preview 모두 HTML과 worker 스크립트 응답에 두 헤더가 붙고, 페이지와 worker의 `crossOriginIsolated`가 참인 것을 Chromium(Playwright 1.60, 리비전 1223)으로 확인했다. 같은 빌드 산출물을 헤더 없는 서버로 서빙하면 둘 다 거짓이다.
- pyodide는 CDN(`cdn.jsdelivr.net`)에서 로드한다. COEP `require-corp` 아래에서는 CDN 응답에 `Cross-Origin-Resource-Policy: cross-origin`이 있어야 한다(jsdelivr는 제공한다). 자체 호스팅 pyodide로 바꾸면 같은 헤더를 붙인다.
