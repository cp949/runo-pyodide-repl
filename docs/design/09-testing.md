# 테스트·검증 전략

> 이 문서의 규칙·상수는 이전 구현(`/work/cp949/pyodide-samples/apps/repl`, 읽기 전용 참고)이 CPython 3.14.4 pty 실측과 브라우저 회귀로 확정한 것이다. 새 구현은 통신 계층만 바꾸고(`docs/design/00-architecture.md`, `01-protocols.md`) 이 규칙은 그대로 지킨다. 절 끝의 "참고:" 경로는 이전 구현의 근거 위치다.

파일 이름은 이전 구현의 시험 인벤토리다. 새 구현은 같은 검증 범위를 목표로 하되 파일 배치는 `packages/pyodide-repl/src/**/*.test.ts`를 따른다. 새로 추가되는 시험 대상: `rpc`(실제 `MessageChannel`), `stdin-mailbox`(node `worker_threads`로 실제 `Atomics.wait` 왕복·청크·취소), 초기화 프레임.

## 9.1 node + 실제 pyodide(`// @vitest-environment node`)
파이썬 의미·pyodide 내부 가정·프로토콜 불변식을 실제로 돌려 고정한다. 해당 파일:
`sigint-handler.test.ts`, `sigint-handler-idle.test.ts`, `sigint-handler-sleep-slice.test.ts`,
`sigint-handler-nojspi.test.ts`(Node에서 `WebAssembly.Suspending`을 지워 JSPI 없는 경로),
`interrupt-buffer.test.ts`, `interrupt-connect.test.ts`, `webloop-reraise.test.ts`,
`submission-runner.test.ts`, `multiline.test.ts`, `stdin-callback.test.ts`, `top-level-await.test.ts`,
`terminal-sinks.test.ts`(실제 `PyodideConsole`·sink·`Readline`의 터미널 바이트),
`complete-source.test.ts`, `import-gate.test.ts`, `tab-completion.test.ts`,
`tab-completion-flow.test.ts`(main·worker 루프·실제 후보 계산 통합), `auto-indent-parity.test.ts`
(pyodide에 든 `_pyrepl.readline` 함수와 차분 검증), `rpc.test.ts`(실제 `MessageChannel`).
- 눌림은 `src/test/interrupt-presser.ts`가 `node:worker_threads`로 실제 스레드에서 버퍼에 쓴다.
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
  `worker/console.test.ts`, `worker/submission-runner.test.ts`, `terminal/sinks-pyodide.test.ts`, `worker/boot.test.ts`.
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
  - `exit()`를 실행하면 asyncio가 `SystemExit`을 WebLoop로 다시 던져 vitest가 `Unhandled Rejection`으로 실패 종료한다.
    `vitest.config.ts`의 `onUnhandledError`가 `PythonError` + 줄 시작 `SystemExit`만 무시하는 임시 조치이고(RD-009의
    webloop 재보고 억제가 들어오면 제거), `process.on("unhandledRejection")`은 쓰지 않는다(집계에서 빠진다, TRAP-22).
  - 시험 입력 함정: `1 +`·`foo bar` 같은 EOF 문법 오류는 pyodide 314.0.7의 `pyconsole.push`가 `_IncompleteInputError:
    incomplete input`으로 표시한다. `runLine`은 이를 표준 `SyntaxError: invalid syntax`로 정규화해 돌려주므로(`02-console-core.md`
    5.1) `push`를 직접 부르는 시험만 원문을 기대해야 한다(`x = = 1`은 원문도 `SyntaxError: invalid syntax`). 한 줄에 `;`로
    이은 앞 식문장의 값은 콘솔이 stdout으로 에코해 꼬리를 비우므로, 개행 없는 출력 시험은 값이 없는
    `print(..., end="")`로 만든다.

## 9.2 jsdom(기본 환경) + 실제 `Readline` + 가짜 터미널 / 가짜 타이머
`auto-indent.test.ts`, `auto-indent-reader.test.ts`, `tab-reader.test.ts`, `stdin-reader.test.ts`,
`repl-reader.test.ts`, `rewind-tail.test.ts`, `read-guard.test.ts`, `output-tail.test.ts`, `sink-writer.test.ts`,
`worker/repl-loop.test.ts`(pyodide 없이 주입한 `readLine`·`run` 각본으로 프롬프트·`pending` 전달, 종료, 실행 오류 복구, 읽기
요청 거절 정책을 고정), `index.test.ts`(`createRepl`),
`history-filter.test.ts`, `paste-tabs.test.ts`, `interrupt-protocol.test.ts`,
`interrupt-sender.test.ts`(가짜 타이머로 전송·재전송·10회 상한·읽기 순서), `interrupt-watch.test.ts`,
`App.test.tsx`(배선: 전송·재전송, `readLine`/`readInput` 진입, 세션 리셋, 언마운트).
- 가짜 터미널(`src/test/fake-terminal.ts`)은 `write` 콜백을 동기/비동기 둘 다 돌릴 수 있어야 한다
  (동기만 쓰면 TRP-008을 놓친다). history는 ↑ 재호출로만 관찰한다.
  `createFakeTerminal({ asyncWrite, cols, rows })`가 `{ term, screen, written, type, paste, keyDown, flush, disposedBufferReads }`를 돌려준다.
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
  동기 fake로 대신한다.
- **변이 검사(mutation)** 를 관행으로 쓴다: 요청 번호와 SIGINT 쓰기 순서 뒤집기, 송신기가 ack를 먼저 읽기,
  핸들러 ack 위치 옮기기, 감시 타이머 ack를 비교 교환과 무관하게 올리기, 연결이 무조건 ack하기 등이 각각
  해당 테스트를 실패시키는지 확인했다.

## 9.3 브라우저(Playwright headless Chromium, dev 서버)로만 확인되는 것
- SharedArrayBuffer/Atomics 동기 브리지 결합, `sync === true` 확인, COOP/COEP 의존 동작.
- 실제 xterm의 **비동기 파싱**과 `isWrapped`·flush 타이밍(TRP-016/017 계열), 꼬리 재그리기 화면.
- 눌림 간격·소실률·위험 구간 같은 타이밍 통계(연타 매트릭스 조합별 N=20, `while True: pass` 단일 눌림
  N=200 등), 부팅 중 Ctrl+C(N=30), 정지한 실행 12조합.
- StrictMode 이중 마운트 거동.
- 화면 행 텍스트(`.xterm-rows > div`)만 비교하면 출력 끝의 여분 빈 줄이 보이지 않는다. 개행 수는 커서 행 번호로
  단언한다(`docs/traps/TRP-006`).
- xterm이 키와 출력을 비동기로 그리므로 하니스는 입력이 커서 행에 그려진 것을 확인한 뒤 진행하고, Enter를 친 뒤에는 화면이
  바뀐 것을 확인하고 나서 새 프롬프트(`>>>`·`... `) 행을 기다린다. 그리기 전에 화면을 읽으면 낡은 프롬프트 행에 통과하고,
  새 프롬프트가 뜨기 전에 보낸 키는 버려진다(`docs/traps/TRP-005`).
- "이 로그가 없다"는 확인은 후속 출력에 밀려 뷰포트 밖으로 나간 행을 놓친다. 화면을 지우고(Ctrl+L) 한 번의 동작 직후 행 목록을
  정확히 단언한다(예: `gc.collect()` 직후 화면이 값 에코 한 줄뿐). 수정을 제거하는 변조로 확인이 실패하는지 봐서 검출력을 확인한다.
- 미확인으로 남은 것: **프로덕션 빌드, Firefox, Safari, `sync=false` 폴백**, 자동화 E2E(범위 밖).

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
9. **TRAP-26 (TRP-029) 블로킹 대기의 눌림은 별도 스레드로 넣는다.** 블로킹 대기 동안 Node 이벤트 루프가 멈춰 `setTimeout` 눌림이 대기가 끝난 뒤 도착하므로 `pressed > 0` 그리고 `sincePress < 1s`가 끊기지 않았는데도 만족된다(`time.sleep(3)`이 3006ms 걸렸는데 통과). `worker_threads` 눌림 스레드와 `process.hrtime.bigint()` 공유 시계를 쓰고, 눌림 뒤 지연뿐 아니라 실행 전체 시간과 `screen.stderr`(트레이스백)도 단언한다. 새 시험은 기준선 코드에서 RED인지 확인한다.
10. **TRAP-27 (TRP-034) 모듈 완성 후보는 개수·전체 목록을 단정하지 않는다.** `sys.path[0] == ''`라 cwd의 `.py` 파일이 후보가 되고 환경 모듈 집합도 다르다(3.14.4 네이티브 192개, pyodide 178개, 하니스 폴더 pty 196개). 시험·문서는 접두사·포함 여부·삽입 결과·구조(열 우선 배치, 200개 상한)를 단정하고, 후보 리터럴은 네이티브와 pyodide가 같은 케이스에만 쓴다. 문서에 개수를 적을 때는 측정 환경(빈 임시 cwd, 번들 버전)을 함께 적고, pty 측정 하니스는 자식 REPL의 cwd를 빈 임시 폴더로 고정한다.
11. **TRAP-28 (TRP-035) SIGINT를 심는 프로브는 실제 경로와 같은 순서로 쓰고 ack로 판정한다.** 핸들러가 요청 번호(슬롯 2)가 그대로면 재전송으로 보고 무시하므로, 슬롯 0에만 쓴 프로브는 "영향 없음"으로 오판된다. 프로브도 `Atomics.add(buffer, 2, 1)` 뒤 `Atomics.store(buffer, 0, 2)` 순서로 쓰고, 소비 여부는 슬롯 0이 아니라 ack(슬롯 1) 증가로 본다. "영향 없음" 결론 전에 같은 대상이 실제 Ctrl+C 경로에서는 끊기는지 양성 대조를 둔다.

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
