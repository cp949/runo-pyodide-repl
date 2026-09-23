# 테스트·검증 전략

> 이 문서의 규칙·상수는 이전 구현(`/work/cp949/pyodide-samples/apps/repl`, 읽기 전용 참고)이 CPython 3.14.4 pty 실측과 브라우저 회귀로 확정한 것이다. 새 구현은 통신 계층만 바꾸고(`docs/design/00-architecture.md`, `01-protocols.md`) 이 규칙은 그대로 지킨다. 절 끝의 "참고:" 경로는 이전 구현의 근거 위치다.

파일 이름은 이전 구현의 시험 인벤토리다. 새 구현은 같은 검증 범위를 목표로 하되 파일 배치는 `packages/pyodide-repl/src/**/*.test.ts`를 따른다. 새로 추가되는 시험 대상: `rpc`(실제 `MessageChannel`), `stdin-mailbox`(node `worker_threads`로 실제 `Atomics.wait` 왕복·청크·취소), 초기화 프레임.

## 9.1 node + 실제 pyodide(`// @vitest-environment node`)
파이썬 의미·pyodide 내부 가정·프로토콜 불변식을 실제로 돌려 고정한다. 해당 파일:
`sigint-handler.test.ts`, `sigint-handler-idle.test.ts`, `sigint-handler-sleep-slice.test.ts`,
`sigint-handler-nojspi.test.ts`(Node에서 `WebAssembly.Suspending`을 지워 JSPI 없는 경로),
`interrupt-buffer.test.ts`, `interrupt-connect.test.ts`, `webloop-reraise.test.ts`,
`submission-runner.test.ts`, `multiline.test.ts`, `stdin-callback.test.ts`,
`top-level-await.test.ts`(콘솔 플래그 토글 + RD-012 `asyncio.run(main())` TLA 꺼짐/켜짐 둘 다 완료),
`terminal-sinks.test.ts`(실제 `PyodideConsole`·sink·`Readline`의 터미널 바이트),
`complete-source.test.ts`, `import-gate.test.ts`, `tab-completion.test.ts`,
`tab-completion-flow.test.ts`(main·worker 루프·실제 후보 계산 통합), `auto-indent-parity.test.ts`
(pyodide에 든 `_pyrepl.readline` 함수와 차분 검증), `rpc.test.ts`(실제 `MessageChannel`).
- 새 구현의 Ctrl+C 파일: `worker/sigint-handler.test.ts`(요청 번호 확인·ack·`<console>` 프레임 규칙·절단·
  catch-loop·TLA 켜짐 연타), `worker/interrupt-buffer.test.ts`(`connectInterrupts`의 조각 → 설치 → 폐기 → 연결
  순서와 조각 코드 객체 배선), `worker/boot.test.ts`(연결이 `setStdin`·`ready`보다 먼저, 부팅 전 눌림, 감시 타이머
  정지, 정지한 대기 깨우기, 프롬프트 유휴 폐기). RD-009가 더한 파일: `worker/webloop-reraise.test.ts`(재보고 억제
  4건 + 가드),
  `worker/sigint-handler-sleep-slice.test.ts`(조각·폴링 횟수·무효 인자·가드 2종),
  `worker/sigint-handler-idle.test.ts`(정지한 대기 깨우기·TLA·`pending`·가드 3종. RD-009a가 더한 것:
  `run_sync` 계열 대기에서 코루틴이 낸 예외의 나르기·프레임 보존),
  `worker/sigint-handler-nojspi.test.ts`(JSPI 없는 경로 5건).
- 공용 조립은 `src/test/sigint-setup.ts`의 `setupConsoleRunner(pyodide, options)` →
  `{ run, screen, buffer, pyconsole, presser, wakeAfter }`와 `teardownConsoleRunner`다. `wakeAfter(ms)`는 감시
  타이머 대신 시험이 직접 `interruptIdle()`을 부르는 도우미이고(프로덕션 경로는 타이머다) `{ woke, … }`를
  돌려준다. 해체는 버퍼 해제·`discardPendingInterrupt`·`signal.signal(SIGINT, default_int_handler)`에 더해
  **`pyodide.ffi.run_sync`·`pyodide.webloop.run_sync` 원복**과 남은 타이머·proxy 정리를 한다 — 설치가 모듈 전역을
  바꾸므로 한 인스턴스에 두 번 설치하면 래퍼가 겹쌓인다.
- **JSPI 없는 경로를 만드는 법**: `loadPyodide()` **전에** `WebAssembly.Suspending`·`promising`·`Suspender`를
  `delete`하고 `afterAll`에서 되돌린다. pyodide는 `"Suspending" in WebAssembly`로 판정하고 Node 24는 기본으로
  JSPI가 켜져 있다(`--no-experimental-wasm-jspi`는 듣지 않는다). vitest는 파일 격리라 다른 파일에 새지 않는다
  (같은 실행에서 JSPI 있는 `sigint-handler-idle.test.ts`가 통과하는 것으로 확인한다).
- 눌림은 눌림 스레드 역할 `src/test/roles/interrupt-presser.ts`가 `node:worker_threads`로 실제 스레드에서 버퍼에
  쓴다. 시나리오 Python은 JS 전역 `started()`로 "실행에 들어갔다"를 알리고, 그 호출을 `try` **본문 안**에 둔다
  (폴링 위상에 따라 호출 직후의 SIGINT가 `try` 진입 전에 처리되면 예외가 `except`를 벗어난다, TRP-012). 무한
  루프 대신 상한 있는 루프를 쓴다(눌림이 소실되면 vitest가 멈출 수 없다).
- 스레드가 저장소 **송신기**(`createInterruptSender`)를 쓸 때는 대기를 `Atomics.wait`로 하면 안 된다. 점검이
  `setTimeout`이라 스레드를 막으면 재전송이 한 번도 돌지 않고 "소실 0"이 저절로 나온다(TRP-014).
- pyodide private 의존(플래그, `run_sync`, `time.sleep.__wrapped__`, WebLoop 속성)은 **테스트가 깨지는 것이
  버전 업그레이드 알림**이라는 전제로 쓴다.
- worker 스레드 시험(메일박스·프로토콜 통합 시나리오): `src/test/thread.ts`의 `spawnRole(name, workerData)`가
  `src/test/roles/<name>.ts`를 실제 `worker_threads` 스레드로 띄운다. `Atomics.wait`에 영구히 막힌 스레드도 시험이
  끝나면 `terminate()`로 회수된다. 역할 스크립트와 그것이 import하는 소스는 Node 타입 제거로 실행되므로 enum·
  namespace·매개변수 프로퍼티를 쓰지 않고 타입 import는 `import type`으로 쓴다. 확장자 없는 상대 import는
  `src/test/ts-resolve-hook.mjs`(`module.registerHooks`)가 푼다.
- 변이 검사 주의: 비동기 폴링 대기를 없애는 변이는 마이크로태스크 스핀이 되어 이벤트 루프를 굶기고 시험 타임아웃도
  발동하지 못한다. 그런 변이는 간격·호출 경로를 바꾸는 방식으로 대체한다. `MessagePort`를 든 객체에는 `toContain`·
  `toEqual`을 쓰지 않는다(순환 내부 참조로 스택이 넘친다). 정체성 비교(`includes`)를 쓴다.
- **이 저장소의 패턴**(RD-004에서 확립). 해당 파일: `worker/sink-writer-pyodide.test.ts`, `worker/top-level-await.test.ts`,
  `worker/console.test.ts`, `worker/submission-runner.test.ts`, `terminal/sinks-pyodide.test.ts`, `worker/boot.test.ts`, `worker/stdin-callback.test.ts`.
  - 파일 상단에 `// @vitest-environment node`를 두고 `import { loadPyodide } from "pyodide"`를 인자 없이 부른다
    (npm 패키지 자체 `indexURL`을 쓴다). `beforeAll(async () => { pyodide = await loadPyodide(); }, 60_000)`으로
    파일마다 인스턴스 하나를 만들어 그 파일의 시험이 공유한다(로드가 수 초라 시험마다 만들지 않는다). CDN 로더
    `loadPyodideFromCdn`은 브라우저 전용이라 단위 시험이 없고 9.3의 브라우저 확인이 본다.
  - 실제 `Readline`(`persist: false`) + 가짜 터미널은 node에서 `window` stub 없이 돈다. 벤더 `readline.ts`의
    `@xterm/xterm` import는 타입뿐이고 `History`는 `persist: false`면 `window`를 만지지 않는다. 그래서 실제
    `PyodideConsole`·sink·`Readline`을 이어 터미널 바이트를 검사하는 시험(`sinks-pyodide.test.ts`)이 node에서 돈다.
  - 부팅 시퀀스(`boot.test.ts`)는 `bootReplWorker(frame, { loadPyodide })`에 로더를 주입하고 main 역할은 실제
    `MessageChannel`의 다른 포트에서 알림을 받는다. 실패 경로는 로더가 던지게 하거나, `Proxy`로 감싼 pyodide의
    `pyimport`만 던지게 해(콘솔 모듈 가져오기 실패) 콘솔 생성 실패를 만든다.
  - 부팅 뒤 REPL 루프는 각본 `readLine`으로 시험한다. main 역할이 `readLine` 핸들러를 각본 배열로 답하고(각본이 끝난 뒤의
    요청은 오류로 답하되 기록은 남긴다), 알림과 `readLine` 요청을 한 타임라인(`events`)에 도착 순서대로 기록해 "출력 → 다음
    프롬프트 요청" 순서 전체를 단언한다. 종료 뒤에는 시간을 두고 이벤트 수가 늘지 않는지(요청이 더 오지 않는지) 본다.
    실행 밖 오류 경로는 각본이 문자열이 아닌 값(`42`)을 답하게 해 실제 `push`가 `TypeError`를 던지게 만든다.
  - 러너(`worker/submission-runner.test.ts`)는 실제 pyodide의 `createConsole`이 만든 `ReplConsole`을 `createSubmissionRunner`에
    물려 한 줄 제출·값 에코·오류 표시·끝 개행·`exit`·`null` 취소를 본다. 사용자 코드 밖에서 새는 `KeyboardInterrupt` 안전망은
    실제 SIGINT 없이 `runLine`·`clearPending`을 `KeyboardInterrupt`를 던지는 Python 함수로 바꿔 끼워 재현한다.
  - `worker/multiline.test.ts`(RD-011, node + 실제 pyodide, 24건: 문장 단위 분할 11·입력 정규화 4·부작용 1·
    파싱 오류 5·2차 `compile` 2·globals 오염 없음 1)는 `split_paste(source, flags)`(`multiline.py?raw`)를 실제
    콘솔의 `compilerFlags()`로 얻은 플래그로 직접 부른다. 같은 파일의 `worker/submission-runner.test.ts`는
    여러 줄 분할·줄 흘림·중단·무동작·`builtins._` 갱신 시험(신규 43건, 기존 26건 + 코퍼스 검증 포함 69건)과
    `describe("코퍼스 27")`을 더한다 — 코퍼스는 `packages/pyodide-repl/src/worker/multiline-corpus.json`
    (이름·소스 27개)을 순회하며, 새 콘솔+러너로 `run(source)`한 stdout과 같은 pyodide에서
    `exec(compile(source, "<x>", "exec"), {"__name__": "__main__"})`를 돌려 캡처한 stdout을 비교한다
    (stderr는 `""`이어야 한다). 값 에코 차이를 피하려고 코퍼스 소스는 모두 `print`로 끝나거나 값 문장이
    없다.
  - stdin 콜백(`worker/stdin-callback.test.ts`)은 실제 pyodide에 `setStdin({ stdin: createStdinCallback(...) })`을 걸고 `input()`·`sys.stdin.readline()`·`read(3)`·`readlines(1)`·`for line in sys.stdin`이 같은 경로로 값을 받는지, 콜백 호출 수가 소비한 줄 수와 같은지 본다. `requestInput`과 `wait`의 앞뒤 순서는 호출 순서를 기록하는 주입 함수로 단언한다(알림을 `wait()` 뒤로 옮긴 변이가 이 시험에서 잡힌다). `setStdin` 없이 `input()`을 부르면 시험이 실패하지 않고 스위트가 멈추므로(외부 `timeout`이 필요하다) 시험 인스턴스에 `setStdin({ error: true })`를 먼저 걸고, `afterEach`에서 `sys.stdin`을 새 스트림으로 교체한다(`read(n)`이 남긴 `\n`이 다음 시험을 채운다, `docs/traps/TRP-010`).
  - 같은 파일의 **취소 변환**(RD-008)은 `runPython`이 아니라 **콘솔 러너 경로**로 돌린다: 핸들러는 스택에 `<console>` 프레임이 있을 때만 `KeyboardInterrupt`를 내므로 `runPython`의 파일명 `<exec>`에서는 취소가 버려지고 CPython이 읽기를 재시도한다. `sigint-handler.test.ts`의 `setup()`과 같은 순서로 `createConsole` → `createInterruptBuffer` → `installSigintHandler` → `setInterruptBuffer` → `createSubmissionRunner`를 만들어 제출하고 `screen.stderr`로 트레이스백 바이트를 단언한다. 보는 것: `input()`·`readline()`·`read()`·`for line in sys.stdin`·함수 프레임의 트레이스백, `try/except/finally/with`, 재시도 없음(`countWaits === 1`), 요청 번호를 올리지 않은 전송은 무시(TRP-035 검출), `checkInterrupt()`가 던지지 않으면 `EOFError` + `console.warn` 1회, 20회 반복 뒤 SIGINT 잔류 0.
  - **취소와 눌림의 경합**(같은 파일)은 눌림 스레드(`src/test/roles/interrupt-presser.ts`)를 띄운다. 읽기가 열린 순간을 기준으로 삼기 위해 `installStdin`에 `onRead` 훅을 두고 그 안에서 시작 표시(`ctl`)를 세운다. 0ms 연타는 취소와 같은 읽기 안에 떨어져 콜백의 `checkInterrupt()`가 함께 소비하고(실측 20라운드 잔류 0), 취소가 끝난 뒤 도착한 눌림은 돌고 있는 Python이 없어 슬롯에 남아 루프의 `discardPendingInterrupt`가 지운다(그 시험이 `SIGNAL === 2`를 단언한다). `except KeyboardInterrupt` 뒤 계산 중 눌림은 시간과 stderr 둘 다 본다(대조 215ms → 눌림 34ms).
  - 부팅의 `input()` 시험(`worker/boot.test.ts`)은 **선전달 기법**을 쓴다. `Atomics.wait(ctrl, STATE, IDLE)`은 STATE가 이미 READY면 즉시 돌아오므로, 각본이 `input()` 줄을 답하기 전에 main 역할이 `deliver`를 해 두고 타임라인(`write("x: ")` → `readInput(true)` → 다음 `readLine`)과 값(`x`의 에코 `'abc'`, `sys.stdin.readline()`의 에코 `'def\n'`)을 단언한다. 스레드는 쓰지 않는다. 메일박스 대기 중 `complete`가 큐잉되는 프로토콜 쪽은 `protocol/thread-scenario.test.ts`의 스레드 시험이 본다.
  - `exit()`·중단·`input()` 취소는 asyncio가 `SystemExit`·`KeyboardInterrupt`를 WebLoop로 다시 던져 vitest를
    `Unhandled Rejection`으로 실패 종료시킨다. RD-009의 `suppressWebLoopReraise`가 이 재보고를 없앴고
    **`vitest.config.ts`의 `onUnhandledError` 필터는 제거했다**(억제 없이 필터만 떼면 개별 시험이 다 통과해도
    `Errors 210` + 종료코드 1이다 — 실측). 실제 pyodide를 직접 로드하는 시험 파일은 `boot.ts`의 배선이 닿지
    않으므로 **그 파일의 콘솔 조립 지점에서 `suppressWebLoopReraise`를 직접 불러야** 한다. `process.on
    ("unhandledRejection")`은 쓰지 않는다(집계에서 빠진다, TRAP-22).
  - `time.sleep`의 무효 인자 문구(`-1`·`'a'`·NaN·inf·키워드·인자 2개·`9.3e9`)를 단정하는 시험의 기준은 **로컬
    CPython 3.14.4**로 재 둔 문자열이다(번들 pyodide는 3.14.2 — 편차 19). 조각 래퍼는 이 인자들을 원본 C 함수에
    그대로 넘겨 문구를 보존한다.
  - 시험 입력 함정: `1 +`·`foo bar` 같은 EOF 문법 오류는 pyodide 314.0.7의 `pyconsole.push`가 `_IncompleteInputError:
    incomplete input`으로 표시한다. `runLine`은 이를 표준 `SyntaxError: invalid syntax`로 정규화해 돌려주므로(`02-console-core.md`
    5.1) `push`를 직접 부르는 시험만 원문을 기대해야 한다(`x = = 1`은 원문도 `SyntaxError: invalid syntax`). 한 줄에 `;`로
    이은 앞 식문장의 값은 콘솔이 stdout으로 에코해 꼬리를 비우므로, 개행 없는 출력 시험은 값이 없는
    `print(..., end="")`로 만든다.

## 9.2 jsdom(기본 환경) + 실제 `Readline` + 가짜 터미널 / 가짜 타이머
`auto-indent.test.ts`(순수 함수 + `createAutoIndent` 정책 객체, RD-013 완료 — 별도 `-reader.ts` 파일 없이
한 모듈에 둔다), `block-history.test.ts`(실제 `Readline` + 가짜 터미널, `createBlockHistory` 정책 객체,
RD-014 완료), `read-options.test.ts`(`mergeReadOptions` 순수 함수, RD-014 완료 — 벤더 `packages/xterm-readline`의
`history-entry.test.ts`도 같은 `StubTerminal` 패턴으로 `historyEntry` 훅을 본다 — 벤더 `packages/xterm-readline`의
`print-above.test.ts`도 같은 패턴으로 `printAbove`(버퍼·커서 유지, 재그리기 중 키 큐 순서 보존, 커서 끝·이모지
버퍼, 활성 읽기 없을 때 `println` 동등, dispose 뒤 콜백 무해, 다중 행 블록·감긴 단일 행에서 소실 없음,
`cancelRead()` 경합 무해, RD-015 DELTA-01·01a·04a 11건)를 본다), `tab-reader.test.ts`, `stdin-reader.test.ts`,
`repl-reader.test.ts`, `rewind-tail.test.ts`, `read-guard.test.ts`, `output-tail.test.ts`, `sink-writer.test.ts`,
`worker/repl-loop.test.ts`(pyodide 없이 주입한 `readLine`·`run` 각본으로 프롬프트·`pending` 전달, 종료, 실행 오류 복구, 읽기
요청 거절 정책, **`setAtPrompt` 호출 순서**(`true` → `readLine` → `false` → `discardPendingInterrupt` → `run`, 취소
`null`과 `readLine` reject 경로 포함)를 고정), `index.test.ts`(`createRepl`),
`history-filter.test.ts`, `paste-tabs.test.ts`, `interrupt-protocol.test.ts`,
`interrupt-sender.test.ts`(주입 타이머로 전송·재전송·10회 상한·읽기 순서), `interrupt-watch.test.ts`,
`App.test.tsx`(배선: 전송·재전송, `readLine`/`readInput` 진입, 세션 리셋, 언마운트).
- 가짜 터미널(`src/test/fake-terminal.ts`)은 `write` 콜백을 동기/비동기 둘 다 돌릴 수 있어야 한다
  (동기만 쓰면 TRP-008을 놓친다). history는 ↑ 재호출로만 관찰한다.
  `createFakeTerminal({ asyncWrite, cols, rows })`가 `{ term, screen, written, type, paste, keyDown, flush, disposedBufferReads }`를 돌려준다.
  `entries` 직접 단언은 ↑ 재호출로 구분할 수 없는 복구 두 경우(50개 제한으로 밀린 항목 복구, 중복 제거로 옮겨진 옛 항목의 원래 자리 복구)에만 쓴다(`block-history.test.ts`, RD-014 확정 8).
  `Readline`이 읽는 xterm 멤버와 `loadAddon`·`dispose`만 구현하고 화면은 해석하지 않는다(원문 `written`). 화면 버퍼를 읽는
  코드(`rewindTail`)를 위해 `screen`에 시험이 값을 지정하는 최소 모델만 둔다: `buffer.active.{cursorY, baseY, getLine(row)?.isWrapped}`가
  읽는 `cursorY`·`baseY`·`wrappedRows`이고 VT는 해석하지 않는다. 기본값(커서 0행, 스크롤백 없음, 감긴 행 없음)은 값을 지정하지
  않는 시험에 영향이 없다. 실제 화면 결과(앞 행 중복 없음)는 9.3의 브라우저가 본다.
  `type()`은 키 하나마다 `onData`를 한 번씩 부르고(이스케이프 시퀀스는 한 키) `paste()`는 한 번에 보낸다. 비동기 모드는 콜백을 `flush()`까지 미룬다.
  실제 xterm처럼 `dispose()` 뒤에도 write 콜백을 돌리고 그때의 `buffer` 읽기(`cursorY`·`baseY`·`getLine`)를 `disposedBufferReads`로 센다(`docs/traps/TRP-004`).
  실제 xterm `Terminal`은 jsdom에서 `open()`이 `matchMedia` 없음으로 실패해 브라우저(9.3)에서만 쓴다.
- `index.test.ts`는 worker 역할 rpc(초기화 프레임의 `rpcPort`에 시험이 만든 `createRpc`)가 `readLine`을 요청하고 main이 읽기를
  시작하는 경로로 줄 편집·이중 요청 거절·dispose·`terminated`를 본다. `startRead(session, prompt)` 도우미가 요청을 보내고 입력
  상태가 만들어질 때까지 write 콜백을 배출한다. 출력 알림은 빈 문자열 write를 내지 않으므로 빈 문자열 write의 개수가 늘어난 것을
  "요청이 도착했다"는 신호로 쓴다(`written.length` 증가는 앞선 출력 알림에도 반응한다). 긴 꼬리는 `rewindTail`이 flush를
  기다리므로 배출을 두 번 한다. 읽기 Promise는 객체 `{ line }`에 담아 돌려준다(`async` 함수가 반환한 Promise를 풀어 Enter까지
  멈추는 것을 피한다). 응답이 오지 않는 시험(dispose 뒤 요청)은 `observe`로 상태만 본다.
- 실제 pyodide의 **동기** stdin 콜백 안에서 실제 `Readline`을 기다릴 수 없어, `input()` 통합은 read를
  동기 fake로 대신한다. 이 저장소는 양쪽을 나눠 본다: main은 jsdom(`index.test.ts`의 `input() 읽기`)에서 `readInput` 알림 뒤 메일박스 상태(`STATE`·데이터 바이트·`FLAG_LAST`)를 동기로 확인하고,
  worker는 node + 실제 pyodide(`boot.test.ts`의 선전달 기법)에서 본다. 실제 `Atomics.wait` 왕복은 RD-002의 스레드 시험이 담당한다.
- `read-guard.test.ts`는 결과를 시험이 정하는 가짜 읽기(`deferred`)로 순서 규칙을, 실제 `Readline` + 가짜 터미널 + `createReplReader`·`createInputReader`로 "REPL 줄은 REPL 읽기가, 그다음 줄은 stdin 읽기가 받는다"를 본다(가드의 `await`를 빼면 후자가 실패한다). 마이크로태스크 한 번 안에 시작해야 하는 규칙("활성 REPL 읽기가 없으면 기다리지 않는다")은 `tick` 뒤가 아니라 `await Promise.resolve()` 뒤에 단언한다.
- `interrupt-watch.test.ts`는 가짜 타이머(`vi.useFakeTimers`)와 주입 deps로 감시 타이머 규칙을 본다: SIGINT가 없으면
  `interruptIdle`을 부르지 않는다, 20ms 간격, 깨웠으면 소비, 못 깨우면 남기고 재시도, 부르는 동안 버퍼가 바뀌면
  덮어쓰지 않는다, 콜백이 던져도 계속 돌며 `console.error`, 중지, 프롬프트 유휴 폐기(실행 중이면 남긴다·깨웠으면
  프롬프트여도 소비·상태는 틱마다 재확인·폴링이 먼저 소비했으면 ack 안 함). `interruptIdle()`의 반환값에는 경합이
  있으므로(`03-ctrl-c.md` 2.5) 실제 pyodide 쪽 시험에서 `woke === true`를 단언하지 않는다 — 깨어남은 경과 시간과
  화면으로, ack는 슬롯으로 본다.
- **변이 검사(mutation)** 를 관행으로 쓴다: 요청 번호와 SIGINT 쓰기 순서 뒤집기, 송신기가 ack를 먼저 읽기,
  핸들러 ack 위치 옮기기, 감시 타이머 ack를 비교 교환과 무관하게 올리기, 연결이 무조건 ack하기 등이 각각
  해당 테스트를 실패시키는지 확인했다.

## 9.3 브라우저(Playwright headless Chromium, dev 서버)로만 확인되는 것
- SharedArrayBuffer/Atomics 동기 브리지 결합, `sync === true` 확인, COOP/COEP 의존 동작.
- 실제 xterm의 **비동기 파싱**과 `isWrapped`·flush 타이밍(TRP-016/017 계열), 꼬리 재그리기 화면.
- 눌림 간격·소실률·위험 구간 같은 타이밍 통계(연타 매트릭스 조합별 N=20, `while True: pass` 단일 눌림
  N=200 등), 부팅 중 Ctrl+C(N=30), 정지한 실행 12조합. RD-007의 스크립트: `ctrl-c-check.mjs`·`press-loss.mjs`·
  `burst-matrix.mjs`·`boot-press.mjs`·`positive-controls.py`(양성 대조 3건), node 통계는 `verify/node/`의
  `press-loss.mjs`(N=3000)·`poll-overhead.mjs`. RD-008의 스크립트: `prompt-cancel-check.mjs`(23개)·
  `input-cancel-check.mjs`(26개)·`input-burst-matrix.mjs`(8셀 × N=20)·`positive-controls.py`(3건)·
  `pty/pty_cancel.py`(3.14.4 취소 7건). RD-009의 스크립트: `sleep-await-check.mjs`(정지한 실행 12조합 × N=20)·
  `run-browser.sh`·`positive-controls.py`(3건), node 통계는 `verify/node/sleep-stats.mjs`(JSPI 유무 × 5 프로그램
  × N=30).
- **`pageerror` 기준선은 총계 0이다**(RD-009부터). webloop 재보고를 억제하기 전에는 확인 스크립트가 재보고를
  분류해 빼고 셌지만(`isWebLoopReraise`), 이제 정상 중단·`input()` 취소·`exit()` 어디서도 재보고가 나지 않는다.
  RD-009 실측: 12조합 240시행 0, 재실행 4종(`repl-check normal`·`ctrl-c-check`·`prompt-cancel-check`·
  `input-cancel-check`) 전부 0(이전 기준선 1·시행당 2·4·28건).
- 정지한 실행 12조합의 판정은 복귀 여부 + 복귀 지연 + **화면 형식** + 우리 프레임 0 + `pageerror` 0을 따로 센다.
  240/240 복귀·지연 중앙값 12/12셀 30ms 이내, 형식 판정 12/12셀(RD-009a 뒤. RD-009 당시 `arun-sleep`·
  `runsync-sleep`은 편차 28(`docs/traps/TRP-021`)로 형식 판정에서 제외했었다).
- 양성 대조는 "이 확인이 무엇을 잡는가"를 셋으로 나눠 건다(RD-009): 억제 제거 → `pageerror` 총계 0 → 10,
  ≤20ms 폴링 제거 → `sleep-0.01` 중앙값 28.44 → 96.79ms, 감시 타이머 제거 → `arun5` 24.22 → 4010.3ms.
  각각 해당 확인만 실패하고 원복 후 통과해야 한다(변조 → dev 재시작(TRP-007) → 실행 → `git checkout --`).
- 지연을 재는 확인은 **눌림 시각과 화면 변화 시각을 둘 다 페이지 안에서** 잡는다(keydown 리스너 +
  `MutationObserver`). Node 쪽에서 `page.$$eval` 폴링으로 재면 CDP 왕복이 끼어 5~8ms 과대 측정돼 문턱 근처에서
  가짜 회귀가 난다(`docs/traps/TRP-022`).
- 연타 화면 판정은 행 감김·스크롤 아웃·프롬프트 재그리기에 깨진다(TRP-016). `while True: pass`·`for …: pass`는
  **한 줄 복합문**이라 빈 줄 Enter가 있어야 실행이 시작된다(3.14와 같다) — 그 단계를 빼면 Ctrl+C가 `... `
  프롬프트의 활성 읽기로 가 벤더 경로에서 `... ^C`만 남는다.
- StrictMode 이중 마운트 거동.
- 화면 행 텍스트(`.xterm-rows > div`)만 비교하면 출력 끝의 여분 빈 줄이 보이지 않는다. 개행 수는 커서 행 번호로
  단언한다(`docs/traps/TRP-006`).
- xterm이 키와 출력을 비동기로 그리므로 하니스는 입력이 커서 행에 그려진 것을 확인한 뒤 진행하고, Enter를 친 뒤에는 화면이
  바뀐 것을 확인하고 나서 새 프롬프트(`>>>`·`... `) 행을 기다린다. 그리기 전에 화면을 읽으면 낡은 프롬프트 행에 통과하고,
  새 프롬프트가 뜨기 전에 보낸 키는 버려진다(`docs/traps/TRP-005`).
- stdin 프롬프트(`x: `)는 읽기가 시작되기 전에 화면에 나온다(`write` 알림이 `readInput` 알림보다 먼저 그린다). 프롬프트 없는 `input()`은 화면 신호가 없다. 그래서 `waitLastEndsWith("x:")`가 참이어도 읽기가 시작됐다는 보장이 없어, 입력은 첫 글자가 에코될 때까지 재시도한다(`typeWhenReading`, 버려진 키는 화면에 흔적이 없어 안전하다, `docs/traps/TRP-005`).
- **취소도 같다**: 읽기가 열리기 전의 Ctrl+C는 활성 읽기가 없어 `ctrlCHandler`로 가 버려진다. `cancelWhenReading(text)`는 `typeWhenReading`으로 읽기를 확인한 뒤 Ctrl+C를 누른다(글자가 최소 하나 필요하다). 그 앞에 화면을 바꾸는 동작(빈 줄 제출 등)을 두면 무관한 재그리기를 첫 글자 에코로 오인해 글자를 잃는다 — `clear()` → 제출 → `cancelWhenReading` 순서만 쓴다.
- 출력 유무를 **부분일치로 판정하지 않는다**: 제출한 소스 줄이 화면에 에코되므로 `exec("…print('wrong')")`을 제출하면 화면에 `wrong`이 있다. 행 정확일치(`hasRow`)나 눌림 직전 개수를 기준선으로 잡은 증가분(`countOf`)으로 본다(RD-008에서 이 버그로 확인 하나가 거짓 통과했다).
- 취소 전 마지막 행이 이미 `>>>`인 확인(빈 프롬프트 취소)은 `waitPrompt(">>>")`가 낡은 행에 즉시 통과한다. 취소 줄(`KeyboardInterrupt`)이 나타나는 것을 먼저 기다린다.
- 출력이 나온 시점을 "행에 마커 포함"으로 기다릴 때는 입력한 코드 행을 뺀다. 코드 행이 같은 마커를 포함해 즉시 통과한다(`docs/traps/TRP-011`). 시간을 재는 확인은 경과 시간과 화면 끝을 로그에 남긴다.
- "이 로그가 없다"는 확인은 후속 출력에 밀려 뷰포트 밖으로 나간 행을 놓친다. 화면을 지우고(Ctrl+L) 한 번의 동작 직후 행 목록을
  정확히 단언한다(예: `gc.collect()` 직후 화면이 값 에코 한 줄뿐). 수정을 제거하는 변조로 확인이 실패하는지 봐서 검출력을 확인한다.
- 미확인으로 남은 것: **프로덕션 빌드, Firefox, Safari, `sync=false` 폴백**, 자동화 E2E(범위 밖).
- **세션 리셋·크래시(RD-010)**: worker 교체(`session-reset-check.mjs`, `_works/_completed/20260922-11-rd-010-session-reset/verify/`)는 `data-testid=status`의 상태 전이(`loading`→`ready`/`load-failed`)로 "리셋이 끝났다"를 기다린다 — 화면 행(안내 줄) 개수로 판정하면 xterm 뷰포트(기본 24행) 밖으로 밀려난 옛 행이 DOM에서 사라져 여러 번 반복한 뒤(실측 4번째부터) 무한 대기한다(`docs/traps/TRP-024`). 리셋 직전 Ctrl+C 경합(`Promise.all([ctrlC(), 리셋 클릭])`)도 N=10을 상태 전이 기준으로 돌려야 안정적이다. 취소 트레이스백 직후 곧바로 타이핑하면 첫 글자가 드물게 드롭된다(`docs/traps/TRP-005`류) — `h.settled()`로 화면이 멈춘 뒤 입력한다. `crashed` 유발은 `pyodide.code.run_js("setTimeout(() => { throw new Error('forced') }, 0)")`(동기 throw는 `JsException`이 되어 worker를 안 죽이므로 타이머 경로가 필요, RD-010 확정 17)이고 `pageerror` 기준선은 이 유발 1건만 허용(그 밖은 0).
- `cursorX===0`(개행 직후 아무것도 안 그린 상태에서 리셋) 분기는 idle 프롬프트가 항상 `>>> `까지 그려진 뒤에야 관찰 가능해(cursorX=4) 브라우저에서 실사용 경로로 재현되지 않는다(Enter와 리셋 클릭을 경합시켜도 매번 프롬프트가 먼저 그려짐, 4회 확인). `index.test.ts`가 `cursorX`를 직접 0으로 둔 단위 시험으로만 고정한다 — 모든 분기가 브라우저로 확인 가능한 것은 아니다.

## 9.4 측정·비교 기준
- 동등성 기준은 CPython 3.14.4를 pty(24×80, `TERM=xterm`)로 구동한 실측이다. 화면 비교는 pyte로 읽는다.
- 후보를 비교할 때는 OK/HANG/CRASH/DIRTY 같은 판정 축과 n을 정해 표로 남기고, "간격 0ms"처럼 합쳐져
  성공처럼 보이는 측정(TRP-018)과 "재전송 수 = 소실 수"라는 오독(TRP-025)을 피한다.

참고: `/work/cp949/pyodide-samples/apps/repl/DESIGN.md`("테스트 전략"),
`/work/cp949/pyodide-samples/apps/repl/src/repl/*.test.ts`,
`/work/cp949/pyodide-samples/apps/repl/src/test/`

## 9.5 검증 하니스 설계 규칙 (이전 구현의 측정 함정 11건 압축)

측정·테스트 방법론 함정은 전부 "측정이 통과했는데 사실이 아니다"라는 같은 모양이다. 규칙으로 압축한다.

1. **TRAP-18 (TRP-011) pty `_pyrepl` 화살표는 `TERM`에 맞춰 보낸다.** `TERM=xterm`이면 ↑ `\x1bOA`·↓ `\x1bOB`, `TERM=linux`면 `\x1b[A`·`\x1b[B`. 다른 쪽은 오류 없이 버려져 "↑ 무동작"으로 오인된다. 인식 여부는 "직전 입력이 다시 그려지는지"로 판정하고 `PYTHON_COLORS=0`·`NO_COLOR=1`로 색을 끈다(색 이스케이프가 `print(12345)` 부분 문자열 검사를 오탐으로 만든다). 홈 오염 방지로 `PYTHON_HISTORY`는 임시 파일로 고정한다. 시퀀스를 바꿔 한 번 확인하기 전에는 실측 결론을 쓰지 않는다.
2. **TRAP-19 (TRP-013) pty CPython의 무개행 stderr·stdin 중 stdout은 명시 flush로 잰다.** `sys.stderr.line_buffering=True`, `write_through=False`라 `\n`·`\r` 없는 조각은 다음 flush까지 안 나오고, 그 텍스트가 다음 케이스 바이트에 섞여 나온다. 실측 문장에 `sys.stderr.flush()`(또는 `flush=True`)를 명시하고, 바이트가 섞여 보이면 이전 케이스의 잔류부터 의심한다. 웹 REPL은 stderr 버퍼가 없어 무개행 조각을 즉시 표시하는 의도된 편차다.
3. **TRAP-20 (TRP-015) 배경 실행 pty 자식은 SIGINT 처분을 먼저 확인한다.** 비대화형 셸이 `&` 비동기 명령의 SIGINT를 SIG_IGN으로 두고 exec 뒤에도 유지된다. `pty.fork()` 자식에서 exec 전에 `signal.signal(signal.SIGINT, signal.SIG_DFL)`를 부르고, 스크립트 시작 시 자식의 `signal.getsignal(signal.SIGINT)`가 SIG_DFL인지 단언한다.
4. **TRAP-21 (TRP-018) Ctrl+C 연타는 간격을 스윕하고 눌림이 아니라 `KeyboardInterrupt` 수로 센다.** 간격 0(실제 약 1µs)은 쓰기가 합쳐져 눌림 한 번과 같아지고, pty의 0ms 송신은 커널이 `^C` 에코를 합친다. 간격 0·0.2·0.5·1·2·5·20·50ms를 스윕하되 0은 "합쳐짐" 셀로 따로 읽고, 실제 대상의 이벤트 타임스탬프로 간격 분포를 먼저 잰다. 결과를 종류별로 집계하고 종류가 모두 드러날 때까지 표본을 늘린다(3.14 pty는 50회에서 세 종류, 확률 3% 셀은 20회로는 안 보인다). 콜드(세션 첫 트레이스백)와 웜을 구분한다.
5. **TRAP-22 (TRP-023) `unhandledRejection` 리스너를 붙인 시험은 집계에 기대지 않는다.** vitest의 `catchError`가 해당 이벤트 프로세스 리스너 수가 1을 넘으면 집계하지 않는다(vitest 5.0.1). 리스너로 모은 목록의 단언(`expect(rejections).toEqual([])`)이 유일한 신호다. 리스너는 `onTestFinished`로 반드시 뗀다. vitest를 올릴 때 이 판정이 바뀌었는지 확인한다.
6. **TRAP-23 (TRP-024) 폴링 경로에는 JS 코드를 더하지 않는다.** 접근자·Proxy 비용은 폴링 횟수에 비례하고 폴링 밀도가 작업량마다 약 100배 다르다(맨몸 `while` 반복당 0.02~0.04회 대 `str(i)` 반복당 약 2.04회). 3M회 맨몸 루프 +10%만 보면 통과처럼 보이지만 `''.join(str(i) …)`는 2.93배다. 소실은 폴링 쪽이 아니라 눌림 쪽(ack + 재전송)에서 푼다. 폴링 경로를 건드리는 변경은 `str(i)` 루프로도 재고(plain 대비 1.03 이내, 10회 교차), 폴링 횟수는 카운터 래퍼로 센다.
7. **TRAP-24 (TRP-025) 재전송 횟수를 소실로 세지 않는다.** 폴링이 슬롯을 비운 뒤 핸들러가 ack를 올리기 전 약 40µs 창에 점검이 걸리면 가짜 재전송이 생긴다(5ms 점검에서 발생률 0.8%, 추적 11/11이 이 창). 소실은 `KeyboardInterrupt`가 0인 눌림이나 감시견이 살려야 했던 라운드로 센다. 통과선을 "재전송 0"이 아니라 "미소비 구간(슬롯이 2인 동안)의 재전송 0 + 중단 정확히 1회"로 나눠 잰다.
8. **TRAP-25 (TRP-028) 지연 측정은 눌림 시각을 무작위로 두고 N≥30의 최대값으로 판정한다.** 폴링을 pyodide 틱 클럭에 맡긴 대기는 최대 지연이 (반복 1회 시간)×12.5~13.1까지 늘어나는데, 눌림 시각 고정 하니스(브라우저 `sleep-0.01` 166ms)와 판정선 1초 단위 시험은 통과한다. 눌림 시각이 고정인 결과는 "위상 하나"임을 적고, 대기 시간 조합을 20ms 경계 근처까지 넓힌다. 시험은 지연 시간이 아니라 폴링 호출 횟수로 가른다.
   - **재확인 방법**(이 저장소, RD-009): `sleep-slice.py`의 `secs <= SLEEP_SLICE` 분기에서 `poll()` 한 줄을 지우고 `verify/node/sleep-stats.mjs --progs loop002,loop001 --n 30 --mode jspi`를 돌려 배수를 잰다. 실측 `loop002` 중앙값 12.2 → 187.6ms(15.4배)·최대 20.4 → 339.5ms(16.6배), `loop001` 중앙값 6.7 → 66.6ms(9.9배). 브라우저 쪽 같은 변조는 `sleep-0.01` 중앙값 28.44 → 96.79ms. 측정 결과는 실측 파일과 **다른 이름**으로 저장하고(같은 이름이면 정상 실측을 덮어쓴다) 곧바로 `git checkout --`로 원복한다. 판정 항목이 아니라 근거 기록이다.
9. **TRAP-26 (TRP-029) 블로킹 대기의 눌림은 별도 스레드로 넣는다.** 블로킹 대기 동안 Node 이벤트 루프가 멈춰 `setTimeout` 눌림이 대기가 끝난 뒤 도착하므로 `pressed > 0` 그리고 `sincePress < 1s`가 끊기지 않았는데도 만족된다(`time.sleep(3)`이 3006ms 걸렸는데 통과). `worker_threads` 눌림 스레드와 `process.hrtime.bigint()` 공유 시계를 쓰고, 눌림 뒤 지연뿐 아니라 실행 전체 시간과 `screen.stderr`(트레이스백)도 단언한다. 새 시험은 기준선 코드에서 RED인지 확인한다.
10. **TRAP-27 (TRP-034) 모듈 완성 후보는 개수·전체 목록을 단정하지 않는다.** `sys.path[0] == ''`라 cwd의 `.py` 파일이 후보가 되고 환경 모듈 집합도 다르다(3.14.4 네이티브 192개, pyodide 178개, 하니스 폴더 pty 196개). 시험·문서는 접두사·포함 여부·삽입 결과·구조(열 우선 배치, 200개 상한)를 단정하고, 후보 리터럴은 네이티브와 pyodide가 같은 케이스에만 쓴다. 문서에 개수를 적을 때는 측정 환경(빈 임시 cwd, 번들 버전)을 함께 적고, pty 측정 하니스는 자식 REPL의 cwd를 빈 임시 폴더로 고정한다.
11. **TRAP-28 (TRP-035) SIGINT를 심는 프로브는 실제 경로와 같은 순서로 쓰고 ack로 판정한다.** 핸들러가 요청 번호(슬롯 2)가 그대로면 재전송으로 보고 무시하므로, 슬롯 0에만 쓴 프로브는 "영향 없음"으로 오판된다. 프로브도 `Atomics.add(buffer, 2, 1)` 뒤 `Atomics.store(buffer, 0, 2)` 순서로 쓰고, 소비 여부는 슬롯 0이 아니라 ack(슬롯 1) 증가로 본다. "영향 없음" 결론 전에 같은 대상이 실제 Ctrl+C 경로에서는 끊기는지 양성 대조를 둔다.
12. **(TRP-022, 이 저장소 RD-009) 브라우저 지연은 페이지 안의 한 시계로 잰다.** `keyboard.press` 직전 Node `performance.now()` + `page.$$eval` 폴링으로 재면 폴링마다 CDP 왕복이 최소 2회 껴 평균 5~8ms를 보탠다. 실측에서 이 방식이 12셀 중 8셀을 30ms 문턱 바로 위(31.5~33.9ms)로 밀어 가짜 회귀를 만들었고, 같은 시행을 페이지 내부 keydown 리스너 + `MutationObserver`(같은 `performance.now()` 시계)로 재니 12/12셀이 문턱 안(22.19~29.98ms)이었다. 측정 대상(눌림 → 새 프롬프트가 보인 시각)은 바꾸지 않고 시계만 옮긴다. 문턱에서 5~10ms 안쪽 결과는 다른 시계로 한 번 더 재기 전에 회귀로 보고하지 않는다. 실패한 1차 측정 로그는 판단을 되돌릴 근거이므로 버리지 않는다.

참고: `/work/cp949/pyodide-samples/docs/repl/traps/` 의 TRP-011, TRP-013, TRP-015, TRP-018, TRP-023, TRP-024, TRP-025, TRP-028, TRP-029, TRP-034, TRP-035


## 9.6 이전 구현의 검증 자산 위치

### 9.6.1 단위 시험 (vitest)

- 실행: `pnpm --filter repl test`(= `vitest run`). 최종 규모 **32파일 / 781개**(RD-016 종료 시점 28/603 → RD-016a 29/774 → RD-012h 30/778 → RD-021 32/781).
- 기본 환경은 jsdom(`vite.config.ts`의 `test.environment`), 셸 컴포넌트는 Testing Library 렌더 스모크 하나뿐이다(`src/App.test.tsx`).
- **핵심은 `// @vitest-environment node` 파일들이다. 여기서는 실제 pyodide를 로드한다** — `pyodide@314.0.7`이 devDependency로 설치돼 있고 20개 안팎의 시험 파일이 `loadPyodide`를 직접 부른다. 실제 `PyodideConsole`·SIGINT 핸들러·stdin 콜백·완성 후처리·sink 바이트·`Readline` 출력까지 진짜로 돌린다.
- 대표 파일(전부 `/work/cp949/pyodide-samples/apps/repl/src/repl/` 아래): `sigint-handler*.test.ts`(기본/JSPI 없음/sleep 조각/프롬프트 유휴 4종), `interrupt-{buffer,connect,protocol,sender,watch}.test.ts`, `stdin-callback.test.ts`, `read-guard.test.ts`, `rpc.test.ts`, `tab-completion.test.ts`·`tab-completion-flow.test.ts`·`tab-reader.test.ts`·`complete-source.test.ts`·`import-gate.test.ts`(코퍼스 53줄), `multiline.test.ts`, `auto-indent*.test.ts`(파서 동등 포함), `terminal-sinks.test.ts`·`sink-writer.test.ts`, `submission-runner.test.ts`, `top-level-await.test.ts`, `webloop-reraise.test.ts`, `block-history`/`history-filter`·`output-tail`·`stdin-reader`·`repl-reader`·`paste-tabs`.
- 보조 도구: `src/test/fake-terminal.ts`(실제 sink 동작을 모사해야 한다는 교훈이 반영된 fake), `src/test/interrupt-presser.ts`(node worker_threads로 눌림 주입), `src/test/setup.ts`.
- 시험 품질 관행: 새 방어선은 **RED를 확인**하고, 구현을 뒤집는 **변이 검사**로 시험이 실제로 잡는지 확인했다(예: RD-021에서 가드 10/10, 전역 스트림 Writer 6/6, 유휴 폐기 6/6, 완성 중 취소 5/5).

### 9.6.2 브라우저 회귀 하니스

- 형태: 저장소 코드가 아닌 **작업 폴더의 Node 스크립트**(`browser-check*.mjs`, `*-probe.mjs`). Playwright `chromium.launch({ headless: true })`로 `http://localhost:4321`에 접속해 `.xterm-rows > div`의 텍스트 행을 읽고(NBSP→공백, 행 끝 공백 제거) 기대 행과 대조한다. `page.on('pageerror')`로 페이지 예외도 센다.
- 실행: 각 작업 폴더의 `run-harness.sh <스크립트 절대경로> <라벨>` — 포트 4321이 비어 있는지 확인하고 dev 서버를 띄운 뒤 `timeout ${HARNESS_TIMEOUT:-420} node <스크립트>`를 돌리고 서버를 죽인다. 결과·스크린샷은 그 폴더의 `results/`에 남는다. `STOP_AFTER=<시나리오 ID>`로 일부만 돌릴 수 있다.
- **회귀 기준선 5종**(모든 후속 RD가 같은 수·같은 실패 ID를 요구): RD-016 58/58, RD-016a 129/129, RD-012b 22/24(실패 E1·E2), RD-012c 20/24(실패 A1·C2·H1·J1), RD-006b 74/74. 여기에 `boot-press` N=30(부팅 중 Ctrl+C)이 붙는다.
- Ctrl+C 계열은 별도 매트릭스가 있다: RD-012d 매트릭스 6~7조합 × N=20(200/200), RD-012a 신규 10~11조합 × N=20(220/220), RD-012f 12조합 × N=20(240/240).
- 시나리오 단발 프로브(RD-021): `bg-input-guard-probe.mjs`, `bg-output-probe.mjs`, `getattr-loop-probe.mjs`, `stale-sigint-probe.mjs` — 각각 "배선을 빼면 실패한다"까지 확인했다.
- 주요 경로: `/work/cp949/pyodide-samples/_works/_completed/20260921-05-rd-021-async-prompt-channel/`(run-harness.sh, 프로브 4종), `.../20260920-04-rd-016-tab-completion/reference/browser-check.mjs`, `.../20260921-01-rd-016a-import-completion/reference/browser-check-import.mjs`, `.../20260919-11-rd-006b-repl-prompt-join/reference/browser-check.mjs`, `.../20260919-05-rd-012b-prompt-cancel/`, `.../20260919-09-rd-012c-input-ctrl-c/`.
- 각 작업 폴더의 `DELTA-NN.md`가 수정 전/후 화면 행 diff와 측정치를 담은 근거 문서다.

### 9.6.3 CPython 3.14 pty 실측 스크립트

- 하니스: `ptyrepl.py` — `python3.14`를 pty로 띄우고 `pyte`로 화면을 렌더링한다(`TERM=xterm`, 인터프리터는 `PY314` 환경변수로 교체 가능, `pyte`/`wcwidth`는 폴더 안 `pylib`에서 읽어 재현성 확보). 키는 바이트로 보낸다(`\x1bOD` 등, 여러 줄은 bracketed paste `\x1b[200~…\x1b[201~`).
- Tab 완성 측정 일습: `/work/cp949/pyodide-samples/_works/_completed/20260921-01-rd-016a-import-completion/reference/measure-3.14/` — `ptyrepl.py`, `runcases_import.py`, `native_complete.py`, `pyodide_complete.mjs`, `compare_native_pyodide.py`(네이티브 대 pyodide 95케이스), `build_gate_corpus.py`·`gate_js.mjs`(게이트 코퍼스 53줄), `pyodide_zip_patch_check.mjs`, `verify_expectations.py`, 요약 `SUMMARY-import.md`.
- 이름·속성 완성 측정: `/work/cp949/pyodide-samples/_works/_completed/20260920-04-rd-016-tab-completion/reference/measure-3.14/`(`s3`~`s13` 시나리오 스크립트, `compare.py`).
- 프롬프트·stdin 측정: `.../20260919-11-rd-006b-repl-prompt-join/reference/pty/probe*.py`, `.../20260919-10-rd-006a-input-line-prompt/reference/pty_input*.py`, `.../20260919-08-rd-011b-stderr-newline/reference/pty_stderr.py`.
- sleep·인터럽트 Node 프로브: `.../20260920-03-rd-012f-time-sleep-slice/reference/probe-*.mjs`.
- 이 측정 폴더들은 `_works/` 아래의 작업 기록이며 저장소 코드가 아니다(일부는 gitignore 대상). 새 저장소에서 재활용하려면 경로를 복사해 쓰되, 기준 인터프리터 버전(3.14.4)과 pyodide 번들 버전(3.14.2)의 차이를 명시해야 한다.

### 9.6.4 그 밖의 관행

- 각 RD는 착수 전 설계 문서의 해당 절을 읽고, 규칙을 정하기 전에 **3.14 pty로 먼저 재보는**("그릴링") 절차를 거쳤다. 후보 안을 비교해 기각 사유(성능 수치 포함)를 남겼다.
- 함정은 `TRP-0NN` 번호로 따로 기록했다(예: pyodide 시그널 폴링의 비원자성, `println`의 개행 추가, Python 인덱스와 JS 인덱스, 부분 문자열 게이트의 대가).
- 프로덕션 빌드(`vite build`)는 worker의 top-level `await`를 Vite가 기본 `iife`로 번들링하려다 실패한다 — 실행 환경을 로컬 dev로 한정했기 때문에 고치지 않았다. 새 구현에서 배포를 원하면 초기에 포맷을 정해야 한다.

참고: `/work/cp949/pyodide-samples/apps/repl/src/`, `/work/cp949/pyodide-samples/_works/_completed/`

### 9.6.5 이 저장소의 브라우저 하니스(RD-010부터)

공유 라이브러리 `apps/demo/e2e/lib.mjs`(저장소 devDependency, RD-010 DELTA-00에서 RD-009 하니스를 이관)가
`open(url)`을 export한다 — Playwright로 페이지를 열고 화면 행 읽기(`rows`·`tail`·`rowClasses`·`cursorRow`),
타이핑·Enter·대기(`type`·`enter`·`submit`·`waitPrompt`·`waitFor`·`typeWhenReading`·`cancelWhenReading`),
Ctrl+C 계열(`ctrlC`·`holdCtrlC`·`ctrlCBurst`), 확인 기록(`step`·`checks`·`notes`·`finish`)을 돌려준다. 각
RD의 확인 스크립트는 이 파일을 **복사하지 않고 import**하며 `_works/<작업>/verify/`에 둔다(저장소 코드가
아니다, `.gitignore` 대상). `ONLY=<이름,…>` 환경변수로 `step` 이름이 그 접두어로 시작하는 것만 골라 돈다.

RD-010의 `session-reset-check.mjs`(`_works/_completed/20260922-11-rd-010-session-reset/verify/`)가 이
구조의 첫 사례다: dev 서버(5173)에 대해 절 8개(`reset`·`cursor`·`ctrll`·`carry`·`ccreset`·`exit`·`crash`·
`strict`)를 순서대로 돌리고, `pnpm --filter demo build && pnpm --filter demo preview`(4173)에 대해
`reset`·`exit`·`crash` 3절을 재실행한다. 양성 대조는 소스를 변조(`git status --short`가 비어 있는 상태에서
시작해 원복 뒤 다시 비어 있는지 확인)한 뒤 dev 서버가 HMR로 반영하길 기다렸다 재실행하는 방식으로
했다(`verify/positive-controls.md`).

RD-011의 `multiline-check.mjs`(`_works/_completed/20260923-12-rd-011-multiline-submit/verify/`)는 절 8개
(`paste`·`tab`·`parse`·`stop`·`block`·`shift`·`recall`·`input`, dev 18개 확인)를 순서대로 돌리고,
preview(4173)에 대해 `paste`·`tab`·`parse` 3절을 재실행한다. 이 RD가 `lib.mjs`에 더한 `paste(text)`는 먼저
실제 클립보드 경로(`context().grantPermissions(["clipboard-read","clipboard-write"])` +
`navigator.clipboard.writeText` + `Control+V`)를 시도한다 — headless Chromium에서는 `writeText`는 성공해도
`Control+V`가 화면을 바꾸지 않고(실측), 대체로 시도한 `page.keyboard.insertText()`도 CDP가 삽입 이벤트에서
`\n`을 지워 여러 줄이 한 줄로 뭉개진다. 그래서 `paste()`는 화면이 안 바뀌면 `textarea`에 합성
`ClipboardEvent("paste")`를 직접 dispatch하는 경로로 대체한다 — xterm이 실제로 듣는 이벤트(`clipboardData.
getData("text/plain")` → `coreService.triggerDataEvent`)라 `readPaste` 이후 코드 경로는 실제 붙여넣기와
같다. 변이 4건은 `verify/positive-controls.md`에 기록(소스 변조 → dev HMR 반영 대기 → `ONLY=` 재실행 →
`git checkout --` 원복, RD-010과 같은 방식).

RD-013의 `auto-indent-check.mjs`(`_works/_completed/20260923-14-rd-013-auto-indent/verify/`)는 절 10개
(`prefill`·`backspace`·`unit`·`history`·`shift`·`alt`·`paste`·`cancel`·`input`·`multiline-shift`, dev
26개 확인)를 순서대로 돌리고, preview(4173)에 대해 `prefill`·`shift`·`unit` 3절을 재실행한다. `lib.mjs`에
없는 `cursorCol()`(커서 앞 형제 노드의 `textContent` 길이 합산)을 이 스크립트가 로컬로 더했다 — `rows()`의
끝 공백 제거가 "프리필만 있고 아직 타이핑하지 않은" 상태의 공백을 지워 버려 행 문자열 판정이 못 미친다.
벤더 재그리기가 비동기라(`state.update`/`refresh`의 `term.write` 콜백) `Backspace` 직후 `cursorCol()`을
곧바로 읽으면 낡은 값을 보므로 250~300ms 유예를 넣는다. 양성 대조 2건은 `verify/positive-controls.md`에
기록 — ① `readOptions`의 `prefill` 제거(`prefill`·`unit` 절 실패, `shift`는 `onKey`만으로 계산돼 죽지
않는다), ② `onKey` 제거(`backspace`·`shift`·`alt`·`cancel` 대부분 실패). 둘을 합치면 배선 전체가 커버된다.

RD-015의 `tab-check.mjs`(`_works/_completed/20260923-16-rd-015-tab-completion/verify/`)는 이전 RD-016
브라우저 58개(C1~C12)를 절 단위로 이식하고 C13(큐)·C14(완성 중 Ctrl+C)를 더해 총 68개 확인을 순서대로
돌리고, preview(4173)에 대해 C1·C3·C8·C11 4절(30개)을 재실행한다. C12(지연 측정)는 페이지 내부
keydown 리스너 + `MutationObserver`(같은 `performance.now()` 시계, TRP-022)로 `a.` 속성 후보(두 번째 Tab이
목록을 화면에 반영한 시각, N=20)와 빈 스템 공백 삽입(첫 Tab이 동기 삽입한 시각, N=20)을 웜(세션 첫 Tab
제외)으로 잰다 — 필수 판정은 정지 0 + 최대 200ms 이내(RD-009 시나리오와 같은 판정선), 30ms는 참고치로만
기록한다(실측: `a.` 중앙값 25.8ms·최대 33.5ms, 빈 스템 중앙값 10.9ms·최대 17.0ms). `import os.pa`(지연
측정 3종째)는 RD-016 뒤로 미룬다(미실행). 양성 대조 3건은 `verify/positive-controls.md`에 RD-010과 같은
방식으로 기록한다 — 큐(`queuedTabs.push`) 제거는 브라우저 C13 실패로 확인했지만, `readEnded` 배선 제거·
`interruptCompletion` 무력화는 계획한 브라우저 시나리오(C8·C14) 대신 `index.test.ts`의 세션 조립 수준
단위 시험("프롬프트 취소 중 완성 요청이 있으면 SIGINT를 1회 보낸다")으로 확인했다 — C8은 Playwright의
연속 `press`가 항상 완성 왕복(~25ms)보다 빨라 "완성이 다음 줄에 끼어드는" 경합이 재현되지 않고, C14는
`exec()`/`eval()` 아티팩트(아래)로 정상 코드에서도 한때 실패해 변이 구분력이 없었기 때문이다(`DELTA-05.md`
"## 결정"). C14는 재현 클래스를 `exec()`가 아니라 REPL 프롬프트에 직접 멀티라인으로 타이핑해 정의해야
`co_filename == "<console>"` 규칙이 매치돼 정상 복귀한다(`10-parity-deviations.md`에 좁은 경계 사례로 등록).
