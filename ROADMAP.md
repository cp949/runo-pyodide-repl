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

인계: worker는 `runReplWorker()` → `bootReplWorker(frame, { loadPyodide })`(`worker/boot.ts`) → `createConsole(pyodide, sinks, { topLevelAwait })`(`worker/console.ts`)로 부팅하고 `ready` → `writeOutput(BANNER)` 뒤 임시 `DEMO_LINES`를 `runLine`으로 실행한다. RD-005는 `DEMO_LINES`와 그 실행 루프를 REPL 루프(`readLine` 요청 → `submission-runner.run`)로 바꾸고, `runLine(source): Promise<RunLineResult>`(`incomplete`/`syntax-error`/`complete{value, exited}`/`error{formattedError}`, `formattedError`는 끝 개행 포함) 위에 취소·여러 줄·값 에코(`repr_shorten`)·안전망을 얹는다. Python `await_fut`(`SystemExit` → `exited`, `builtins._` 갱신)는 이미 있다. main의 `createRepl`은 `createWorker`·`pyodide`·`onStatus`를 받고 `ReplStatus` 6값 중 `loading`·`ready`·`load-failed`·`not-isolated`를 발행한다(`terminated`는 RD-005, `crashed`는 RD-010). sink 4종은 `terminal/sinks.ts`(`tail`/`resetTail` 포함), 안내 줄은 `terminal/notice.ts`의 `writeNotice(readline, text, "warning" | "info")`(RD-010 리셋 안내가 `info`를 쓴다). 전역 Writer는 `worker/sink-writer.ts`. TLA 비트는 `worker/top-level-await.ts`가 프레임 값으로 적용한다(RD-012는 옵션·스위치·리셋 연동만). 비격리 페이지는 worker 없이 경고만 낸다(ADR-0004 정정). `readLine` 임시 핸들 API는 RD-005가 뺀다. 데모의 상태 표시는 `<output data-testid="status">` 텍스트다. 이 저장소의 node + 실제 pyodide 시험 패턴은 `09-testing.md` 9.1. 주의: `exit()`는 RD-009의 webloop 재보고 억제 전까지 브라우저 worker에 `unhandledrejection` 콘솔 오류를 남겼다(node 시험은 `vitest.config.ts`의 `SystemExit` 한정 `onUnhandledError` 필터가 가렸다). RD-009가 억제를 넣고 필터를 제거해 양쪽 다 0이다. 브라우저 확인(Playwright: 정상 dev·preview, CDN 차단, 비격리)의 스크립트는 저장소에 없고 RD-018이 보관한다. 함정: 화면 행 텍스트만 비교하면 출력 끝의 여분 빈 줄을 놓친다 — 커서 행을 단언한다(`docs/traps/TRP-006`).

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

인계: worker 루프는 `worker/repl-loop.ts`의 `runReplLoop(deps)`(`readLine(prompt, pending)` → `run(line)` → `exit`면 `onTerminated` 후 종료)이고 `protocol/`을 import하지 않는다(`boot.ts`가 rpc 래퍼를 주입한다). 한 줄 실행은 `worker/submission-runner.ts`의 `createSubmissionRunner(pyodide, repl, io).run(line | null)`이다(`PS1`/`PS2`, 값 에코, 오류 표시에서 끝 개행 하나 제거, `null` 선분기, `KeyboardInterrupt` 안전망). `ReplConsole`에 `pending()`/`clearPending()`이 생겼고 `RunLineResult.complete`는 `{ echo, exited }`다(`echo`는 Python이 만든 `repr()` 전체, `None`은 `null`). 예상 밖 오류는 `repl 내부 오류: …`(빨강) + `clearPending()` 후 `>>> `로 계속하고, `readLine` reject는 `rpc disposed`면 조용히·아니면 `console.error` 후 루프가 끝난다. main은 `terminal/repl-reader.ts`의 `createReplReader`(`rewindTail` → 꼬리 재조회 → `resetTail` → `readline.read(꼬리 + "\x1b[0m" + 프롬프트)`)와 `terminal/rewind-tail.ts`를 쓰고, `createRepl`은 RPC `readLine` 핸들러(겹치는 요청은 `Error("이미 읽는 중")`로 거절, `pending`·`cancelable`은 받지 않는다)와 `sessionTerminated` → `onStatus('terminated')`(터미널 무출력, worker는 살려 둔다)를 처리한다. `ReplHandle`은 `dispose`·`crossOriginIsolated`만 남았다. 리더는 dispose 뒤 write 콜백을 전달하지 않는 터미널 뷰(`createRepl`의 `liveTerminal`)를 받는다(`docs/traps/TRP-004`). 데모는 `terminated`일 때 `Python session terminated.`를 보인다. **중간 상태**: 개행이 든 붙여넣기·Shift+Enter 제출은 통째로 `push`되어 대개 SyntaxError다(RD-011이 분기를 추가한다). 값 에코가 `sys.displayhook`을 거치지 않는 것은 편차 33이다. 브라우저 확인 스크립트(`lib.mjs` 하니스, `repl-check.mjs`, `prompt-join-check.mjs`, `trailing-newline-check.mjs`, `carryover-check.mjs`, `keys-after-enter-probe.mjs`, 양성 대조 드라이버 `positive-controls.py`)는 `_works/_completed/20260922-05-rd-005-repl-loop/verify/`에 있고 RD-018이 보관한다. 결과: dev `repl-check normal` 15/15(preview 15/15), `prompt-join-check` 20/20, `trailing-newline-check` 13/13, `carryover-check` 4/4, 양성 대조 4/4. 편차 32 재측정(N=10)의 창은 약 20ms로 worker 왕복이 더해지기 전과 같다(`10-parity-deviations.md` 32). `exit()` 뒤 브라우저 `pageerror` 1건(webloop `run_handle`의 `SystemExit` 재보고)은 **RD-009에서 해소**됐다(억제 뒤 `repl-check.mjs normal` ⑦ 0건). 건너뛴 이전 브라우저 시나리오 ID는 아래 각 RD의 인계에 있다. 함정: 하니스에서 Enter 뒤 `waitPrompt`가 화면 갱신 전의 낡은 프롬프트 행에 통과한다(`TRP-005`), 변조·원복을 반복하며 vite dev를 재시작하지 않으면 원복한 파일의 다음 변조가 반영되지 않는다(`TRP-007`), "로그가 없다"는 확인은 화면을 지우고 직후 정확한 행 목록으로 단언한다(`TRP-008`).

### RD-006 — `input()` 읽기: 메일박스·꼬리 프롬프트·read-guard

상태: 완료 · 이전: RD-006, RD-006a, RD-021(가드) · 설계: `04-stdin-input.md`, `01-protocols.md` 2절, ADR-0005

worker `stdin-callback.ts`(`setStdin`, 취소 변환은 RD-008이 넣었다), main `stdin-reader.ts`(꼬리 그대로가 프롬프트, `rewindTail`), `read-guard.ts`.

시나리오: `name = input("x: ")` → `x: ` 뒤에서 대기, `abc` Enter → 화면은 `x: abc` 한 줄, `name == "abc"`. `input()`·`sys.stdin.readline()`은 프롬프트 없이 읽는다. flush한 `print("t", end="")` 뒤 `input()`은 `tabc`. 프롬프트 대기 중 `asyncio.get_event_loop().call_later(1, lambda: print(input()))`처럼 배경 콜백이 `input()`을 불러도 REPL이 멈추지 않고, 순서는 REPL 줄 → 배경 `input` 줄 → 콜백 출력 → REPL 줄 실행이다. 같은 대기 중 `call_later(2, print, 'TICK')`의 `TICK`이 2초 뒤 바로 보인다.

완료 기준:
- `x: abc` 한 줄, 프롬프트 없는 `input()`, `tabc`·`tp: abc`, 130자·200자·전각·정확히 폭 프롬프트에서 앞 행 중복 없음. 이전 RD-006b 브라우저 74개 중 stdin 해당 23개(E1·K1~K3·L1·M1·M2·N1~N3·O1·O2·P1~P9·R1·U1 원형)와 ROADMAP 시나리오(`x: abc`, `TICK`)를 옮겨 dev 확인 19개 전부 PASS, preview(빌드 산출물) ROADMAP 시나리오 8/8 PASS(`pageerror`·콘솔 경고 0). 세션 리셋 뒤 프롬프트가 이전 꼬리를 물려받지 않는 성질은 새 sink 세트가 빈 꼬리로 시작하는 단위 시험까지만 본다(브라우저 확인은 RD-010).
- `input()`/`sys.stdin.readline()/read()/readlines()`/`for line in sys.stdin` 전부 같은 경로로 값이 들어온다(node + 실제 pyodide, `worker/stdin-callback.test.ts`). `read()`·`readlines()`·반복은 EOF가 없어 끝나지 않는다(편차 34).
- read-guard 단위 시험(RED 확인, 변이 검사 9/9)과 브라우저 프로브(`bg-input-guard-probe.mjs`: 가드를 빼면 REPL 읽기가 고아가 되어 시간 초과, 넣으면 REPL 줄 → 배경 `input` 줄 → 콜백 출력 → REPL 줄 실행 순서이고 이어서 `1+1`이 `2`). 브라우저 양성 대조 3/3(`resetTail` 삭제, 알림을 `wait()` 뒤로 이동, 가드 대기 삭제)이 해당 확인만 실패했다가 원복 후 통과했다.
- 메일박스 대기 중 worker는 `complete`에 답하지 못하지만 요청은 포트에 큐잉되어 `deliver` 뒤 응답한다(`protocol/thread-scenario.test.ts`, 스레드 시험). main이 `input()` 읽기 중 Tab을 요청하지 않는다는 쪽은 Tab 리더가 들어오는 RD-015가 시험으로 고정한다.
- 루트 `pnpm check-types`·`lint`·`test`·`build` 통과(시험: `xterm-readline` 78 + `demo` 3 + `pyodide-repl` 24파일 378).

인계: worker는 `worker/stdin-callback.ts`의 `createStdinCallback({ requestInput, wait })`(`requestInput(true)` = `readInput` 알림 → `wait()` 순서를 이 모듈이 소유하고 `\n`을 붙이지 않는다)를 `boot.ts`가 `createConsole` 뒤·`ready` 알림 전에 `pyodide.setStdin({ stdin })`으로 건다(`try` 안이라 던지면 `loadFailed`). `requestInput`은 `rpc.notify("readInput", cancelable)`, `wait`는 `createMailboxReader(...).wait`가 주입된다. main은 `terminal/stdin-reader.ts`의 `createInputReader(readline, term, sinks)`(꼬리 그대로가 프롬프트, SGR 리셋 없음, `rewindTail` 재사용)와 `terminal/read-guard.ts`의 `createReadGuard({ readLine, readInput })`(활성 REPL 읽기 결과 뒤로 stdin 읽기를 미룸, 순서만 담당)를 `createRepl`이 조립한다. `readInput` 알림 핸들러는 가드를 거친 읽기 결과를 `mailbox.deliver`하고 읽기가 실패하면 `disposed`가 아닐 때만 `mailbox.fail(String(error))`로 worker를 깨운다(Python `OSError`). `readLine` 겹침 거절(`reading`)은 가드 바깥에서 검사한다(거절된 promise를 가드가 추적하면 활성 REPL 읽기를 잃는다). stdin 리더에도 REPL 리더와 같은 `liveTerminal` 뷰(TRP-004)를 준다. 취소는 RD-008이 넣었다: `createStdinCallback`이 `signalInterrupt`·`checkInterrupt` 클로저를 더 받아 `wait()`의 `null`을 `input()` 지점의 `KeyboardInterrupt`로 바꾸고(던지지 않으면 `console.warn` + EOF), main의 `readInput` 핸들러가 읽기 취소에 `mailbox.cancel()`을 부르며 `cancelable` 인자를 리더까지 전달한다. 중간 상태를 고정하던 `index.test.ts`·`stdin-callback.test.ts` 시험 두 건은 그때 교체됐다. 키 버퍼링은 없다(`.scratch/type-ahead`). 함정: `docs/traps/` TRP-010(`read(n)`이 남긴 `\n`)·TRP-011(브라우저 확인의 출력 대기가 입력 에코에 즉시 통과).

## Phase 1 — Ctrl+C 전체

### RD-007 — 실행 중 Ctrl+C: 기본 중단, 요청 번호·ack·재전송, 연타 보호, 시작 코드 보호

상태: 완료 · 이전: RD-012, RD-012d, RD-012e, RD-012h(b) · 설계: `03-ctrl-c.md` 2.1~2.4, 2.6, 2.7

`protocol/interrupt-sender.ts`(5ms 점검, 최대 10회 재전송), `worker/sigint-handler.ts`(요청 번호 확인·ack·`<console>` 프레임 규칙·`formattraceback` 절단; Python 소스는 RD-009부터 `sigint-handler.py` + `?raw` import다), `worker/interrupt-buffer.ts`(`connectInterrupts`: 설치 → 폐기 → 연결), REPL 루프의 `discardPendingInterrupt`, main의 `^C` 에코와 `setCtrlCHandler`(게이트 `pythonRunning`).

시나리오: `while True: pass` 중 Ctrl+C → `^C` + `KeyboardInterrupt` 트레이스백 → `>>> `. Ctrl+C를 누르고 있어도(키 반복 30회) 프롬프트가 돌아온다. 새 worker 로드 중 Ctrl+C를 눌러도 시작 코드가 죽지 않는다. `KeyboardInterrupt`를 잡고 계속 도는 프로그램은 눌림 한 번에 한 번만 중단된다.

완료 기준(전부 충족, 실측):
- 단일 눌림 소실 0: node 눌림 주입 N=3000 **소실 0**(자연 발생 소실 76건을 재전송이 전부 복구했다 — 재전송 1회 74건·2회 2건), 브라우저 N=200 **HANG 0**. catch-loop 3000회 **누락 0·이중 0**. 재전송 복구 지연 p50 5.2ms·**max 10.3ms**(기준 20ms 안팎).
- 연타 매트릭스: 0ms 30회, 1·5·20·50ms 30회, 키 반복, 2·5회, 웜 0ms 각 N=20 → **9셀 180시행 전부 프롬프트 복귀**, 대상 `pageerror` 0. TLA 켜짐 0ms 30회는 node 시험(`sigint-handler.test.ts`)이 본다(브라우저 TLA 셀은 RD-012).
- 부팅 중 Ctrl+C `boot-press` dev N=30·preview N=10 **전부 정상**(시행당 60~64회가 실제 부팅 중에 들어갔다).
- 폴링 비용: `loop_i` **1.001**, `str(i)` **0.9943**(plain 대비, 잡음 대조 0.9945·0.9965).
- 변이 검사: SEQ/SIGNAL 순서 뒤집기, 송신기가 ACK를 먼저 읽기, 핸들러 ack 위치 이동, 연결이 무조건 ack하기가 각각 시험을 실패시킨다(DELTA-01~04에서 총 79종 검사, 동치 1종 외 전부 killed).
- 양성 대조 3/3: `^C`를 `readline.print`로 → S1만 실패, 재전송 제거 → 브라우저 HANG 12/200, 핸들러 프레임 규칙 제거 → 연타 HANG.

인계(RD-008, 해소): F×5와 G3·W2는 RD-008이 실행했다(브라우저 `input-burst-matrix.mjs` 5셀·`prompt-cancel-check.mjs` W2/G3). `inputReadsPending`을 내리는 자리는 `deliver` **뒤**로 유지했고 그 지점이 게이트 항 `cancelSettling`도 함께 내린다. `stdin-callback`의 `signalInterrupt`와 핸들러 `last_seq`의 관계는 실측했다: 핸들러가 설치 시점 번호를 `last_seq`로 잡으므로(`last_seq = seq()`) 번호를 올리지 않는 전송은 **세션의 첫 취소부터** 재전송으로 오인돼 버려진다(브라우저 양성 대조 ②).

인계(RD-009, 해소): RD-007 시점의 핸들러는 `<console>` 프레임이 없는 SIGINT를 사용자 실행 중이라도 버려(ack는 했다) `while True: time.sleep(0.1)`·`asyncio.run` 대기 중 Ctrl+C가 무효였다(TRP-020). RD-009가 `install(console, ack, seq, warn, extra_own_codes=())` → `interrupt_idle` 반환으로 넓히고 `own_codes` 확장·`webloop.py` 프레임 제거·감시 타이머(`connectInterrupts` 뒤·루프 앞, `atPrompt`)를 넣었다. 정상 중단마다 나던 webloop 재보고 `pageerror` 시행당 2건도 억제로 0이 됐고, `vitest.config.ts`의 `onUnhandledError` 필터를 지운 뒤 `sigint-handler.test.ts`가 필터 없이 통과한다.

인계(RD-010): 새 worker를 만들기 직전 `sender.cancel()` → `Atomics.store(buffer, SIGNAL, 0)` 순서로 치운다. `index.ts`의 `interruptBuffer`는 세션마다 새로 만들지 않고 상수로 잡혀 있으므로 리셋이 재사용한다(핸들러의 `last_seq` 초기값이 이전 세션 번호를 이어받아 재전송을 무시한다). `endSession()`이 닫은 게이트(`alive`)를 리셋에서 다시 참으로 만든다.

인계(RD-012): 브라우저 연타 매트릭스에 TLA 켜짐 셀을 더한다(RD-007은 node 시험에서만 봤다). `createRepl({ topLevelAwait })`와 데모 토글이 들어온 뒤다.

인계(RD-015): Tab 취소도 `sender.send()`를 쓴다.

인계(RD-018): 확인 스크립트는 `_works/_completed/20260922-07-rd-007-ctrl-c-running/verify/`에 있다 — `ctrl-c-check.mjs`(RM1~RM3·G1·G2·S1a·S1·S08), `press-loss.mjs`, `burst-matrix.mjs`, `boot-press.mjs`, `positive-controls.py`, node 통계는 `verify/node/`. 74개 복원 표는 그 폴더의 `skipped-ids.md`.

### RD-008 — 입력줄 Ctrl+C(미완성 블록 취소)와 `input()` 중 Ctrl+C

상태: 완료 · 이전: RD-012b, RD-012c · 설계: `04-stdin-input.md` 3.1, `06-editing.md` 6.3(취소·`cancelSettling`), `02-console-core.md` 5.2(`run(null)`)

시나리오: `if True:` Enter → `... `에서 Ctrl+C → 빨간 `KeyboardInterrupt` 한 줄(`^C` 없음, 빈 줄 없음) → `>>> ` → `print(1)`이 `1`. `x = input()` 대기에서 `abc`를 치다 Ctrl+C → 입력 줄 아래 표준 트레이스백(`File "<console>", line 1, in <module>` / `KeyboardInterrupt`) → `>>> `, `x` 미대입. 함수 안 `input()` 취소는 그 프레임을 표시한다.

완료 기준(실측):
- 프롬프트 취소: 빈 `>>> `·`>>> abc`·본문이 쌓인 블록·Shift+Enter 버퍼·커서를 앞에 둔 버퍼·꼬리가 든 프롬프트(`t>>> abc`)에서 모두 `\r\n` + 빨간 `KeyboardInterrupt` 한 줄(`^C` 없음, 빈 줄 없음). 다음 입력에 취소된 글자가 섞이지 않고 취소한 입력은 history에 없다(↑ 30회). 브라우저 `prompt-cancel-check.mjs` **23/23**(dev), 세션 리셋 뒤는 RD-010.
- `input()` 취소: `null` → `signalInterrupt`(요청 번호 +1) → `checkInterrupt()` → `KeyboardInterrupt`가 `input()` 호출 지점에서 난다. `try/except KeyboardInterrupt`가 잡고 `except Exception`은 못 잡으며 `finally`·`with`의 `__exit__`가 실행된다. `sys.stdin.readline()`·`read()`·`for line in sys.stdin`·함수 안 `input()`도 같다. 브라우저 `input-cancel-check.mjs` **26/26**(dev). 요청 번호를 올리지 않은 전송이 무시되는 것을 node 시험(TRP-035 검출)과 브라우저 양성 대조 ②가 잡는다.
- 연타: `input()` 대기 5셀(0ms 2회·5회·키 반복 20회·긴/짧은 프롬프트 + 5회)과 `... ` 프롬프트 3셀(0ms 2회·5회·키 반복 20회) × N=20 = **160시행 전부 OK**, 대상 `pageerror` 0. `... ` 셀은 `^C` 0(게이트 항의 직접 관측).
- `cancelSettling` 방어: 게이트 식 `alive && !readLinePending && inputReadsPending === 0 && !cancelSettling`. 해제 지점 셋(`readLine` 도착·`readInput` 도착·`inputReadsPending → 0`). `input()` 취소에는 세우지 않으며, 그 근거로 `except KeyboardInterrupt` 뒤 4초 계산 중 Ctrl+C가 **33~58ms**에 중단됨을 판정 항목으로 확인했다(이전 구현은 방어를 걸어 3.0초 무시).
- 변이 검사 26종 중 24 killed(동치 2: 벤더 `refreshUnhighlighted` 제거, `readInput` 도착의 방어 해제). 브라우저 양성 대조 3/3.
- 3.14.4 pty 재측정 7건이 설계 문서 02a·02b 서술과 전부 일치(`^C` 없음·빈 버퍼도 `KeyboardInterrupt`·`input()` 트레이스백이 입력 줄에 붙음·`readline()`만 `^C` 에코).

구현: 벤더 `Readline.read(prompt, { cancelable })` → `Promise<string | null>`(`^C`·history 없이 `\r\n` 뒤 `null`), 리더·가드가 `cancelable` 전달, `createRepl`의 `readLine`이 `null` 응답·`readInput`이 `mailbox.cancel()`, 게이트 항 `cancelSettling`, `createStdinCallback({ requestInput, wait, signalInterrupt, checkInterrupt })`(던지지 않으면 `console.warn` + EOF 폴백)와 `boot.ts`의 클로저 주입.

인계(RD-005·RD-006 해소): `readLine` 핸들러는 `(prompt, pending, cancelable)`를 받고 취소를 `null`로 응답한다(`pending`은 RD-013·014가 쓴다). `createInputReader.read(cancelable)`·`createReadGuard`의 제네릭은 `string | null`로 넓혔고 가드 규칙은 그대로다. 중간 상태를 고정하던 시험 두 건(`index.test.ts` "stdin 읽기 중 Ctrl+C는 `^C`를 찍고…", `stdin-callback.test.ts` "`wait()`가 `null`이면 `EOFError`")은 취소 동작으로 교체했다. 건너뛰었던 RD-006b G3·W2, RD-011a S14, RD-006b A1~A5·B1·B2·C1·C2·D1·E2·H1·H2·Q1, F×5는 이 RD에서 전부 실행했다(J1·J2는 RD-010).

### RD-009 — 정지한 실행 중 Ctrl+C: 감시 타이머, `time.sleep` 조각, webloop 재보고 억제, 프롬프트 유휴 SIGINT 폐기

상태: 완료 · 이전: RD-012a, RD-012f, RD-021(유휴 폐기) · 설계: `03-ctrl-c.md` 2.4(깨우기·sleep 조각), 2.5, 2.8

시나리오: `while True: time.sleep(0.1)` 중 Ctrl+C 한 번 → 200ms 안에 트레이스백과 `>>> `. `time.sleep(5)` 단발도 끊긴다(JSPI 유무 무관). `asyncio.run(main())`·`run_until_complete`·`run_sync`·top-level await 대기 중 Ctrl+C가 사용자 지점에서 중단된다. sleep 중에는 `call_later` 콜백이 돌지 않는다. 프롬프트 대기 중 눌린 낡은 SIGINT가 배경 콜백을 끊지 않고 조용히 버려진다. 정상 중단·`input()` 취소·`exit()`에서 브라우저 `pageerror`가 0이다.

완료 기준(실측. 화면 형식 판정에서 등록된 편차 2셀만 명시 제외하고 나머지는 전부 충족):
- **브라우저 12조합 × N=20 = 240시행 전부 복귀**, 총 `pageerror` **0**(재보고 포함), 복귀(keydown → 새 프롬프트 행) 중앙값 12/12셀 모두 30ms 이내. dev(`localhost:5173`, Chromium headless), 측정은 페이지 내부 시계(keydown 리스너 + `MutationObserver`)다 — Node↔CDP 왕복으로 재면 문턱 근처에서 5~8ms 과대 측정된다.

  | 셀 | 프로그램 | 중앙값(ms) | 최대(ms) | 형식 판정 |
  | --- | --- | --- | --- | --- |
  | `sleep-0.01` | `while True: time.sleep(0.01)` | 29.61 | 33.76 | 20/20 |
  | `sleep-0.1` | `while True: time.sleep(0.1)` | 26.36 | 34.03 | 20/20 |
  | `sleep-1` | `while True: time.sleep(1)` | 27.61 | 33.94 | 20/20 |
  | `sleep5` | `time.sleep(5)` 단발 | 28.67 | 33.44 | 20/20 |
  | `arun5` | `asyncio.run(asyncio.sleep(5))` | 25.47 | 35.04 | 20/20 |
  | `ruc5` | `run_until_complete(asyncio.sleep(5))` | 26.39 | 34.08 | 20/20 |
  | `runsync5` | `run_sync(asyncio.sleep(5))` | 29.98 | 34.27 | 20/20 |
  | `arun-sleep` | `async def main(): time.sleep(5)` + `asyncio.run(main())` | 26.23 | 34.34 | 0/20(편차 28) |
  | `catch3j` | `KeyboardInterrupt`를 잡고 도는 루프에 3회 | 22.19 | 34.21 | 20/20 |
  | `arun-loop` | `async def main():` / `while True: await asyncio.sleep(0.1)` | 23.25 | 38.44 | 20/20 |
  | `runsync-sleep` | 같은 `main` + `run_sync(main())` | 27.12 | 33.89 | 0/20(편차 28) |
  | `sleep-burst` | `while True: time.sleep(0.1)` 중 0ms 연타 5회 | 28.47 | 37.47 | 20/20 |

  형식 판정(시간 기반 중단 = 트레이스백 정확히 1개 + `KeyboardInterrupt` 마지막 줄 + `>>> ` 복귀 + 우리 프레임 0)은 **10/12셀 통과**다. `arun-sleep`·`runsync-sleep` 2셀은 **복귀 자체는 20/20 정상**이고 지연도 문턱 안이지만, 코루틴 프레임 안에서 동기 `time.sleep` 조각을 직접 부르는 조합이라 pyodide가 Task 취소 경로에서 `sys.excepthook`으로 한 번 더 찍는 트레이스백에 우리 파일명(`<sigint-handler>`·`<sleep-slice>`)이 노출된다 — 새 결함이 아니라 **편차 28**(`10-parity-deviations.md`)의 브라우저 실측 확인이고, `runsync-sleep`은 이번에 확인된 같은 편차의 두 번째 사례다(`docs/traps/TRP-021`).
- 재보고 0(브라우저 재실행 4종, 총 `pageerror`): `repl-check.mjs normal` ⑦ **0**(기준선 RD-005 1건), `ctrl-c-check.mjs` **0**(기준선 RD-007 시행당 2건), `prompt-cancel-check.mjs` 23/23·**0**(기준선 RD-008 4건), `input-cancel-check.mjs` 26/26·**0**(기준선 RD-008 28건).
- node(JSPI 있음·없음 각 N=30 × 5 프로그램 = 300시행): 전부 30/30 중단, stderr가 표준 트레이스백과 정확 일치 300/300, 추가 stderr 0, 200ms 초과 0. 눌림 → stderr 지연(ms):

  | 프로그램 | jspi 중앙값 | jspi p90 | jspi 최대 | nojspi 중앙값 | nojspi p90 | nojspi 최대 |
  | --- | --- | --- | --- | --- | --- | --- |
  | `sleep5` | 12.1 | 20.7 | 41.9 | 10.9 | 20.8 | 46.3 |
  | `loop01`(0.1) | 10.3 | 18.7 | 21.5 | 13.7 | 20.6 | 21.2 |
  | `loop002`(0.02) | 12.2 | 19.9 | 20.4 | 11.4 | 21.0 | 21.4 |
  | `loop0015`(0.015) | 7.9 | 15.6 | 16.5 | 10.5 | 15.5 | 16.7 |
  | `loop001`(0.01) | 6.7 | 11.4 | 11.8 | 7.6 | 10.8 | 11.2 |

  ≤20ms 폴링 1회를 지우면 `loop002` 중앙값 12.2 → 187.6ms(15.4배)·최대 20.4 → 339.5ms(16.6배), `loop001` 중앙값 6.7 → 66.6ms(9.9배)다(TRAP-25 재확인, 이전 구현 실측 약 13배와 같은 자릿수).
- 무효 인자(`-1`·`'a'`·NaN·inf·키워드·인자 2개·`9.3e9`)는 로컬 3.14.4와 같은 예외 문구, `0`·`True`는 오류 없음(`sigint-handler-sleep-slice.test.ts`).
- 프롬프트 유휴 폐기(`interrupt-watch.test.ts` 15건 + `boot.test.ts` 통합 3건, RED 확인 + 변이 검사), 실행 중 규칙(깨울 수 없으면 남긴다) 유지.
- 설치 가드 5종(`pyodide.webloop.run_sync`·`pyodide.ffi.run_sync`·`console.runcode` 코루틴 여부·`time.sleep.__wrapped__`가 builtin·`pyodide_js.checkInterrupt` 호출 가능)이 가드마다 `warn` 정확히 1회를 내고 나머지 부분은 계속 동작한다. webloop 억제도 속성이 빠지면 전부 건너뛰고 경고한다.
- `vitest.config.ts`의 `onUnhandledError` 필터를 **제거**했고 `pnpm --filter @cp949/runo-pyodide-repl test`가 32파일 / 584건 통과·`Errors 0`·종료코드 0이다. 변이 검사 26종 중 **24 killed**(동치 2: `bool` 분기 제거, `runcode` 종료부 `pending = False`만 제거 — 후자는 대체 변이 M6b로 규칙을 덮었다).
- 양성 대조 3/3이 해당 확인만 실패했다가 원복 후 통과: ①`suppressWebLoopReraise` 호출 제거 → `ctrl-c-check.mjs` `pageerror` 0 → 10, ②`sleep-slice.py`의 ≤20ms 폴링 제거 → `sleep-0.01` 중앙값 28.44 → 96.79ms, ③`startInterruptWatch` 호출 제거 → `arun5` 중앙값 24.22 → 4010.3ms.
- preview 부분 확인: `pnpm build` 뒤 `dist/worker.mjs`·`repl.worker-*.js`에 Python 소스가 문자열로 인라인(`def install(`·`def sigint_handler(`·`_keyboard_interrupt_handler`·`SLEEP_SLICE`), preview(4173)에서 `sleep-0.1`·`arun5`·`catch3j` N=5 15/15·`pageerror` 0, `repl-check.mjs normal` 15/15·`exitPageErrors` 0.

구현: Python 소스는 전부 `.py` 파일 + `?raw` import다(tsdown `load` 훅 플러그인 + `src/py-modules.d.ts`, `runPython`에 `<파일명>` 관례로 넘긴다). 모듈: `worker/webloop-reraise.py`·`.ts`(`suppressWebLoopReraise(pyodide, { warn })` — WebLoop `_keyboard_interrupt_handler`·`_system_exit_handler`를 no-op으로, 부분 설치 없음), `worker/sleep-slice.py`·`.ts`(`installSleepSlice(pyodide, { warn }): PyProxy | undefined` — `time.sleep` 20ms 조각 + 조각마다 `checkInterrupt()`, ≤20ms도 폴링 1회, 우리 코드 객체 tuple 반환), `worker/sigint-handler.py`·`.ts`(`install(console, ack, seq, warn, extra_own_codes=())` → `interrupt_idle`; 규칙 ③ 깨우기·`run_sync`/`runcode` 래퍼·`IdleInterrupt`·`pending`·`formattraceback` 확장), `worker/interrupt-watch.ts`(`startInterruptWatch(deps): () => void`, deps = `interruptIdle`·`atPrompt`·`hasPending`·`consume`·`discard`·`tickMs = 20`), `protocol/interrupt-protocol.ts`의 `hasPendingInterrupt`·`consumeInterrupt`, `ReplLoopDeps.setAtPrompt(value)`. `connectInterrupts`는 `InterruptIdle`(PyProxy)을 돌려주고 순서는 조각 교체 → 핸들러 설치 → 폐기 → 버퍼 연결이다. `boot.ts`: `createConsole` → `suppressWebLoopReraise` → `connectInterrupts` → `setStdin` → `ready` → 배너 → `startInterruptWatch` → `runReplLoop` → `finally`에서 `stopWatch()`·`interruptIdle.destroy()`.

인계(RD-005·RD-008 해소): `exit()` 뒤 `pageerror` 1건, `input()` 취소의 재보고 4·28건은 webloop 억제로 전부 0이 됐다(위 재실행 4종). `vitest.config.ts`의 `onUnhandledError` 필터도 제거했다.

인계(RD-007 해소): `install`에 `warn`·`interrupt_idle` 반환·`own_codes` 확장·`webloop.py` 프레임 제거·감시 타이머를 모두 넣었다. `sigint-handler.test.ts`는 필터 없이 통과한다.

인계(RD-010): 세션 리셋은 worker 교체이므로 감시 타이머(`setInterval`)와 `interruptIdle` proxy는 worker와 함께 사라진다 — 리셋 경로에 별도 정리를 넣을 필요가 없다(`boot.ts`의 `finally`는 `exit()`로 루프가 끝나는 경우를 위한 것이다). 리셋 순서는 그대로 `sender.cancel()` → `Atomics.store(buffer, SIGNAL, 0)` → `terminate()`를 유지한다: 감시 타이머가 죽은 뒤 남은 SIGINT 2는 새 worker의 연결 단계가 폐기한다.

인계(RD-012): 브라우저 TLA 3셀(`await5`·`awaitloop`·`tla-sleep-0.1`)은 데모에 TLA 스위치가 없어 node 시험(`sigint-handler-idle.test.ts`의 TLA 4건, `createConsole(..., { topLevelAwait: true })`)으로 **대체 완료**했고, 브라우저 12조합은 비TLA 9셀 + 대체 3셀(`arun-loop`·`runsync-sleep`·`sleep-burst`)로 채웠다. 데모에 TLA 스위치가 생기면 `sleep-await-check.mjs`에 TLA 셀을 추가해 같은 판정으로 돌린다.

인계(RD-018): RD-009 검증 스크립트는 `_works/_completed/20260922-09-rd-009-idle-ctrl-c/verify/`에 있다 — `lib.mjs`(RD-008 하니스 + `finish()`의 `ok` 판정을 **전체** `pageErrors` 0으로), `sleep-await-check.mjs`(12조합 × N=20, `ONLY=<셀,…>`, 페이지 내부 시계 측정), `run-browser.sh`, `positive-controls.py`(3건), `mutate-safe.mjs`, node 통계는 `verify/node/`의 `sleep-stats.mjs`·`run-n30.sh`·`py-raw-hook.mjs`. 결과는 같은 폴더 `verify/results/`(`sleep-await-dev.json`이 canonical, `node-sleep-{jspi,nojspi}.json`, 재실행 4종 로그, `positive-control-{1,2,3}.log`, preview 2종). **기준선 문구 갱신**: 이전 항목들이 쓰던 "대상 `pageerror`(재보고 제외) 0"은 더 이상 맞지 않다 — 재보고 자체가 없어졌으므로 모든 브라우저 확인의 기준선은 **총 `pageerror` 0**이다. 브라우저 지연을 재는 확인은 Node 쪽 DOM 폴링이 아니라 페이지 내부 시계를 쓴다(`sleep-await-check.mjs` 참고, `docs/traps/TRP-022`).

## Phase 2 — 세션·제출·편집·완성

### RD-010 — 세션 리셋, 종료 정책, 크래시 재시작 UI

상태: 대기 · 이전: RD-014, RD-009(재시작), RD-008(Chip) · 설계: `08-session.md`, `00-architecture.md` 3.4·4.3

시나리오: `세션 리셋` 버튼 → 변수·import가 사라지고 화면 스크롤은 유지, 안내 줄(청록) 뒤 새 배너. `exit()` 뒤 Alert가 뜨고 리셋으로 복구. worker가 죽으면(강제 `throw`) 재시작 버튼이 뜬다. Ctrl+L은 화면만 지우고 Python 상태는 그대로다. 리셋 직전 눌린 Ctrl+C가 새 세션의 시작 코드를 죽이지 않는다.

완료 기준: 위 시나리오(브라우저). 리셋 순서(들여쓰기 단위 초기화 → 송신기 취소 → `SIGNAL=0` → terminate → 새 worker·새 메일박스·새 sink 세트)가 시험으로 고정된다. StrictMode 이중 마운트에서 경고·중복 worker가 없다. `dispose()`가 두 번 불려도 안전하다.

인계(RD-005): `exit()`(`terminated`) 뒤 worker는 살아 있고 터미널·입력은 무응답이다. 복구는 이 RD의 리셋과 Alert다(데모의 `Python session terminated.` 한 줄을 Alert로 교체). `createRepl`의 `liveTerminal` 뷰가 쓰는 `disposed`는 핸들 단위이므로 리셋이 핸들을 유지한 채 세션만 바꾸면 세션 단위 해제 신호가 필요하다(이전 세션의 `rewindTail` flush 콜백이 새 세션 읽기에 끼어들 수 있다). 건너뛴 이전 시나리오: RD-006b의 AC1·J2(세션 리셋 뒤 꼬리·`input()` 취소).

인계(RD-006): 세션 리셋 뒤 프롬프트가 이전 꼬리를 물려받지 않는 성질은 `stdin-reader.test.ts`의 "새 sink 세트는 빈 프롬프트로 시작한다"(단위)까지만 본다. 브라우저 확인은 RD-006b의 J1·J2·J3(J1·J2는 취소도 필요해 RD-008 뒤)·AC1이다. 리셋은 세션마다 `createStdinMailbox`·sink 세트·`createInputReader`·`createReadGuard`를 새로 만들어야 옛 세션의 stdin 읽기·가드 추적이 새 세션에 끼어들지 않는다. `readInput` 핸들러의 `disposed`는 핸들 단위라 리셋이 핸들을 유지하면 옛 worker가 죽었다는 세션 단위 신호가 필요하다(죽은 worker에 대한 `mailbox.fail()`의 `untilIdle`은 영영 안 풀린다).

인계(RD-008): 취소가 들어왔으니 세션 리셋 뒤 취소 4건(RD-012b J1·J2, RD-012c J1·J2)을 이 RD가 브라우저로 본다 — 스크립트는 `prompt-cancel-check.mjs`·`input-cancel-check.mjs`에 확인을 추가하면 된다(`skipped-ids.md` 3절). **게이트 항 `cancelSettling`을 리셋에서 `false`로 초기화해야 한다**: 옛 세션의 취소 응답으로 참이 된 값이 남으면 새 세션의 첫 Ctrl+C가 에코도 전송도 되지 않는다. `alive`·`readLinePending`·`inputReadsPending`과 같은 자리에서 초기화한다. 새 리더·가드에도 `cancelable` 전달을 유지한다(`read(prompt, cancelable)`·`read(cancelable)`).

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

인계(RD-008): 건너뛴 이전 시나리오는 RD-012b G1(2칸 블록을 취소해도 다음 블록 프리필이 2칸)이다 — 취소가 `lastUsedIndentation`을 지우지 않아야 한다. 프리필이 없어서 RD-008이 이식할 때 기대값을 고친 확인이 셋 더 있다: RD-012b C1(블록 본문을 `    print(2)`로 직접 쳐야 한다)과 D1·D2·D3(Shift+Enter 둘째 행이 `print(3)`이다). 프리필이 들어오면 옛 기대(`... ` 다음 줄 4칸, `    print(3)`)로 되돌린다(`_works/_completed/…-rd-008-…/verify/skipped-ids.md` 4절). auto-indent 래퍼는 벤더 `Readline.read(prompt, { cancelable })`를 감싸고 취소 분기(`^C`·history 없이 `null`)는 바꾸지 않는다. `createRepl`의 `readLine` 핸들러는 이미 `(prompt, pending, cancelable)`를 받으며 `pending`만 무시하고 있다.

### RD-014 — 블록 입력을 history 항목 하나로

상태: 대기 · 이전: RD-020 · 설계: `06-editing.md` 6.4

시나리오: `for i in range(2):` / `    print(i)` / 빈 줄로 끝낸 뒤 ↑ → 블록 전체가 돌아오고 Enter 한 번으로 재실행. Ctrl+C로 취소한 블록은 history에 남지 않는다.

완료 기준: 위 시나리오 + 괄호 안 빈 줄 보존, 문법 오류·예외·`exit()`로 끝난 블록도 전체가 남음, 공백만 있는 제출 제외, `... ` 입력줄의 ↑ 무동작. 벤더링 `History`에 삭제/복원 API를 추가할지 착수 시 결정하고 결정을 DELTA에 남긴다.

인계(RD-005): 건너뛴 이전 시나리오는 RD-006b의 X2·X3(블록 history 재호출 뒤 `012>>> ` 프롬프트 유지)다. worker는 `readLine`에 `pending`을 보내지만 main 핸들러가 아직 쓰지 않는다.

인계(RD-006): `createReadGuard`의 `readLine`은 `(prompt)`만 받는다. `pending`을 리더에 넣는 RD-013·014는 `ReadGuardDeps.readLine` 시그니처와 `createRepl`의 `readLine` 핸들러·조립을 함께 넓힌다(REPL 읽기는 가드가 즉시 부르므로 시작 타이밍은 그대로다).

인계(RD-008): 블록 history의 `discard()`를 걸 지점은 main `readLine` continuation의 `line === null`(취소)이다 — worker 쪽에서 `run(null)`이 `clearPending()`하는 것과 짝이다. "Ctrl+C로 취소한 블록은 history에 남지 않는다"는 완료 기준 중 **줄 단위 부분은 이미 성립한다**: RD-008이 RD-012c H2(취소 뒤에도 제출한 블록 줄이 ↑로 돌아온다)와 RD-012b H1(취소한 입력 줄은 ↑ 30회 동안 없다)을 브라우저로 통과시켰다. 이 RD가 볼 것은 블록을 항목 하나로 묶은 뒤의 동작이다(RD-006b X2·X3 포함).

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

인계(RD-008): RD-008 검증 스크립트는 `_works/_completed/20260922-08-rd-008-prompt-and-input-cancel/verify/`에 있다 — `lib.mjs`(RD-007 하니스 + `cancelWhenReading`·`ctrlCBurst`·`caretCount`·`interruptCount`), `prompt-cancel-check.mjs`(23개), `input-cancel-check.mjs`(26개), `input-burst-matrix.mjs`(8셀), `positive-controls.py`(3종), `pty/pty_cancel.py`·`pty/results.md`(3.14.4 취소 7건), `mutate-safe.mjs`(멈추는 변이를 끊는 변이 검사기), `skipped-ids.md`. **기준선 문구 갱신**: 이전 "RD-012b 22/24, RD-012c 20/24"는 더 이상 맞지 않다 — 낡은 기대값 8건을 현재 설계로 고쳐 **이식 세트 실패 0**이고, 남은 건너뜀은 5줄(RD-012b G1 → RD-013, RD-012b·012c J1·J2 → RD-010, RD-006b J3·AC1 → RD-010, X2·X3 → RD-014)이다. 확인 스크립트에서 출력 유무를 판정할 때 **부분일치를 쓰지 않는다**: 제출한 소스 줄이 화면에 에코되므로 `print('wrong')` 같은 줄이 `wrong`에 걸린다(행 정확일치 `hasRow` 또는 기준선 대비 증가분 `countOf`를 쓴다).

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
