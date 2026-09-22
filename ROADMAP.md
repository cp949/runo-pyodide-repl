# runo-pyodide-repl 로드맵

구현 순서와 완료 기준만 담는다. 왜 이렇게 하는지, 규칙·상수, 프로토콜은 `DESIGN.md`와 `docs/design/`에 있다. 각 항목을 시작하기 전에 `DESIGN.md`의 읽기 순서를 따라 해당 절을 먼저 읽는다. 실행 절차는 `docs/agents/rubber-workflow.md`(DELTA 단위, `dev` 브랜치)다.

이 저장소는 `/work/cp949/pyodide-samples/apps/repl`(이전 구현)을 coincident 없이 재개발한다. 각 항목의 "이전:"은 `docs/design/12-previous-implementation.md`의 이전 RD 번호이고, 그 항목의 시나리오·규칙·측정치를 그대로 계승한다.

## ID 규칙

RD-001, RD-002, ... 순증가. 완료 후 사이에 항목을 끼워 넣어야 하면 `RD-001a`, `RD-001b` 형태로 추가한다(뒤 번호를 밀지 않는다).

## 상태 표기

`대기` / `진행중` / `완료` / `보류`. 다른 RD가 완료 기준으로 품은 항목은 `RD-NNN에 흡수`로 적는다.

## 후속 후보 등록 규칙

- RD로 등록하려면 **재현 가능한 사용자 시나리오**와 **관찰 가능한 완료 기준**이 둘 다 있어야 한다. 하나라도 없으면 해당 설계 문서의 "알려진 한계·편차"(`docs/design/10-parity-deviations.md`)에 한 줄로 남긴다.
- 완료 기준이 "착수 시 정한다"인 채로 등록하지 않는다.
- `docs/design/10-parity-deviations.md` 2절 "범위 밖"의 차이는 등록하지 않는다.
- 브라우저 회귀 기준선(아래 RD-018)은 모든 후속 항목의 완료 기준에 "기준선과 같다"로 포함한다.

## 공통 완료 조건

모든 항목: `pnpm check-types`, `pnpm lint`, `pnpm test`, `pnpm build` 통과. 새 방어선(가드·프로토콜 규칙)은 단위 시험에서 RED를 확인하고, 구현을 뒤집는 변이 검사로 시험이 실제로 잡는지 확인한다(`docs/design/09-testing.md`).

---

## Phase 0 — 기반과 프로토콜

### RD-001 — 워크스페이스 정비와 xterm-readline 벤더링

상태: 완료 · 이전: RD-001, RD-004(일부) · 설계: `00-architecture.md` 4·6절, `06-editing.md` 6.1, ADR-0003, ADR-0004

`/work/thrd/xterm-readline`(strtok/xterm-readline 1.2.2, MIT)의 `src/*.ts`를 `packages/xterm-readline`(`@cp949/runo-xterm-readline`, private)으로 복사한다. `LICENSE-MIT`·저작권 고지 유지, 빌드는 tsdown(ESM + d.ts), 테스트는 jest → vitest 이식(`history·keymap·line·readline·render·state·tty·vterm` 8개 파일, `vterm.ts`는 시험 전용 헬퍼). `InputType`·`History`·`State`·`Tty`를 export하고, `History`에 `persist: false` 옵션을 추가한다. `packages/pyodide-repl`에 `@xterm/xterm@6`·`@cp949/runo-xterm-readline`(workspace) 의존과 `pyodide@314.0.7` devDependency를 추가한다. `apps/demo`에 COOP/COEP 헤더를 `server.headers`와 `preview.headers` 둘 다에, `worker.format: 'es'`를 넣고, 얇은 `src/repl.worker.ts`와 `new Worker(new URL(...), { type: 'module' })` 생성 경로를 확인한다.

시나리오: `pnpm dev`로 뜬 페이지와 `pnpm build && pnpm preview`로 뜬 페이지 모두 `crossOriginIsolated === true`다. worker가 생성되고 main이 보낸 초기화 프레임을 받아 `console.log`로 에코한다.

완료 기준:
- 벤더링 패키지의 이식된 시험 8개 파일이 vitest에서 통과한다. 원본 대비 변경은 export 추가·`persist` 옵션·빌드 설정뿐이다(기능 수정은 뒤 항목에서).
- dev·preview 양쪽에서 `crossOriginIsolated`가 참이다(브라우저 콘솔 확인 또는 Playwright 1회).
- 프로덕션 빌드에서 worker가 ES 모듈로 번들되고 top-level `await`가 든 worker 파일이 빌드에 실패하지 않는다.
- 루트 `pnpm build`·`lint`·`check-types`·`test` 통과.

인계: `packages/pyodide-repl/src/worker.ts`의 `runReplWorker()`는 초기화 프레임 에코 뼈대였다(RD-002의 `init-frame.ts`가 `kind` 인라인 검사를 대체했고, RD-004에서 본문을 채웠다). `apps/demo/src/App.tsx`의 인라인 부분 프레임은 RD-004에서 `createRepl`(`createWorker`·채널 생성)이 대체했다. 워크스페이스 빌드 규칙(`exports`의 `development` 조건, `check-types`의 `^build`)은 `00-architecture.md` 4.4.

### RD-002 — 프로토콜 코어 (RPC·stdin 메일박스·interrupt buffer·초기화 프레임)

상태: 완료 · 이전: RD-002, RD-021(RPC 부분), RD-012e(버퍼 슬롯) · 설계: `01-protocols.md` 전체, ADR-0002

`packages/pyodide-repl/src/protocol/`에 `rpc.ts`, `stdin-mailbox.ts`, `interrupt-protocol.ts`, `init-frame.ts`를 만든다. pyodide 없이 순수 프로토콜만 구현·시험한다.

시나리오: node `worker_threads`에서 main 역할 스레드가 worker 역할 스레드에 초기화 프레임을 보내고, worker가 `readLine` 요청 → main 응답, main `complete` 요청 → worker 응답, worker `readInput` 알림 → `mailbox.wait()` 정지 → main `deliver("abc")` → worker가 `"abc"`를 받는다.

완료 기준:
- RPC: 요청/응답/알림, `null` 결과 보존, 핸들러 예외 → `ok:false`, 없는 메서드, `dispose()` 시 대기 요청 reject. 실제 `MessageChannel`로 시험.
- 메일박스: `01-protocols.md` 2.4의 시험 전부(한 청크, 정확히 64KiB, 64KiB+1 두 청크, 멀티바이트 경계, 빈 문자열, `cancel`, `fail`). `Atomics.waitAsync` 없는 환경의 폴링 폴백 시험.
- interrupt buffer: `signalInterrupt`(SEQ 먼저, SIGNAL 나중), `acknowledgeInterrupt`, `discardPendingInterrupt`(지운 경우만 ack), `hasProtocolSlots` 시험.
- 변이 검사: `readInput` 알림을 `wait()` 뒤로 옮기면 시험이 멈춤을 잡는다. `FLAG_LAST` 누락, SEQ/SIGNAL 순서 뒤집기가 각각 실패한다.

인계: `protocol/`의 공개 표면은 `createRpc`(`call`·`notify`·`dispose`), `createStdinMailbox`·`createMailboxWriter`(`deliver`·`cancel`·`fail`)·`createMailboxReader`(`wait`), `createInterruptBuffer`·`signalInterrupt`·`acknowledgeInterrupt`·`discardPendingInterrupt`·`hasProtocolSlots`, `InitFrame`·`parseInitFrame`·`postInitFrame`이다. `readInput` 알림 → `wait()` 순서는 이 RD에서 시험용 worker 역할(`src/test/roles/repl-worker.ts`)만 가졌다. RD-006이 `stdin-callback.ts`에 그 순서를 프로덕션 코드로 옮기고 같은 변이 검사(알림을 `wait()` 뒤로 이동)를 걸었다(`worker/stdin-callback.test.ts`). SEQ/SIGNAL 메모리 순서는 단위 시험(`Atomics.store` 가로채기)만 잡아, RD-007이 눌림 주입 스레드(`src/test/roles/interrupt-presser.ts`)와 N=3000 통계로 다시 봤다(소실 0). worker 스레드 시험 하니스(`src/test/thread.ts`)와 규칙은 `09-testing.md` 9.1. `runReplWorker()`는 `parseInitFrame`으로 프레임을 검증하고 에코까지만 했으며(RD-004에서 본문을 채웠다), 데모의 임시 프레임(`apps/demo/src/App.tsx`)은 검증을 통과하는 형태로 바뀌었고 RD-004에서 `createRepl`(`createWorker`·채널 생성)이 대체했다. 비격리 페이지에서는 `createRepl`이 worker를 만들지 않고 경고만 낸다(RD-004, ADR-0004). 함정: `docs/traps/` TRP-002·TRP-003.

### RD-003 — 터미널 마운트와 줄 편집

상태: 완료 · 이전: RD-003, RD-004 · 설계: `06-editing.md` 6.1

`createRepl`의 main 쪽 뼈대: `Terminal` 마운트, 벤더링 readline 생성(`persist: false`), 읽기 1회 요청 API. 아직 pyodide는 없다.

시나리오: 화면에 터미널이 뜨고 타이핑이 에코된다. 백스페이스·←/→로 줄을 고치고 ↑/↓로 이전 줄을 불러온다. Enter로 한 줄이 호출자에게 전달된다.

완료 기준: 위 시나리오(브라우저 수동 또는 Playwright). 새로고침 뒤 history가 비어 있다(localStorage 미사용). jsdom + 실제 `Readline` + 가짜 터미널 시험이 도는 `src/test/fake-terminal.ts`가 있다(write 콜백을 동기/비동기 둘 다 돌릴 수 있어야 한다, `09-testing.md` 9.2).

인계: RD-003 시점의 `createRepl({ terminal })`은 부분 구현이었다(`00-architecture.md` 4.1, RD-004에서 `createWorker`·`pyodide`·`onStatus` 옵션과 `crossOriginIsolated` 핸들 속성이 늘었다). 옵션은 `terminal`뿐이었고(`readline?`은 뺐다) 핸들은 임시 `readLine(prompt): Promise<string>`과 `dispose()`였다. `readLine`은 RD-005에서 worker의 REPL 루프가 읽기를 요청하면 핸들에서 빠진다. 열린 읽기가 있을 때 다시 부르면 `Error`로 reject한다(벤더 `Readline`은 열린 읽기를 교체하고 앞 promise를 끝내지 않는다). Terminal은 호출자(데모 `ReplView`)가 `new Terminal({ cursorBlink: true })`(80×24 고정, FitAddon 없음)로 만들고 dispose하며 코어는 `terminal.loadAddon(readline)`만 한다. 벤더 `Readline.dispose()`는 `term`을 비우고 대기 중 읽기를 `Error`로 reject하는 멱등 연산으로 고쳤다(`packages/xterm-readline/README.md`, 이전 구현 TRP-001을 소스에서 처리). 시험: `src/test/fake-terminal.ts`의 `createFakeTerminal({ asyncWrite })`가 `type()`·`paste()`·`keyDown()`·`flush()`·`disposedBufferReads`를 준다(화면 모델은 없고, RD-005·006의 꼬리 재그리기가 처음 필요로 할 때 얹는다). 실제 xterm `Terminal`은 jsdom에서 `open()`이 실패해(`matchMedia` 없음) 브라우저에서만 쓴다. vitest는 워크스페이스 패키지를 `development` 조건(`src`)으로 푼다. 데모: `ReplView.tsx`와 임시 읽기 루프 `echo-loop.ts`(받은 줄을 `[read] <JSON 문자열>`로 되찍음, RD-004에서 삭제했다). `App.tsx`의 임시 worker effect와 초기화 프레임은 RD-004에서 `createRepl`이 대체했다. 알려진 한계: 읽기가 없는 구간(Enter 직후 약 10~20ms, RD-005부터는 실행 중 전체)에 친 키는 벤더 `Readline`이 버린다(`10-parity-deviations.md` 32). 브라우저 하니스는 새 프롬프트가 보인 뒤에 입력해야 한다. 검증 스크립트는 저장소에 없고 RD-018이 보관한다.

### RD-004 — pyodide 로드, 배너, 출력 sink 4종, 전역 스트림

상태: 완료 · 이전: RD-005, RD-009(로드 실패), RD-011a, RD-011b, RD-015, RD-021(전역 스트림) · 설계: `05-output.md`, `01-protocols.md` 1.2·4절

worker 진입점 `runReplWorker()`: 초기화 프레임 수신 → CDN `loadPyodide` → `ready`/`loadFailed` 알림. main 쪽 `sinks.ts`(4종 + 꼬리 추적)와 worker 쪽 `sink-writer.ts`(전역 stdout/stderr Writer). 아직 REPL 루프는 없고 worker가 시험용 코드를 실행해 출력만 낸다. `createRepl`에 `createWorker`·`pyodide`·`onStatus` 옵션을 추가하며 `apps/demo/src/App.tsx`의 임시 worker effect와 초기화 프레임 생성을 대체한다.

시나리오: 페이지를 열면 `Python 3.14.2 (...)` 배너가 뜬다. `print("x", end="")`가 개행 없이 즉시 보이고, `print("\r50%", end="")` → `print("\r100%", end="")`가 같은 줄에서 갱신된다. `print("err", file=sys.stderr)`가 빨강이고 뒤에 빈 줄이 없다. CDN을 막고 열면 앱이 죽지 않고 터미널에 로드 실패가 찍히며 상태 Chip이 실패를 보인다. `crossOriginIsolated`가 거짓인 페이지에서는 경고 한 줄이 나온다.

완료 기준:
- 개행 계약: `writeOutput`/`writeError`는 끝 개행 없는 텍스트를 받고 sink가 `\r\n`을 붙인다. `write`/`writeErrorRaw`는 조각 그대로, 빈 조각은 무출력, stderr 빨강은 조각마다 열고 닫는다. 실제 sink + `Readline`로 터미널 바이트를 검사하는 시험(이전 `terminal-sinks.test.ts` 상당).
- 3.14.4 pty 기준표와 같다: `print("err", file=sys.stderr)` → `err\r\n`, `sys.stderr.write("a\nb\n")` 뒤 빈 줄 없음, stdout/stderr 교차 순서 보존.
- 전역 스트림 Writer: 바이트 수 반환, 청크 경계의 멀티바이트 이어 붙임(node + 실제 pyodide, 변이 검사 6종 상당).
- 로드 실패 경로와 비격리 경고 경로가 시험 또는 브라우저 확인으로 있다.

인계: worker는 `runReplWorker()` → `bootReplWorker(frame, { loadPyodide })`(`worker/boot.ts`) → `createConsole(pyodide, sinks, { topLevelAwait })`(`worker/console.ts`)로 부팅하고 `ready` → `writeOutput(BANNER)` 뒤 임시 `DEMO_LINES`를 `runLine`으로 실행한다. RD-005는 `DEMO_LINES`와 그 실행 루프를 REPL 루프(`readLine` 요청 → `submission-runner.run`)로 바꾸고, `runLine(source): Promise<RunLineResult>`(`incomplete`/`syntax-error`/`complete{value, exited}`/`error{formattedError}`, `formattedError`는 끝 개행 포함) 위에 취소·여러 줄·값 에코(`repr_shorten`)·안전망을 얹는다. Python `await_fut`(`SystemExit` → `exited`, `builtins._` 갱신)는 이미 있다. main의 `createRepl`은 `createWorker`·`pyodide`·`onStatus`를 받고 `ReplStatus` 6값 중 `loading`·`ready`·`load-failed`·`not-isolated`를 발행한다(`terminated`는 RD-005, `crashed`는 RD-010). sink 4종은 `terminal/sinks.ts`(`tail`/`resetTail` 포함), 안내 줄은 `terminal/notice.ts`의 `writeNotice(readline, text, "warning" | "info")`(RD-010 리셋 안내가 `info`를 쓴다). 전역 Writer는 `worker/sink-writer.ts`. TLA 비트는 `worker/top-level-await.ts`가 프레임 값으로 적용한다(RD-012는 옵션·스위치·리셋 연동만). 비격리 페이지는 worker 없이 경고만 낸다(ADR-0004 정정). `readLine` 임시 핸들 API는 RD-005가 뺀다. 데모의 상태 표시는 `<output data-testid="status">` 텍스트다. 이 저장소의 node + 실제 pyodide 시험 패턴은 `09-testing.md` 9.1. 주의: `exit()`는 RD-009의 webloop 재보고 억제 전까지 브라우저 worker에 `unhandledrejection` 콘솔 오류를 남길 수 있다(node 시험은 `vitest.config.ts`의 `SystemExit` 한정 `onUnhandledError` 필터가 가리고 RD-009가 제거한다). 브라우저 확인(Playwright: 정상 dev·preview, CDN 차단, 비격리)의 스크립트는 저장소에 없고 RD-018이 보관한다. 함정: 화면 행 텍스트만 비교하면 출력 끝의 여분 빈 줄을 놓친다 — 커서 행을 단언한다(`docs/traps/TRP-006`).

### RD-005 — REPL 루프와 PyodideConsole 코어

상태: 완료 · 이전: RD-007, RD-011, RD-014(종료 감지) · 설계: `02-console-core.md`(5.1의 `runLine` 포함), `00-architecture.md` 3.2

worker의 REPL 루프(`readLine` 요청 → `submission-runner.run`)와 main의 `repl-reader`(꼬리 + `>>> ` 합성). 한 줄 제출만 다룬다(여러 줄은 RD-011).

시나리오: `>>> 1 + 1` Enter → `2` → `>>> `. 빈 줄 Enter는 무해하다. `if True:` Enter → `... ` → `    print(1)` Enter → 빈 줄 Enter → `1`. `1 +` Enter → SyntaxError 즉시 표시. `1/0` → 트레이스백에 `__repl_run`/`push`/`runcode` 프레임이 없다. `print("t", end="")` 실행 뒤 다음 프롬프트가 `t>>> `로 같은 줄에 붙는다. `exit()` → "Python session terminated." 안내, 이후 입력 무응답.

완료 기준:
- 위 시나리오 전부(브라우저). (RD-004에서 완료) 배너 뒤·값 에코 뒤 빈 줄 없음. `sys.ps1`/`ps2` 설정과 배너 `writeOutput`도 RD-004에서 끝났다.
- EOF에서 끊긴 문법 오류(`1 +`·`foo bar`)는 pyodide 314.0.7 콘솔이 `SyntaxError: invalid syntax`가 아니라 `_IncompleteInputError: incomplete input`으로 표시한다(`runLine`은 `syntax-error`로 분류하고 `formattedError`를 그대로 돌려준다). 위 `1 +` 시나리오의 화면 마지막 줄을 3.14.4 pty와 비교해 맞추거나 편차로 등록한다(근거·표: `.scratch/incomplete-input-error-display/issues/01-incomplete-input-error-display.md`). 결과: 재컴파일 정규화를 채택해 `1 +`·`foo bar`·블록 안 `1 +`가 3.14.4 pty와 캐럿까지 일치하고 본문 없는 중첩 블록은 `IndentationError` 문구가 같다(이슈 `done`, 편차 13은 즉시 표시(편차 11)만 남는다).
- `ConsoleFuture`는 Python 쪽 `await_fut` 헬퍼로만 await한다. `run(null)` 선분기(버퍼 clear → `KeyboardInterrupt` 빨강 → `>>> `). `run()` 안전망(`ConversionError` 판별)이 있다. node + 실제 pyodide 시험(이전 `submission-runner.test.ts` 상당).
- REPL 프롬프트 이어붙임: `t>>> `, 빈 Enter 뒤 열 0의 `>>> `, 블록 실행 뒤 `012>>> `, stderr 꼬리 뒤 `e>>> `(`e`만 빨강), 닫히지 않은 색 뒤 기본색, `\r30%`→`\r100%` 뒤 `100%>>> `, 100·130·200자·전각·정확히 80자 꼬리에서 앞 행 중복 없음(이전 RD-006b 브라우저 74개 시나리오를 옮겨 같은 결과).
- 값 에코 뒤·트레이스백 뒤·SyntaxError 뒤·배너 뒤에 빈 줄이 없다(이전 RD-011a 16개 시나리오).

인계: worker 루프는 `worker/repl-loop.ts`의 `runReplLoop(deps)`(`readLine(prompt, pending)` → `run(line)` → `exit`면 `onTerminated` 후 종료)이고 `protocol/`을 import하지 않는다(`boot.ts`가 rpc 래퍼를 주입한다). 한 줄 실행은 `worker/submission-runner.ts`의 `createSubmissionRunner(pyodide, repl, io).run(line | null)`이다(`PS1`/`PS2`, 값 에코, 오류 표시에서 끝 개행 하나 제거, `null` 선분기, `KeyboardInterrupt` 안전망). `ReplConsole`에 `pending()`/`clearPending()`이 생겼고 `RunLineResult.complete`는 `{ echo, exited }`다(`echo`는 Python이 만든 `repr()` 전체, `None`은 `null`). 예상 밖 오류는 `repl 내부 오류: …`(빨강) + `clearPending()` 후 `>>> `로 계속하고, `readLine` reject는 `rpc disposed`면 조용히·아니면 `console.error` 후 루프가 끝난다. main은 `terminal/repl-reader.ts`의 `createReplReader`(`rewindTail` → 꼬리 재조회 → `resetTail` → `readline.read(꼬리 + "\x1b[0m" + 프롬프트)`)와 `terminal/rewind-tail.ts`를 쓰고, `createRepl`은 RPC `readLine` 핸들러(겹치는 요청은 `Error("이미 읽는 중")`로 거절, `pending`·`cancelable`은 받지 않는다)와 `sessionTerminated` → `onStatus('terminated')`(터미널 무출력, worker는 살려 둔다)를 처리한다. `ReplHandle`은 `dispose`·`crossOriginIsolated`만 남았다. 리더는 dispose 뒤 write 콜백을 전달하지 않는 터미널 뷰(`createRepl`의 `liveTerminal`)를 받는다(`docs/traps/TRP-004`). 데모는 `terminated`일 때 `Python session terminated.`를 보인다. **중간 상태**: 개행이 든 붙여넣기·Shift+Enter 제출은 통째로 `push`되어 대개 SyntaxError다(RD-011이 분기를 추가한다). 값 에코가 `sys.displayhook`을 거치지 않는 것은 편차 33이다. 브라우저 확인 스크립트(`lib.mjs` 하니스, `repl-check.mjs`, `prompt-join-check.mjs`, `trailing-newline-check.mjs`, `carryover-check.mjs`, `keys-after-enter-probe.mjs`, 양성 대조 드라이버 `positive-controls.py`)는 `_works/_completed/20260922-05-rd-005-repl-loop/verify/`에 있고 RD-018이 보관한다. 결과: dev `repl-check normal` 15/15(preview 15/15), `prompt-join-check` 20/20, `trailing-newline-check` 13/13, `carryover-check` 4/4, 양성 대조 4/4. 편차 32 재측정(N=10)의 창은 약 20ms로 worker 왕복이 더해지기 전과 같다(`10-parity-deviations.md` 32). `exit()` 뒤 브라우저 `pageerror` 1건(webloop `run_handle`의 `SystemExit` 재보고)은 RD-009 대상이다. 건너뛴 이전 브라우저 시나리오 ID는 아래 각 RD의 인계에 있다. 함정: 하니스에서 Enter 뒤 `waitPrompt`가 화면 갱신 전의 낡은 프롬프트 행에 통과한다(`TRP-005`), 변조·원복을 반복하며 vite dev를 재시작하지 않으면 원복한 파일의 다음 변조가 반영되지 않는다(`TRP-007`), "로그가 없다"는 확인은 화면을 지우고 직후 정확한 행 목록으로 단언한다(`TRP-008`).

### RD-006 — `input()` 읽기: 메일박스·꼬리 프롬프트·read-guard

상태: 완료 · 이전: RD-006, RD-006a, RD-021(가드) · 설계: `04-stdin-input.md`, `01-protocols.md` 2절, ADR-0005

worker `stdin-callback.ts`(`setStdin`, 취소 변환은 RD-008에서 완성), main `stdin-reader.ts`(꼬리 그대로가 프롬프트, `rewindTail`), `read-guard.ts`.

시나리오: `name = input("x: ")` → `x: ` 뒤에서 대기, `abc` Enter → 화면은 `x: abc` 한 줄, `name == "abc"`. `input()`·`sys.stdin.readline()`은 프롬프트 없이 읽는다. flush한 `print("t", end="")` 뒤 `input()`은 `tabc`. 프롬프트 대기 중 `asyncio.get_event_loop().call_later(1, lambda: print(input()))`처럼 배경 콜백이 `input()`을 불러도 REPL이 멈추지 않고, 순서는 REPL 줄 → 배경 `input` 줄 → 콜백 출력 → REPL 줄 실행이다. 같은 대기 중 `call_later(2, print, 'TICK')`의 `TICK`이 2초 뒤 바로 보인다.

완료 기준:
- `x: abc` 한 줄, 프롬프트 없는 `input()`, `tabc`·`tp: abc`, 130자·200자·전각·정확히 폭 프롬프트에서 앞 행 중복 없음. 이전 RD-006b 브라우저 74개 중 stdin 해당 23개(E1·K1~K3·L1·M1·M2·N1~N3·O1·O2·P1~P9·R1·U1 원형)와 ROADMAP 시나리오(`x: abc`, `TICK`)를 옮겨 dev 확인 19개 전부 PASS, preview(빌드 산출물) ROADMAP 시나리오 8/8 PASS(`pageerror`·콘솔 경고 0). 세션 리셋 뒤 프롬프트가 이전 꼬리를 물려받지 않는 성질은 새 sink 세트가 빈 꼬리로 시작하는 단위 시험까지만 본다(브라우저 확인은 RD-010).
- `input()`/`sys.stdin.readline()/read()/readlines()`/`for line in sys.stdin` 전부 같은 경로로 값이 들어온다(node + 실제 pyodide, `worker/stdin-callback.test.ts`). `read()`·`readlines()`·반복은 EOF가 없어 끝나지 않는다(편차 34).
- read-guard 단위 시험(RED 확인, 변이 검사 9/9)과 브라우저 프로브(`bg-input-guard-probe.mjs`: 가드를 빼면 REPL 읽기가 고아가 되어 시간 초과, 넣으면 REPL 줄 → 배경 `input` 줄 → 콜백 출력 → REPL 줄 실행 순서이고 이어서 `1+1`이 `2`). 브라우저 양성 대조 3/3(`resetTail` 삭제, 알림을 `wait()` 뒤로 이동, 가드 대기 삭제)이 해당 확인만 실패했다가 원복 후 통과했다.
- 메일박스 대기 중 worker는 `complete`에 답하지 못하지만 요청은 포트에 큐잉되어 `deliver` 뒤 응답한다(`protocol/thread-scenario.test.ts`, 스레드 시험). main이 `input()` 읽기 중 Tab을 요청하지 않는다는 쪽은 Tab 리더가 들어오는 RD-015가 시험으로 고정한다.
- 루트 `pnpm check-types`·`lint`·`test`·`build` 통과(시험: `xterm-readline` 78 + `demo` 3 + `pyodide-repl` 24파일 378).

인계: worker는 `worker/stdin-callback.ts`의 `createStdinCallback({ requestInput, wait })`(`requestInput(true)` = `readInput` 알림 → `wait()` 순서를 이 모듈이 소유하고 `\n`을 붙이지 않는다)를 `boot.ts`가 `createConsole` 뒤·`ready` 알림 전에 `pyodide.setStdin({ stdin })`으로 건다(`try` 안이라 던지면 `loadFailed`). `requestInput`은 `rpc.notify("readInput", cancelable)`, `wait`는 `createMailboxReader(...).wait`가 주입된다. main은 `terminal/stdin-reader.ts`의 `createInputReader(readline, term, sinks)`(꼬리 그대로가 프롬프트, SGR 리셋 없음, `rewindTail` 재사용)와 `terminal/read-guard.ts`의 `createReadGuard({ readLine, readInput })`(활성 REPL 읽기 결과 뒤로 stdin 읽기를 미룸, 순서만 담당)를 `createRepl`이 조립한다. `readInput` 알림 핸들러는 가드를 거친 읽기 결과를 `mailbox.deliver`하고 읽기가 실패하면 `disposed`가 아닐 때만 `mailbox.fail(String(error))`로 worker를 깨운다(Python `OSError`). `readLine` 겹침 거절(`reading`)은 가드 바깥에서 검사한다(거절된 promise를 가드가 추적하면 활성 REPL 읽기를 잃는다). stdin 리더에도 REPL 리더와 같은 `liveTerminal` 뷰(TRP-004)를 준다. **중간 상태**: `wait()`의 `null`은 그대로 돌려줘 `EOFError`가 되지만 main에 `mailbox.cancel()`을 부를 경로가 없어 실제로는 오지 않고, `input()` 중 Ctrl+C는 벤더 readline이 `^C`를 찍고 같은 프롬프트를 다시 그릴 뿐 worker는 계속 정지한다(`cancelable` 인자도 무시). `index.test.ts`가 이 동작을 고정하므로 RD-008이 취소를 넣을 때 그 시험을 함께 바꾼다. 키 버퍼링은 없다(`.scratch/type-ahead`). 함정: `docs/traps/` TRP-010(`read(n)`이 남긴 `\n`)·TRP-011(브라우저 확인의 출력 대기가 입력 에코에 즉시 통과).

## Phase 1 — Ctrl+C 전체

### RD-007 — 실행 중 Ctrl+C: 기본 중단, 요청 번호·ack·재전송, 연타 보호, 시작 코드 보호

상태: 완료 · 이전: RD-012, RD-012d, RD-012e, RD-012h(b) · 설계: `03-ctrl-c.md` 2.1~2.4, 2.6, 2.7

`protocol/interrupt-sender.ts`(5ms 점검, 최대 10회 재전송), `worker/sigint-handler.ts`(요청 번호 확인·ack·`<console>` 프레임 규칙·`formattraceback` 절단; Python 소스는 TS 문자열), `worker/interrupt-buffer.ts`(`connectInterrupts`: 설치 → 폐기 → 연결), REPL 루프의 `discardPendingInterrupt`, main의 `^C` 에코와 `setCtrlCHandler`(게이트 `pythonRunning`).

시나리오: `while True: pass` 중 Ctrl+C → `^C` + `KeyboardInterrupt` 트레이스백 → `>>> `. Ctrl+C를 누르고 있어도(키 반복 30회) 프롬프트가 돌아온다. 새 worker 로드 중 Ctrl+C를 눌러도 시작 코드가 죽지 않는다. `KeyboardInterrupt`를 잡고 계속 도는 프로그램은 눌림 한 번에 한 번만 중단된다.

완료 기준(전부 충족, 실측):
- 단일 눌림 소실 0: node 눌림 주입 N=3000 **소실 0**(자연 발생 소실 76건을 재전송이 전부 복구했다 — 재전송 1회 74건·2회 2건), 브라우저 N=200 **HANG 0**. catch-loop 3000회 **누락 0·이중 0**. 재전송 복구 지연 p50 5.2ms·**max 10.3ms**(기준 20ms 안팎).
- 연타 매트릭스: 0ms 30회, 1·5·20·50ms 30회, 키 반복, 2·5회, 웜 0ms 각 N=20 → **9셀 180시행 전부 프롬프트 복귀**, 대상 `pageerror` 0. TLA 켜짐 0ms 30회는 node 시험(`sigint-handler.test.ts`)이 본다(브라우저 TLA 셀은 RD-012).
- 부팅 중 Ctrl+C `boot-press` dev N=30·preview N=10 **전부 정상**(시행당 60~64회가 실제 부팅 중에 들어갔다).
- 폴링 비용: `loop_i` **1.001**, `str(i)` **0.9943**(plain 대비, 잡음 대조 0.9945·0.9965).
- 변이 검사: SEQ/SIGNAL 순서 뒤집기, 송신기가 ACK를 먼저 읽기, 핸들러 ack 위치 이동, 연결이 무조건 ack하기가 각각 시험을 실패시킨다(DELTA-01~04에서 총 79종 검사, 동치 1종 외 전부 killed).
- 양성 대조 3/3: `^C`를 `readline.print`로 → S1만 실패, 재전송 제거 → 브라우저 HANG 12/200, 핸들러 프레임 규칙 제거 → 연타 HANG.

인계(RD-008): F×5(다섯 건 모두 `input()` 읽기 중 연타가 전제라 RD-007에서 재분류했다)와 G3·W2는 취소가 들어온 뒤에 본다. main 게이트 `pythonRunning`은 `readInput` 알림 도착부터 `deliver`/`fail`이 끝날 때까지 닫혀 있어 그 구간의 Ctrl+C는 에코도 전송도 하지 않는다 — 취소로 바꿀 때 `inputReadsPending`을 내리는 자리(`deliver` **뒤**)를 유지해야 worker가 깨어나는 시점과 어긋나지 않는다. `stdin-callback`이 `signalInterrupt`를 쓰면 그 번호를 핸들러의 `last_seq`가 어떻게 보는지 확인한다(TRP-035).

인계(RD-009): 핸들러는 현재 `<console>` 프레임이 없는 SIGINT를 **사용자 실행 중이라도 버린다**(ack는 한다). 그래서 `while True: time.sleep(0.1)`·`asyncio.run` 대기 중 Ctrl+C는 아직 무효다(TRP-020). `install(console, ack, seq)`에 `warn`과 `interrupt_idle` 반환을 더하고, `own_codes` 확장·`webloop.py` 프레임 제거·감시 타이머(`connectInterrupts` 뒤·루프 앞, `atPrompt`)를 넣는다. 정상 중단마다 webloop 재보고 `pageerror`가 **시행당 2건** 난다(RD-007 실측, 200시행 → 400건). `packages/pyodide-repl/vitest.config.ts`의 `onUnhandledError` 필터는 현재 `SystemExit|KeyboardInterrupt` 둘을 거른다 — 억제를 넣은 뒤 필터를 지우고 `sigint-handler.test.ts`가 필터 없이 통과하는지 본다.

인계(RD-010): 새 worker를 만들기 직전 `sender.cancel()` → `Atomics.store(buffer, SIGNAL, 0)` 순서로 치운다. `index.ts`의 `interruptBuffer`는 세션마다 새로 만들지 않고 상수로 잡혀 있으므로 리셋이 재사용한다(핸들러의 `last_seq` 초기값이 이전 세션 번호를 이어받아 재전송을 무시한다). `endSession()`이 닫은 게이트(`alive`)를 리셋에서 다시 참으로 만든다.

인계(RD-012): 브라우저 연타 매트릭스에 TLA 켜짐 셀을 더한다(RD-007은 node 시험에서만 봤다). `createRepl({ topLevelAwait })`와 데모 토글이 들어온 뒤다.

인계(RD-015): Tab 취소도 `sender.send()`를 쓴다.

인계(RD-018): 확인 스크립트는 `_works/_completed/20260922-07-rd-007-ctrl-c-running/verify/`에 있다 — `ctrl-c-check.mjs`(RM1~RM3·G1·G2·S1a·S1·S08), `press-loss.mjs`, `burst-matrix.mjs`, `boot-press.mjs`, `positive-controls.py`, node 통계는 `verify/node/`. 74개 복원 표는 그 폴더의 `skipped-ids.md`.

### RD-008 — 입력줄 Ctrl+C(미완성 블록 취소)와 `input()` 중 Ctrl+C

상태: 대기 · 이전: RD-012b, RD-012c · 설계: `04-stdin-input.md` 3.1, `06-editing.md` 6.3(취소·`cancelSettling`), `02-console-core.md` 5.2(`run(null)`)

시나리오: `if True:` Enter → `... `에서 Ctrl+C → 빨간 `KeyboardInterrupt` 한 줄(`^C` 없음, 빈 줄 없음) → `>>> ` → `print(1)`이 `1`. `x = input()` 대기에서 `abc`를 치다 Ctrl+C → 입력 줄 아래 표준 트레이스백(`File "<console>", line 1, in <module>` / `KeyboardInterrupt`) → `>>> `, `x` 미대입. 함수 안 `input()` 취소는 그 프레임을 표시한다.

완료 기준:
- 프롬프트 취소: 본문이 쌓인 블록·Shift+Enter 버퍼·세션 리셋 뒤에도 같다. 다음 입력에 취소된 글자가 섞이지 않는다. 취소한 입력은 history에 없다(이전 RD-012b 브라우저 24개 중 22 통과, E1·E2 기준선 실패 유지).
- `input()` 취소: `null` → `signalInterrupt` → `checkInterrupt()` → `KeyboardInterrupt`가 `input()` 호출 지점에서 난다. `try/except KeyboardInterrupt`가 잡고 `except Exception`은 못 잡으며 `finally`가 실행된다. `sys.stdin.readline()`도 같다. Ctrl+C 연타(0ms 2회·5회, 키 반복 20회)에도 REPL 생존(이전 RD-012c 24개 중 20 통과, A1·C2·H1·J1 기준선 실패 유지). 요청 번호를 올리지 않으면 무시되는 경우를 시험이 잡는다(TRAP-05, TRAP-35 상당).
- `cancelSettling` 방어: 취소 뒤 다음 읽기 활성화 전 Ctrl+C가 중단 경로로 가지 않는다(단위 시험).

인계(RD-005): main `readLine` 핸들러는 `(prompt)`만 받고 `pending`·`cancelable`을 쓰지 않으며 `null`을 응답하지 않는다. 이 RD가 시그니처를 `(prompt, pending, cancelable)`로 넓히고 취소를 `null`로 응답한다. worker의 `run(null)`(버퍼 clear → `KeyboardInterrupt` 빨강 → `>>> `)과 안전망은 RD-005에서 node 시험으로 끝났다. 건너뛴 이전 시나리오: RD-006b의 G3·W2(`t>>> abc`에서 Ctrl+C), RD-011a의 S14(`if True:` 뒤 Ctrl+C).

인계(RD-006): `createStdinCallback`은 `{ requestInput, wait }`를 받아 `wait()`의 `null`을 그대로 돌려준다(EOF, 중간 상태). 이 RD가 `pyodide`·`interruptBuffer`를 받아 `signalInterrupt`(요청 번호를 올린다) → `checkInterrupt()` 변환으로 바꾼다(`04-stdin-input.md` 3.1). main에는 `mailbox.cancel()`을 부르는 경로가 없다: 벤더 readline의 Ctrl+C는 `^C` 뒤 같은 프롬프트를 다시 그리고 `readInput` 핸들러는 `cancelable`을 받지 않는다. `createInputReader.read()`는 `Promise<string>`이고 `createReadGuard`의 `L`·`I` 제네릭은 `string`이라, 취소를 넣을 때 반환형을 `string | null`로 넓히면 가드 코드는 그대로다. `index.test.ts`의 "stdin 읽기 중 Ctrl+C는 `^C`를 찍고 같은 프롬프트를 다시 그리며 메일박스는 IDLE" 시험이 중간 상태를 고정하므로 취소 동작으로 바꿀 때 함께 바꾼다. 건너뛴 이전 시나리오(취소 계열): RD-006b의 A1~A5·B1·B2·C1·C2·D1·E2·H1·H2·Q1(J1·J2는 RD-010과 함께).

### RD-009 — 정지한 실행 중 Ctrl+C: 감시 타이머, `time.sleep` 조각, webloop 재보고 억제, 프롬프트 유휴 SIGINT 폐기

상태: 대기 · 이전: RD-012a, RD-012f, RD-021(유휴 폐기) · 설계: `03-ctrl-c.md` 2.4(깨우기·sleep 조각), 2.5, 2.8

시나리오: `while True: time.sleep(0.1)` 중 Ctrl+C 한 번 → 200ms 안에 트레이스백과 `>>> `. `time.sleep(5)` 단발도 끊긴다(JSPI 유무 무관). `asyncio.run(main())`·`run_until_complete`·`run_sync`·top-level await 대기 중 Ctrl+C가 사용자 지점에서 중단된다. sleep 중에는 `call_later` 콜백이 돌지 않는다. 프롬프트 대기 중 눌린 낡은 SIGINT가 배경 콜백을 끊지 않고 조용히 버려진다. 정상 중단·`input()` 취소·`exit()`에서 브라우저 `pageerror`가 0이다.

완료 기준:
- 12조합(`time.sleep` 루프 0.1·0.01·1초, 단발 5초, `asyncio.run`, `run_until_complete`, `run_sync`, top-level await 단발·루프, TLA 켜짐 sleep 루프 등) × N=20 → 전부 복귀, 복귀 중앙값 30ms 이내, `pageerror` 0.
- node(JSPI 있음·없음 각 N=30): `sleep(5)` 단발과 `0.1`·`0.02`·`0.015`·`0.01` 루프 30/30, stderr가 표준 트레이스백과 정확히 일치. 20ms 이하 sleep 뒤 폴링 1회가 있다(없으면 지연 13배, 시험으로 고정).
- 무효 인자(`-1`·`'a'`·NaN·inf)는 CPython과 같은 예외, `0`·`True`는 오류 없음.
- 프롬프트 유휴 폐기 단위 시험(RED + 변이 검사), 실행 중 규칙(깨울 수 없으면 남긴다) 유지 시험.
- 설치 가드 5종이 pyodide 내부 변화를 `console.warn`으로 알린다(시험).
- `packages/pyodide-repl/vitest.config.ts`의 `onUnhandledError` 필터(`PythonError` + 줄 시작 `SystemExit`, RD-004가 `exit()` 시험을 위해 넣은 임시 조치)를 제거하고 `exit()` 시험이 필터 없이 통과한다(webloop 재보고 억제가 들어와 불필요).

인계(RD-005): `exit()` 뒤 브라우저 worker에서 webloop `run_handle`이 `SystemExit`을 다시 던져 `pageerror`가 1건 남는다(dev·preview 동일, 콘솔 경고·오류는 0). 이 RD의 재보고 억제가 들어오면 브라우저에서도 0이어야 한다(`repl-check.mjs normal` ⑦이 건수를 기록한다).

## Phase 2 — 세션·제출·편집·완성

### RD-010 — 세션 리셋, 종료 정책, 크래시 재시작 UI

상태: 대기 · 이전: RD-014, RD-009(재시작), RD-008(Chip) · 설계: `08-session.md`, `00-architecture.md` 3.4·4.3

시나리오: `세션 리셋` 버튼 → 변수·import가 사라지고 화면 스크롤은 유지, 안내 줄(청록) 뒤 새 배너. `exit()` 뒤 Alert가 뜨고 리셋으로 복구. worker가 죽으면(강제 `throw`) 재시작 버튼이 뜬다. Ctrl+L은 화면만 지우고 Python 상태는 그대로다. 리셋 직전 눌린 Ctrl+C가 새 세션의 시작 코드를 죽이지 않는다.

완료 기준: 위 시나리오(브라우저). 리셋 순서(들여쓰기 단위 초기화 → 송신기 취소 → `SIGNAL=0` → terminate → 새 worker·새 메일박스·새 sink 세트)가 시험으로 고정된다. StrictMode 이중 마운트에서 경고·중복 worker가 없다. `dispose()`가 두 번 불려도 안전하다.

인계(RD-005): `exit()`(`terminated`) 뒤 worker는 살아 있고 터미널·입력은 무응답이다. 복구는 이 RD의 리셋과 Alert다(데모의 `Python session terminated.` 한 줄을 Alert로 교체). `createRepl`의 `liveTerminal` 뷰가 쓰는 `disposed`는 핸들 단위이므로 리셋이 핸들을 유지한 채 세션만 바꾸면 세션 단위 해제 신호가 필요하다(이전 세션의 `rewindTail` flush 콜백이 새 세션 읽기에 끼어들 수 있다). 건너뛴 이전 시나리오: RD-006b의 AC1·J2(세션 리셋 뒤 꼬리·`input()` 취소).

인계(RD-006): 세션 리셋 뒤 프롬프트가 이전 꼬리를 물려받지 않는 성질은 `stdin-reader.test.ts`의 "새 sink 세트는 빈 프롬프트로 시작한다"(단위)까지만 본다. 브라우저 확인은 RD-006b의 J1·J2·J3(J1·J2는 취소도 필요해 RD-008 뒤)·AC1이다. 리셋은 세션마다 `createStdinMailbox`·sink 세트·`createInputReader`·`createReadGuard`를 새로 만들어야 옛 세션의 stdin 읽기·가드 추적이 새 세션에 끼어들지 않는다. `readInput` 핸들러의 `disposed`는 핸들 단위라 리셋이 핸들을 유지하면 옛 worker가 죽었다는 세션 단위 신호가 필요하다(죽은 worker에 대한 `mailbox.fail()`의 `untilIdle`은 영영 안 풀린다).

### RD-011 — 여러 줄 입력 제출(붙여넣기·Shift+Enter·히스토리 재호출)

상태: 대기 · 이전: RD-017 · 설계: `02-console-core.md` 5.2·5.3

시나리오: `def add(a, b):\n    return a + b\n\nprint(add(1, 2))`를 붙여넣고 Enter 한 번 → `3`, SyntaxError 없음. 클래스 메서드 사이 빈 줄이 블록을 끊지 않는다. 붙여넣은 탭이 보존된다. `1\n2\n3` → `3`만 에코. 파싱 오류가 있으면 아무 문장도 실행하지 않는다.

완료 기준: 위 시나리오 + `split_paste` 코퍼스 27개 전부 일치(node + 실제 pyodide). 블록 입력 중(`... `) 붙여넣기는 한 줄씩 흘려 넣는다. 예외·`exit()` 뒤 나머지 문장 미실행. 한 줄 입력·빈 줄·`input()` 기존 동작 유지.

인계(RD-005): RD-005의 러너(`submission-runner.run`)에는 개행 분기가 없다. 이 RD가 `/[\r\n]/` 분기·`replayLines`·`multiline.py`·`.py` raw import 관례를 추가한다. 그 전까지 개행이 든 붙여넣기·Shift+Enter 제출은 통째로 `push`되어 대개 SyntaxError다. 건너뛴 이전 시나리오: RD-011a의 S03·S07(붙여넣기 분할).

### RD-012 — top-level await 옵션(기본 꺼짐)

상태: 대기 · 이전: RD-018 · 설계: `02-console-core.md` 5.4

시나리오: 기본 상태에서 `await asyncio.sleep(1)`은 `SyntaxError: 'await' outside function`. 스위치를 켜면 세션이 리셋되고 바로 실행된다. 새로고침하면 꺼짐.

완료 기준: 위 시나리오. `setTopLevelAwait`가 TLA 비트만 토글하고(`0x6200` 확인) 콘솔 생성 직후 한 번만 적용된다(node + 실제 pyodide) — (RD-004에서 완료: `worker/top-level-await.ts`가 초기화 프레임의 `topLevelAwait`를 적용한다. 프레임 값은 아직 항상 `false`). 이 RD에 남는 범위는 `createRepl`의 `topLevelAwait` 옵션, 데모 스위치, 리셋 시 새 프레임에 값을 싣는 연동이다. 꺼짐/켜짐 모두 `asyncio.run(main())` 동작. 한 줄/블록/`input()`/Ctrl+C 기존 동작 유지.

### RD-013 — 자동 들여쓰기

상태: 대기 · 이전: RD-019 · 설계: `06-editing.md` 6.3

시나리오: `for i in range(2):` Enter → `... ` 다음 줄에 4칸. `    print(i)` Enter 뒤에도 4칸 유지. 공백뿐인 줄 Enter로 블록 종료. Backspace가 단위 배수까지 지운다. 2칸으로 쓴 블록 뒤 새 블록은 2칸, 세션 리셋 뒤 4칸.

완료 기준: 위 규칙 전부 + Shift+Enter/Alt+Enter 프리필, 일반 Enter·붙여넣기·`input()`에는 프리필 없음, 채워진 공백뿐인 줄은 history에 없음, 본문 없이 Enter 반복 시 블록이 끝나지 않음. `auto-indent.ts`가 pyodide에 든 `_pyrepl.readline` 함수와 차분 검증된다(`auto-indent-parity`). 프리필은 벤더링 readline의 공개 훅(`06-editing.md` 6.1)으로 넣는다.

### RD-014 — 블록 입력을 history 항목 하나로

상태: 대기 · 이전: RD-020 · 설계: `06-editing.md` 6.4

시나리오: `for i in range(2):` / `    print(i)` / 빈 줄로 끝낸 뒤 ↑ → 블록 전체가 돌아오고 Enter 한 번으로 재실행. Ctrl+C로 취소한 블록은 history에 남지 않는다.

완료 기준: 위 시나리오 + 괄호 안 빈 줄 보존, 문법 오류·예외·`exit()`로 끝난 블록도 전체가 남음, 공백만 있는 제출 제외, `... ` 입력줄의 ↑ 무동작. 벤더링 `History`에 삭제/복원 API를 추가할지 착수 시 결정하고 결정을 DELTA에 남긴다.

인계(RD-005): 건너뛴 이전 시나리오는 RD-006b의 X2·X3(블록 history 재호출 뒤 `012>>> ` 프롬프트 유지)다. worker는 `readLine`에 `pending`을 보내지만 main 핸들러가 아직 쓰지 않는다.

인계(RD-006): `createReadGuard`의 `readLine`은 `(prompt)`만 받는다. `pending`을 리더에 넣는 RD-013·014는 `ReadGuardDeps.readLine` 시그니처와 `createRepl`의 `readLine` 핸들러·조립을 함께 넓힌다(REPL 읽기는 가드가 즉시 부르므로 시작 타이밍은 그대로다).

### RD-015 — Tab 완성(이름·속성), 완성 중 Ctrl+C, Tab 큐

상태: 대기 · 이전: RD-016, RD-016c, RD-016f · 설계: `07-tab-completion.md` 7.1~7.4

시나리오: `a.` 뒤 Tab → 후보 하나면 삽입, 여럿이면 공통 접두사. 같은 자리 두 번째 Tab → 열 우선 목록(셀 폭 = 최장 + 2, 200개 상한). 빈 스템은 `4 - (열 % 4)`칸 공백을 왕복 없이. `important = ` 뒤 Tab 8연타(0ms) → 32칸. `__getattr__`가 무한 루프인 객체에서 `a.x` Tab 뒤 Ctrl+C → 세션 리셋 없이 `>>> `.

완료 기준: 이전 RD-016 브라우저 58개 시나리오와 같은 결과(3.14 pty 목록 화면 행 일치 포함), 경합 Tab→Enter·Tab→Ctrl+C 각 20회 정지 0, `input()` 중 Tab 무동작, 세션 리셋·`exit()` 뒤 동작, 왕복 지연 중앙값 30ms 이내. 코드포인트↔UTF-16 변환 시험(서로게이트 쌍). 완성 중 취소 단위 시험(RED + 변이 검사).

인계(RD-006): "main이 `input()` 읽기 중 Tab을 요청하지 않는다"는 성질(메일박스 대기 중 worker는 `complete`에 답하지 못한다)은 Tab 리더가 들어올 때 시험으로 고정한다. 프로토콜 쪽(메일박스 대기 중 보낸 `complete`는 `deliver` 전 응답 없음, 뒤 응답, 유실 없음)은 RD-006이 `protocol/thread-scenario.test.ts`에 넣었다. `input()` 안 Tab 무동작은 편차 17이다.

### RD-016 — `import`/`from` 줄의 모듈 완성

상태: 대기 · 이전: RD-016a · 설계: `07-tab-completion.md` 7.5

시나리오: `import os.pa` Tab → `import os.path`. `import xml.dom.m` Tab → `xml.dom.mini`. `import ` Tab 두 번 → 모듈 목록. `from os import pa` → `path`. `import os; os.pa`는 속성 완성.

완료 기준: 이전 RD-016a 브라우저 129개 시나리오와 같은 결과, 3.14 pty 케이스 A01~A36 중 32개 + X01 대조, 게이트 코퍼스 53줄 일치, 호출마다 `ZipStdlibModuleCompleter` 새 인스턴스(`loadPackage` 뒤 후보 반영 시험), zip stdlib 보정으로 `collections.abc` 등 복원.

### RD-017 — 선택 영역 복사(Ctrl+Shift+C)

상태: 대기 · 이전: RD-013 · 설계: `06-editing.md` 6.6

시나리오: 출력 텍스트를 마우스로 선택하고 Ctrl+Shift+C → 클립보드에 그대로. 기존 Ctrl+C(중단·취소)는 그대로.

완료 기준: 위 시나리오(브라우저). 캡처 단계 `keydown` 리스너가 readline보다 먼저 받고 cleanup에서 해제된다(단위 시험).

## Phase 3 — 검증 자산

### RD-018 — 브라우저 회귀 하니스와 3.14 기준 데이터를 저장소 안에 보관

상태: 대기 · 이전: 없음(이전에는 `_works/` 스크립트) · 설계: `09-testing.md` 9.5·9.6

이전 구현의 Playwright 스크립트(`browser-check*.mjs`, 프로브 4종, `run-harness.sh`)와 pty 기준 데이터(기대 행 파일)를 `apps/demo/e2e/`로 옮겨 수동 실행 가능하게 한다. CI 상시 실행은 범위 밖이다.

완료 기준: `pnpm --filter demo e2e:<이름>`으로 기준선 5종이 재현된다(RD-016 58/58, RD-016a 129/129, RD-012b 22/24, RD-012c 20/24, RD-006b 74/74)과 `boot-press` N=30. 기준 인터프리터(3.14.4)와 pyodide 번들(3.14.2) 차이를 README에 적는다.

인계(RD-005): RD-005 검증 스크립트(`lib.mjs` 하니스, `repl-check.mjs`(normal·cdn-blocked·not-isolated), `prompt-join-check.mjs`(RD-006b 이식 20개), `trailing-newline-check.mjs`(RD-011a 이식 12개), `carryover-check.mjs`, `keys-after-enter-probe.mjs`, `positive-controls.py`)는 `_works/_completed/20260922-05-rd-005-repl-loop/verify/`에 있다. 이 RD가 `apps/demo/e2e/`로 옮길 때 각 RD가 넘긴 "건너뛴 시나리오"를 되살려 기준선 5종을 채운다. `ONLY=<이름 접두어,…>` 환경변수로 확인을 분리해 돌릴 수 있다. 400토큰(25행, 스크롤백) 꼬리 관찰은 새 데모에 `window.__term`이 없어 옮기지 않았다. 함정: `docs/traps/TRP-005`·`TRP-007`·`TRP-008`.

인계(RD-006): RD-006 검증 스크립트(`lib.mjs`(RD-005 하니스 + `typeWhenReading`·`settled`), `stdin-input-check.mjs`(RD-006b stdin 23개 ID + `x: abc`·`TICK`), `bg-input-guard-probe.mjs`, `positive-controls.py`, 이전 74개 ID의 실행·건너뜀 표 `skipped-ids.md`)는 `_works/_completed/20260922-06-rd-006-stdin-input/verify/`에 있다. 이 RD는 `skipped-ids.md`의 표(RD-006 실행·RD-005 실행·건너뜀과 대상 RD)로 74개 복원 목록을 만든다. 입력은 읽기가 시작된 뒤에 보내야 하는데 stdin 프롬프트 글자는 읽기 시작보다 먼저 나오므로 첫 글자가 에코될 때까지 재시도한다(`TRP-005`). 출력 도착을 마커 포함으로 기다릴 때 입력한 코드 행을 뺀다(`TRP-011`).

---

## 보류

이전 구현에서 보류·미착수였던 항목. 시나리오와 완료 기준이 갖춰지면 위 규칙으로 등록한다.

| 항목 | 이전 | 사유 |
| --- | --- | --- |
| `input()` 안 Tab 완성 | RD-016b | `input()`은 메일박스 대기라 worker가 멈춰 있어 worker 완성이 불가. main 쪽 완성이나 별도 배선이 필요 |
| `asyncio.run` 코루틴 안 `KeyboardInterrupt`의 중복 트레이스백 | RD-012i | 후보 안(`guard`가 값으로 반환)만 있고 완료 기준 미확정 |
| `time.sleep` 대기 중 워커 CPU 점유 | RD-012j | 정확성 영향 없음. 재측정 비용이 이득보다 큼 |
| 후보 선택 UI(popover) | RD-016d | 3.14 동등 밖 UI 기능 |
| "Python 정지" 플래그(송신기 잔류 제거) | RD-012h(a) | 정확성 영향 없음 |
| Ctrl+D(빈 줄 EOF) | 없음 | 이전 구현 미구현. 시나리오 정하면 등록 |

## 범위 밖

`docs/design/10-parity-deviations.md` 2절(3.14 편차 중 범위 밖 확정 5건)과 다음 v1 제외 항목: 히스토리 영구 저장, Ctrl+R 역검색, syntax highlighting, session export/import, 패키지 설치 UI, 파일시스템·터미널 명령·디버거, Service Worker COOP/COEP 우회, CI 상시 E2E, 서버 CPython 프로세스 아키텍처, `@cp949/runo-xterm-readline`의 npm 배포(재사용 가치가 확인되면 별도 결정).
