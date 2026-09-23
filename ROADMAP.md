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
- 브라우저 회귀 기준선(아래 RD-018)과의 대조는 L0 + L1로 한다: 변경 영역 개별 스크립트 통과 + 기대값이 바뀐 행만 `apps/demo/e2e/BASELINE.md` 갱신. 전체 `pnpm --filter demo e2e:baseline`(L2)은 사용자가 지시할 때만 돌린다(2026-09-24 사용자 확정, `docs/agents/rubber-workflow.md` "검증 실행 예산").
- RD-018 확정 11: 새 RD의 브라우저 확인 스크립트는 처음부터 `apps/demo/e2e/checks/`(또는 `measure/`)에 쓰고 작업 브랜치에 커밋한다. 변이 검사 기록·`positive-controls.md`(수행 기록)·`results/`는 `_works/<작업>/`에 둔다.

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

worker의 REPL 루프(`readLine` 요청 → `submission-runner.run`)와 main의 `repl-reader`(꼬리 + `>>> ` 합성). 한 줄 제출만 다룬다(여러 줄 제출은 RD-011이 더했다).

시나리오: `>>> 1 + 1` Enter → `2` → `>>> `. 빈 줄 Enter는 무해하다. `if True:` Enter → `... ` → `    print(1)` Enter → 빈 줄 Enter → `1`. `1 +` Enter → SyntaxError 즉시 표시. `1/0` → 트레이스백에 `__repl_run`/`push`/`runcode` 프레임이 없다. `print("t", end="")` 실행 뒤 다음 프롬프트가 `t>>> `로 같은 줄에 붙는다. `exit()` → "Python session terminated." 안내, 이후 입력 무응답.

완료 기준:
- 위 시나리오 전부(브라우저). (RD-004에서 완료) 배너 뒤·값 에코 뒤 빈 줄 없음. `sys.ps1`/`ps2` 설정과 배너 `writeOutput`도 RD-004에서 끝났다.
- EOF에서 끊긴 문법 오류(`1 +`·`foo bar`)는 pyodide 314.0.7 콘솔이 `SyntaxError: invalid syntax`가 아니라 `_IncompleteInputError: incomplete input`으로 표시한다(`runLine`은 `syntax-error`로 분류하고 `formattedError`를 그대로 돌려준다). 위 `1 +` 시나리오의 화면 마지막 줄을 3.14.4 pty와 비교해 맞추거나 편차로 등록한다(근거·표: `.scratch/incomplete-input-error-display/issues/01-incomplete-input-error-display.md`). 결과: 재컴파일 정규화를 채택해 `1 +`·`foo bar`·블록 안 `1 +`가 3.14.4 pty와 캐럿까지 일치하고 본문 없는 중첩 블록은 `IndentationError` 문구가 같다(이슈 `done`, 편차 13은 즉시 표시(편차 11)만 남는다).
- `ConsoleFuture`는 Python 쪽 `await_fut` 헬퍼로만 await한다. `run(null)` 선분기(버퍼 clear → `KeyboardInterrupt` 빨강 → `>>> `). `run()` 안전망(`ConversionError` 판별)이 있다. node + 실제 pyodide 시험(이전 `submission-runner.test.ts` 상당).
- REPL 프롬프트 이어붙임: `t>>> `, 빈 Enter 뒤 열 0의 `>>> `, 블록 실행 뒤 `012>>> `, stderr 꼬리 뒤 `e>>> `(`e`만 빨강), 닫히지 않은 색 뒤 기본색, `\r30%`→`\r100%` 뒤 `100%>>> `, 100·130·200자·전각·정확히 80자 꼬리에서 앞 행 중복 없음(이전 RD-006b 브라우저 74개 시나리오를 옮겨 같은 결과).
- 값 에코 뒤·트레이스백 뒤·SyntaxError 뒤·배너 뒤에 빈 줄이 없다(이전 RD-011a 16개 시나리오).

인계: worker 루프는 `worker/repl-loop.ts`의 `runReplLoop(deps)`(`readLine(prompt, pending)` → `run(line)` → `exit`면 `onTerminated` 후 종료)이고 `protocol/`을 import하지 않는다(`boot.ts`가 rpc 래퍼를 주입한다). 한 줄 실행은 `worker/submission-runner.ts`의 `createSubmissionRunner(pyodide, repl, io).run(line | null)`이다(`PS1`/`PS2`, 값 에코, 오류 표시에서 끝 개행 하나 제거, `null` 선분기, `KeyboardInterrupt` 안전망). `ReplConsole`에 `pending()`/`clearPending()`이 생겼고 `RunLineResult.complete`는 `{ echo, exited }`다(`echo`는 Python이 만든 `repr()` 전체, `None`은 `null`). 예상 밖 오류는 `repl 내부 오류: …`(빨강) + `clearPending()` 후 `>>> `로 계속하고, `readLine` reject는 `rpc disposed`면 조용히·아니면 `console.error` 후 루프가 끝난다. main은 `terminal/repl-reader.ts`의 `createReplReader`(`rewindTail` → 꼬리 재조회 → `resetTail` → `readline.read(꼬리 + "\x1b[0m" + 프롬프트)`)와 `terminal/rewind-tail.ts`를 쓰고, `createRepl`은 RPC `readLine` 핸들러(겹치는 요청은 `Error("이미 읽는 중")`로 거절, `pending`·`cancelable`은 받지 않는다)와 `sessionTerminated` → `onStatus('terminated')`(터미널 무출력, worker는 살려 둔다)를 처리한다. `ReplHandle`은 `dispose`·`crossOriginIsolated`만 남았다. 리더는 dispose 뒤 write 콜백을 전달하지 않는 터미널 뷰(`createRepl`의 `liveTerminal`)를 받는다(`docs/traps/TRP-004`). 데모는 `terminated`일 때 `Python session terminated.`를 보인다. 개행이 든 붙여넣기·Shift+Enter·히스토리 재호출 제출을 분할·실행하는 분기는 RD-011이 더했다. 값 에코가 `sys.displayhook`을 거치지 않는 것은 편차 33이다. 브라우저 확인 스크립트(`lib.mjs` 하니스, `repl-check.mjs`, `prompt-join-check.mjs`, `trailing-newline-check.mjs`, `carryover-check.mjs`, `keys-after-enter-probe.mjs`, 양성 대조 드라이버 `positive-controls.py`)는 `_works/_completed/20260922-05-rd-005-repl-loop/verify/`에 있고 RD-018이 보관한다. 결과: dev `repl-check normal` 15/15(preview 15/15), `prompt-join-check` 20/20, `trailing-newline-check` 13/13, `carryover-check` 4/4, 양성 대조 4/4. 편차 32 재측정(N=10)의 창은 약 20ms로 worker 왕복이 더해지기 전과 같다(`10-parity-deviations.md` 32). `exit()` 뒤 브라우저 `pageerror` 1건(webloop `run_handle`의 `SystemExit` 재보고)은 **RD-009에서 해소**됐다(억제 뒤 `repl-check.mjs normal` ⑦ 0건). 건너뛴 이전 브라우저 시나리오 ID는 아래 각 RD의 인계에 있다. 함정: 하니스에서 Enter 뒤 `waitPrompt`가 화면 갱신 전의 낡은 프롬프트 행에 통과한다(`TRP-005`), 변조·원복을 반복하며 vite dev를 재시작하지 않으면 원복한 파일의 다음 변조가 반영되지 않는다(`TRP-007`), "로그가 없다"는 확인은 화면을 지우고 직후 정확한 행 목록으로 단언한다(`TRP-008`).

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

인계(RD-012, 완료): 브라우저 연타 매트릭스에 TLA 켜짐 셀을 더한다(RD-007은 node 시험에서만 봤다). `createRepl({ topLevelAwait })`와 데모 토글이 들어온 뒤다 — RD-012가 `tla-burst`(0ms 30회)로 채웠다(20/20, `sleep-await-check.mjs` `burst` 판정).

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

인계(RD-005·RD-006 해소): `readLine` 핸들러는 `(prompt, pending, cancelable)`를 받고 취소를 `null`로 응답한다(`pending`은 RD-013이 자동 들여쓰기로 썼고 RD-014가 블록 history로 쓴다). `createInputReader.read(cancelable)`·`createReadGuard`의 제네릭은 `string | null`로 넓혔고 가드 규칙은 그대로다. 중간 상태를 고정하던 시험 두 건(`index.test.ts` "stdin 읽기 중 Ctrl+C는 `^C`를 찍고…", `stdin-callback.test.ts` "`wait()`가 `null`이면 `EOFError`")은 취소 동작으로 교체했다. 건너뛰었던 RD-006b G3·W2, RD-011a S14, RD-006b A1~A5·B1·B2·C1·C2·D1·E2·H1·H2·Q1, F×5는 이 RD에서 전부 실행했다(J1·J2는 RD-010).

### RD-009 — 정지한 실행 중 Ctrl+C: 감시 타이머, `time.sleep` 조각, webloop 재보고 억제, 프롬프트 유휴 SIGINT 폐기

상태: 완료 · 이전: RD-012a, RD-012f, RD-021(유휴 폐기) · 설계: `03-ctrl-c.md` 2.4(깨우기·sleep 조각), 2.5, 2.8

시나리오: `while True: time.sleep(0.1)` 중 Ctrl+C 한 번 → 200ms 안에 트레이스백과 `>>> `. `time.sleep(5)` 단발도 끊긴다(JSPI 유무 무관). `asyncio.run(main())`·`run_until_complete`·`run_sync`·top-level await 대기 중 Ctrl+C가 사용자 지점에서 중단된다. sleep 중에는 `call_later` 콜백이 돌지 않는다. 프롬프트 대기 중 눌린 낡은 SIGINT가 배경 콜백을 끊지 않고 조용히 버려진다. 정상 중단·`input()` 취소·`exit()`에서 브라우저 `pageerror`가 0이다.

완료 기준(실측. 형식 판정의 2셀 제외는 RD-009a가 해소했다):
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
  | `arun-sleep` | `async def main(): time.sleep(5)` + `asyncio.run(main())` | 26.23 | 34.34 | 20/20(RD-009a) |
  | `catch3j` | `KeyboardInterrupt`를 잡고 도는 루프에 3회 | 22.19 | 34.21 | 20/20 |
  | `arun-loop` | `async def main():` / `while True: await asyncio.sleep(0.1)` | 23.25 | 38.44 | 20/20 |
  | `runsync-sleep` | 같은 `main` + `run_sync(main())` | 27.12 | 33.89 | 20/20(RD-009a) |
  | `sleep-burst` | `while True: time.sleep(0.1)` 중 0ms 연타 5회 | 28.47 | 37.47 | 20/20 |

  형식 판정(시간 기반 중단 = 트레이스백 정확히 1개 + `KeyboardInterrupt` 마지막 줄 + `>>> ` 복귀 + 우리 프레임 0)은 지금 **12/12셀 통과**다. RD-009 당시 10/12셀이었고 남은 2셀(`arun-sleep`·`runsync-sleep`, **복귀 자체는 20/20 정상**이고 지연도 문턱 안이지만 코루틴 프레임 안에서 동기 `time.sleep` 조각을 직접 부르는 조합이라 pyodide가 `sys.excepthook`으로 한 번 더 찍는 트레이스백에 우리 파일명이 노출됐다, **편차 28**)은 RD-009a가 해소해 12/12다.
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

인계(RD-012, 완료): 브라우저 TLA 3셀(`await5`·`awaitloop`·`tla-sleep-0.1`)은 데모에 TLA 스위치가 없어 node 시험(`sigint-handler-idle.test.ts`의 TLA 4건, `createConsole(..., { topLevelAwait: true })`)으로 **대체 완료**했고, 브라우저 12조합은 비TLA 9셀 + 대체 3셀(`arun-loop`·`runsync-sleep`·`sleep-burst`)로 채웠다. 데모에 TLA 스위치가 생기면 `sleep-await-check.mjs`에 TLA 셀을 추가해 같은 판정으로 돌린다 — RD-012가 `tla: true` 셀 4개(`await5`·`awaitloop`·`tla-sleep-0.1`·`tla-burst`, 각 N=20 전부 통과)로 채웠다.

인계(RD-018): RD-009 검증 스크립트는 `_works/_completed/20260922-09-rd-009-idle-ctrl-c/verify/`에 있다 — `lib.mjs`(RD-008 하니스 + `finish()`의 `ok` 판정을 **전체** `pageErrors` 0으로), `sleep-await-check.mjs`(12조합 × N=20, `ONLY=<셀,…>`, 페이지 내부 시계 측정), `run-browser.sh`, `positive-controls.py`(3건), `mutate-safe.mjs`, node 통계는 `verify/node/`의 `sleep-stats.mjs`·`run-n30.sh`·`py-raw-hook.mjs`. 결과는 같은 폴더 `verify/results/`(`sleep-await-dev.json`이 canonical, `node-sleep-{jspi,nojspi}.json`, 재실행 4종 로그, `positive-control-{1,2,3}.log`, preview 2종). **기준선 문구 갱신**: 이전 항목들이 쓰던 "대상 `pageerror`(재보고 제외) 0"은 더 이상 맞지 않다 — 재보고 자체가 없어졌으므로 모든 브라우저 확인의 기준선은 **총 `pageerror` 0**이다. 브라우저 지연을 재는 확인은 Node 쪽 DOM 폴링이 아니라 페이지 내부 시계를 쓴다(`sleep-await-check.mjs` 참고, `docs/traps/TRP-022`).

### RD-009a — `run_sync` 계열 대기에서 코루틴이 낸 예외의 중복 트레이스백 제거와 코루틴 프레임 보존

상태: 완료 · 이전: RD-012i · 설계: `03-ctrl-c.md` 2.4(깨우기 세부의 `guard`·`run_sync` 래퍼·`formattraceback`)

RD-009 브라우저 12조합에서 형식 판정을 제외한 `arun-sleep`·`runsync-sleep` 2셀(편차 28, `docs/traps/TRP-021`)을 해소한다. 착수 전 실측(2026-09-22 node, pyodide 314.0.7)으로 결함의 범위가 KeyboardInterrupt보다 넓다는 것이 확인됐다: `asyncio.run`·`run_until_complete`·`run_sync`로 들어간 awaitable이 **어떤 예외로든** 끝나면 pyodide가 그 Task를 Promise로 바꾸는 done 콜백(`FutureDoneCallback` → `wrap_exception()`)에서 `PyErr_Print()`로 `sys.excepthook`을 부르고, 콘솔 `runcode` 중에는 `sys.stderr`가 콜백 스트림이라 fd 2만 가로채는 `capture_stderr()`를 우회해 화면에 찍힌다. Task 취소·`guard`와 무관하다(원본 `run_sync`도 두 번 찍는다). 그래서 `async def main(): raise ValueError('boom')`도 지금 트레이스백이 둘이고 첫째에 `<sigint-handler>` `guard` 프레임이 새며, `sys.exit()`도 `guard` 프레임이 든 인쇄 뒤 종료된다. 콘솔이 찍는 둘째 트레이스백은 `<module>`만 남기므로(`run_sync` 래퍼 프레임에서 절단) 사용자가 `main`의 줄 번호를 보는 곳은 중복 인쇄뿐이었다.

해소: `guard`가 `BaseException`(우리 취소는 `WOKEN` 그대로, `GeneratorExit`만 재raise)을 비공개 홀더 `Raised(exc)`에 담아 정상 값으로 끝내고 `run_sync` 래퍼가 사용자 스택에서 `raise result.exc`로 **그 객체**를 올린다(인자·`__context__`·`__cause__` 보존). 예외가 Task 실패로 JS 경계를 넘지 않으므로 excepthook 경로를 타지 않는다. `sys.excepthook`은 건드리지 않는다. 나르기 전에 예외의 트레이스백에서 우리 프레임을 다듬고(머리의 `guard` 제거, 첫 우리 프레임부터 안쪽 절단) `formattraceback` 규칙을 "가장 안쪽 프레임이 우리 코드일 때만 첫 우리 프레임부터 절단(+ 자른 자리 바깥 `webloop.py`), 그 뒤 우리 프레임과 그 바로 바깥에 붙은 `webloop.py` 프레임 개별 제거"로 바꿔 코루틴 안 사용자 프레임을 남긴다.

시나리오: `<console>`에서 정의한 `async def main():` / `    time.sleep(5)`를 `asyncio.run(main())`·`run_until_complete(main())`·`run_sync(main())`으로 실행하는 중 Ctrl+C → 트레이스백 정확히 1개(`File "<console>", line 1, in <module>` / `File "<console>", line 2, in main` / `KeyboardInterrupt`) → `>>> `. 화면 어디에도 `<sigint-handler>`·`<sleep-slice>`·`webloop.py` 프레임이 없다. `main` 안의 `try/except KeyboardInterrupt`·`finally`는 그대로 동작한다. `main`이 `raise ValueError('boom')`이면 트레이스백 1개에 `main` 줄과 `ValueError: boom`, `raise KeyboardInterrupt('custom')`이면 `KeyboardInterrupt: custom` 1회, `except ValueError:` 안의 sleep을 끊으면 `During handling of the above exception…` 사슬이 1회, `sys.exit(3)`이면 인쇄 없이 종료.

완료 기준(실측):
- node: `sigint-handler-idle.test.ts`에 러너 3종 × (sleep 눌림·ValueError·`KeyboardInterrupt('custom')`·컨텍스트 사슬·`except`/`finally`·`sys.exit`·사용자 `CancelledError`·사용자가 잡은 객체의 `__traceback__`에 `guard`·`sleep`·`poll`·`sigint_handler`·`wasm://` 없음·중첩 `helper`·`asyncio.sleep('x')`의 `TypeError`에 `tasks.py` 프레임 잔존) 40건 추가, 5파일(`sigint-handler-idle`·`sigint-handler-sleep-slice`·`sigint-handler`·`sigint-handler-nojspi`·`boot`) 105/105 통과. 변이 검사 6종(DELTA-01 2종 + DELTA-02 4종) 전부 killed. `pnpm --filter @cp949/runo-pyodide-repl test` 32파일 598/598 통과. 취소 깨우기 3종 `toBe(CONSOLE_TRACEBACK)`·연타·`ensure_future` 누출·중첩·무효 인자 문구 시험 불변.
- 브라우저(dev, Chromium headless, pyodide 314.0.7): `arun-sleep`·`runsync-sleep` N=20 40/40(중앙값 28.42·29.73ms, 최대 34.26·34.16ms), `pageErrors` 0. 나머지 10셀 N=5 50/50, `pageErrors` 0(중앙값 24.68~32.20ms). 화면 원문에 `main` 프레임(`File "<console>", line 1, in main`) 확인.
- 문서: 편차 28 해소로 표시(번호 유지, 기전을 실측대로 정정), 새 편차 39(콘솔 실행 중 JS→Python 콜백 예외의 중복 인쇄 — `run_sync` 밖이라 이 RD 범위 밖), TRP-021 재작성(ACTIVE 유지, 제목·적용 조건·원인·해소·재발 조건), `03-ctrl-c.md` 2.4, RD-009 표의 두 행을 20/20(RD-009a)으로, `09-testing.md` 9.3의 "10/12셀" 문구를 12/12로, `sigint-handler.py` 머리 주석.
- 루트 4종(`pnpm check-types`·`pnpm lint`·`pnpm test`·`pnpm build`) 통과.

허용 편차: 사용자가 직접 `traceback.print_exc()`로 찍으면 `run_sync` 래퍼·`webloop.py` 프레임이 남는다(모든 깨우기 경로에서 지금과 같다). 설치 가드에 걸려 래퍼가 없는 pyodide에서는 원본 동작(중복 인쇄, 우리 프레임 없음)으로 돌아간다.

근거(2026-09-22 node 실측, 임시 시험은 삭제): `async def main(): raise ValueError('boom')` + `asyncio.run(main())` → 트레이스백 2개, 첫째 `File "<sigint-handler>", line 133, in guard` / `File "<console>", line 2, in main`. `raise KeyboardInterrupt('custom')`도 2개. `sys.exit(3)` → `guard` 프레임이 든 인쇄 1회 + `exit: true`. `except ValueError: time.sleep(5)` 중 눌림 → `During handling…`이 두 트레이스백 모두에. 사용자가 잡은 객체의 `__traceback__`에 `run_sync`·`guard`·`sleep`·`poll`·`sigint_handler`·`webloop.py`·`wasm://` 19개 전부. 원본 `run_sync`(래퍼 없음)도 2개(첫째는 `main`만). runcode 밖(JS `runPython`, `sys.stderr = StringIO()`)에서는 캡처되어 `PythonError.message`로 들어간다. 앞선 확인(`guard`에 `except KeyboardInterrupt: return WOKEN` 한 분기로 조인 시험 통과, 5파일 91건 불변)은 이 설계의 부분 집합이다. 이전 구현 하니스(`sleep-await.mjs`)는 이 셀에 `allowOurFrames: true`·트레이스백 1~2개 예외를 사용자 결정으로 두고 있었다.

인계(RD-018): RD-018은 `sleep-await-check.mjs`를 옮길 때 이 2셀의 판정을 나머지와 같게 둔다.

## Phase 2 — 세션·제출·편집·완성

### RD-010 — 세션 리셋, 종료 정책, 크래시 재시작 UI

상태: 완료 · 이전: RD-014, RD-009(재시작), RD-008(Chip) · 설계: `08-session.md`, `00-architecture.md` 3.4·4.3

시나리오: `세션 리셋` 버튼 → 변수·import가 사라지고 화면 스크롤은 유지, 안내 줄(청록) 뒤 새 배너. `exit()` 뒤 Alert가 뜨고 리셋으로 복구. worker가 죽으면(강제 `throw`) 재시작 버튼이 뜬다. Ctrl+L은 화면만 지우고 Python 상태는 그대로다. 리셋 직전 눌린 Ctrl+C가 새 세션의 시작 코드를 죽이지 않는다.

완료 기준: 위 시나리오(브라우저). 리셋 순서(들여쓰기 단위 초기화 → 송신기 취소 → `SIGNAL=0` → terminate → 새 worker·새 메일박스·새 sink 세트)가 시험으로 고정된다. StrictMode 이중 마운트에서 경고·중복 worker가 없다. `dispose()`가 두 번 불려도 안전하다.

선행(DELTA-00, 동작 불변, RD-018에서 앞당김): Playwright를 `apps/demo` devDependency로 추가하고(`pnpm exec playwright install chromium`) RD-009 `verify/lib.mjs`를 `apps/demo/e2e/lib.mjs`로 옮긴다 — 외부 경로(`/work/scratch/paper-ts/node_modules/playwright`) import 제거, `sleep-await-check.mjs`의 페이지 내부 시계 도우미(keydown 리스너 + `MutationObserver`, TRP-022)를 `lib.mjs`로 승격. 이 RD부터 브라우저 확인 스크립트는 `_works/<작업>/verify/`에 두되 `lib.mjs`는 `apps/demo/e2e/`에서 import한다(복사하지 않는다). 루트 4종 통과. 스크립트·기준 데이터의 저장소 이관과 기준선 통합은 RD-018 그대로다.

인계(RD-005): `exit()`(`terminated`) 뒤 worker는 살아 있고 터미널·입력은 무응답이다. 복구는 이 RD의 리셋과 Alert다(데모의 `Python session terminated.` 한 줄을 Alert로 교체). `createRepl`의 `liveTerminal` 뷰가 쓰는 `disposed`는 핸들 단위이므로 리셋이 핸들을 유지한 채 세션만 바꾸면 세션 단위 해제 신호가 필요하다(이전 세션의 `rewindTail` flush 콜백이 새 세션 읽기에 끼어들 수 있다). 건너뛴 이전 시나리오: RD-006b의 AC1·J2(세션 리셋 뒤 꼬리·`input()` 취소).

인계(RD-006): 세션 리셋 뒤 프롬프트가 이전 꼬리를 물려받지 않는 성질은 `stdin-reader.test.ts`의 "새 sink 세트는 빈 프롬프트로 시작한다"(단위)까지만 본다. 브라우저 확인은 RD-006b의 J1·J2·J3(J1·J2는 취소도 필요해 RD-008 뒤)·AC1이다. 리셋은 세션마다 `createStdinMailbox`·sink 세트·`createInputReader`·`createReadGuard`를 새로 만들어야 옛 세션의 stdin 읽기·가드 추적이 새 세션에 끼어들지 않는다. `readInput` 핸들러의 `disposed`는 핸들 단위라 리셋이 핸들을 유지하면 옛 worker가 죽었다는 세션 단위 신호가 필요하다(죽은 worker에 대한 `mailbox.fail()`의 `untilIdle`은 영영 안 풀린다).

인계(RD-008): 취소가 들어왔으니 세션 리셋 뒤 취소 4건(RD-012b J1·J2, RD-012c J1·J2)을 이 RD가 브라우저로 본다 — 스크립트는 `prompt-cancel-check.mjs`·`input-cancel-check.mjs`에 확인을 추가하면 된다(`skipped-ids.md` 3절). **게이트 항 `cancelSettling`을 리셋에서 `false`로 초기화해야 한다**: 옛 세션의 취소 응답으로 참이 된 값이 남으면 새 세션의 첫 Ctrl+C가 에코도 전송도 되지 않는다. `alive`·`readLinePending`·`inputReadsPending`과 같은 자리에서 초기화한다. 새 리더·가드에도 `cancelable` 전달을 유지한다(`read(prompt, cancelable)`·`read(cancelable)`).

결과: 브라우저(dev) 25/25 PASS — `reset`(안내 줄·배너·프롬프트 순서, 안내 줄 청록, 스크롤 유지, 변수·import
소실) · `cursor`(TRP-006 두 분기 중 `cursorX!==0`만 브라우저로 확인, `cursorX===0`은 `index.test.ts` 단위
시험 전용 — 아래 "멈추는 지점 해소" 참고) · `ctrll` · `carry`(이월 6건: RD-012b J1·J2, RD-012c J1·J2,
RD-006b J3·AC1) · `ccreset`(리셋 직전 Ctrl+C 경합 N=10) · `exit`(종료 뒤 완전 무응답 — 계획의 "에코만"은
실측으로 정정, 에코도 없다) · `crash`(강제 유발·재시작 복구) · `strict`(worker 1개, `.xterm` 1개, 콘솔 경고
0). preview(빌드 산출물) `reset`·`exit`·`crash` 3/3 PASS. `pageerror` 총계는 `crash` 절이 유발한 `forced`
1건만(그 밖 0). 양성 대조 2건(안내 문구 변조 → `reset` 실패, `restart`가 `reset()`을 안 부르게 변조 →
`crash` 실패) 확인 뒤 원복. 루트 4종 통과. 확인 스크립트는
`_works/_completed/20260922-11-rd-010-session-reset/verify/session-reset-check.mjs`(`apps/demo/e2e/lib.mjs`
import, `ONLY=<절,…>`로 8절 분리 실행)이고 이월 6건 표기는 RD-006·007·008 `skipped-ids.md`에 "RD-010
복원"으로 남겼다(`_works/`라 커밋 대상 아님, 파일은 그대로 남아 있다).

멈추는 지점 해소: 계획 17(강제 크래시)은 `pyodide.code.run_js("setTimeout(() => { throw new Error('forced')
}, 0)")`가 실측대로 worker `error` 이벤트를 냈다 — 대안이 필요 없었다. `reset-cursor`의 `cursorX===0` 분기
(개행 직후 아무것도 안 그린 채 리셋)는 idle 프롬프트가 항상 `>>> `까지 그려진 뒤에야 관찰 가능해(그 시점
cursorX=4) 실사용 경로로는 재현되지 않았다(Enter와 리셋 클릭을 경합시켜도 4회 전부 프롬프트가 먼저 그려짐)
— `index.test.ts`의 단위 시험(`cursorX`를 직접 0으로 둠)으로만 고정하고 브라우저 확인에서는 뺐다(checklist
완료 조건을 약화하지 않는다 — 원래 "커서 행 처리 브라우저 확인"이 요구하는 건 TRP-006의 두 분기를 실제
관찰 가능한 만큼 보는 것이었고, 관찰 불가능한 분기는 단위 시험이 대신 고정한다).

함정 2건 발견·승격: `docs/traps/TRP-023`(하니스 알림 이름 목록에 새 ntf를 안 넣으면 조용히 버려진다, DELTA-04)
· `docs/traps/TRP-024`(안내 줄 개수로 "다시 준비됐다"를 판정하면 여러 번 반복한 뒤 무한 대기한다 — xterm
뷰포트 밖으로 스크롤된 행이 DOM에서 사라지기 때문, DELTA-06). `session-reset-check.mjs`의 `resetAndWait()`는
그래서 화면 행이 아니라 `data-testid=status`의 상태 전이로 판정한다.

인계(RD-012): `reset({ topLevelAwait? })` 옵션과 프레임 연동은 이 RD가 넣는다(RD-010 범위 제외). `reset()`은
지금 무인자(`reset(): void`)다 — 옵션을 추가하면 `00-architecture.md` 4.1의 시그니처 주석과
`session-reset-check.mjs`의 `resetAndWait()` 호출부(옵션 없이 부르는 곳들)를 함께 확인한다.

RD-013 완료 반영: 자동 들여쓰기 단위(`lastUsedIndentation`)는 핸들이 아니라 **세션 소유**
(`session.ts`의 `startSession()` 안에서 만드는 `createAutoIndent(readline)`)가 됐다 — 리셋 순서에 별도
초기화 단계를 끼워 넣지 않아도 새 세션이 새 객체(4칸)를 만든다(`08-session.md` 8.1).

인계(RD-018): 확인 스크립트는
`_works/_completed/20260922-11-rd-010-session-reset/verify/session-reset-check.mjs`(+
`positive-controls.md`, `results/dev-and-preview.log`)에 있다. `apps/demo/e2e/lib.mjs`는 이 RD의 DELTA-00이
이미 저장소로 옮겨 둬 추가 이관이 필요 없다 — RD-018은 스크립트 파일 자체의 이동(`_works/_completed/*` →
`apps/demo/e2e/`)과 `pnpm --filter demo e2e:*` 스크립트만 남았다. RD-006·007·008 `skipped-ids.md`의 이월
6건 행에 "RD-010 복원" 표기를 남겨 뒀다 — 74개 복원 표를 만들 때 그대로 반영한다.

### RD-011 — 여러 줄 입력 제출(붙여넣기·Shift+Enter·히스토리 재호출)

상태: 완료 · 이전: RD-017 · 설계: `02-console-core.md` 5.2·5.3

시나리오: `def add(a, b):\n    return a + b\n\nprint(add(1, 2))`를 붙여넣고 Enter 한 번 → `3`, SyntaxError 없음. 클래스 메서드 사이 빈 줄이 블록을 끊지 않는다. 붙여넣은 탭이 보존된다. `1\n2\n3` → `3`만 에코. 파싱 오류가 있으면 아무 문장도 실행하지 않는다.

완료 기준: 위 시나리오 + `split_paste` 코퍼스 27개 전부 일치(node + 실제 pyodide). 블록 입력 중(`... `) 붙여넣기는 한 줄씩 흘려 넣는다. 예외·`exit()` 뒤 나머지 문장 미실행. 한 줄 입력·빈 줄·`input()` 기존 동작 유지. 붙여넣은 탭 보존은 벤더 `packages/xterm-readline`의 `readPaste` 소스에서 고친다(`06-editing.md` 6.1·6.2 TRP-006 — 현재 벤더 원본은 Text가 아닌 입력을 `readKey`로 넘겨 `\t`를 버린다). 코어에서 `readPaste`를 감싸지 않는다. 벤더 시험에 붙여넣기 `\t` 보존 케이스를 추가한다(RED 확인).

결과: 벤더 `readPaste`(`packages/xterm-readline`)에 `UnsupportedControlChar`+단일 `\t` 토큰만 `Text`로 승격하는
분기를 추가(`readline.test.ts` 94건, 탭 보존 시험 RED→GREEN 확인). worker에 `split_paste(source, flags)`
(`multiline.py?raw` + `multiline.ts`)를 추가했다 — `ast.parse`(TLA 켜짐이면 `compile(...,
PyCF_ONLY_AST)`)로 top-level 문장 경계를 구하고 얻은 AST를 2차 `compile(tree, ..., flags)`에 다시 넣어 함수
밖 `return` 같은 컴파일 단계 오류도 잡는다(`multiline.test.ts` 24건). `ReplConsole.compilerFlags()`가
`split_paste`에 넘길 플래그를 준다. 러너(`submission-runner.ts`)에 `null`(취소) → `pending()`(줄 흘림) →
`/[\r\n]/`(분할) → 한 줄 분기를 추가하고, `await_fut(fut, echo)`로 마지막 청크의 마지막 문장에서만 값 에코·
`builtins._` 갱신이 나오게 했다(`submission-runner.test.ts` 69건, 코퍼스 27개 node+실제 pyodide 차등 검증
포함). `apps/demo/e2e/lib.mjs`에 `paste(text)`를 추가했다(headless Chromium은 `Control+V`·
`page.keyboard.insertText()` 모두 여러 줄 붙여넣기에 쓸 수 없어 합성 `ClipboardEvent("paste")` dispatch로
대체, 실측). 브라우저 확인(`multiline-check.mjs`) dev 8절(18개 확인) + preview 3절 전부 PASS, 총
`pageerror` 0, 변이 4건 전부 killed. 루트 4종(`pnpm check-types`·`lint`·`test`·`build`) 통과.

인계(RD-005): RD-005의 러너(`submission-runner.run`)에는 개행 분기가 없었다. 이 RD가 `/[\r\n]/` 분기·
`replayLines`·`multiline.py`·`.py?raw` 관례를 추가했다. 건너뛴 이전 시나리오: RD-011a의 S03·S07(붙여넣기
분할) — 둘 다 브라우저 `paste`·`parse` 절에서 확인했다.

RD-013 완료 반영: `shift` 절(Shift+Enter로 블록 진행)은 프리필이 아직 없던 채로 들여쓰기를 직접 쳐서
확인했었다(`for i in range(2):` Shift+Enter `    print(i)` Enter 1회 → `0`·`1`). RD-013이 프리필을 넣은 뒤
이 절의 복사본을 `_works/…-rd-013-…/verify/auto-indent-check.mjs`의 `multiline-shift` 절로 되돌렸다(들여쓰기
직접 입력 제거, `print(i)`만 입력 → 프리필이 채운다). 완료된 `multiline-check.mjs` 원본 파일은 고치지 않았다
(rubber-workflow: 완료 폴더는 읽기 전용 참고).

인계(RD-014) 정정(2026-09-23, RD-014 그릴링에서 확인): 이 항목의 원래 전제("붙여넣은 여러 줄이 history에
항목 여러 개로 남는다")는 틀렸다 — `... `에 붙여넣은 여러 줄은 항목 여러 개가 아니라 **한 항목**이다.
`readPaste`가 Enter 토큰을 `"\n"` 텍스트로 바꿔 버퍼만 채우고(`readline.ts:413-414`) 사용자의 Enter 1회가
`history.append`를 한 번만 부르기 때문이다(`:470`). `replayLines`는 worker에서 돌며 history를 건드리지
않는다. RD-014가 `createBlockHistory`로 이 한 항목을 블록 전체에 이었다(`06-editing.md` 6.4).

인계(RD-018): 확인 스크립트(`lib.mjs`의 `paste(text)` 포함)·변이 기록은
`_works/_completed/20260923-12-rd-011-multiline-submit/verify/`(`multiline-check.mjs`·`mutate-safe.mjs`·
`positive-controls.md`)에 있다. `paste()`는 RD-010이 이미 저장소로 옮긴 `apps/demo/e2e/lib.mjs`에 이 RD가
추가한 것이라 별도 이관이 필요 없다.

### RD-012 — top-level await 옵션(기본 꺼짐)

상태: 완료 · 이전: RD-018 · 설계: `02-console-core.md` 5.4

시나리오: 기본 상태에서 `await asyncio.sleep(1)`은 `SyntaxError: 'await' outside function`. 스위치를 켜면 세션이 리셋되고 바로 실행된다. 새로고침하면 꺼짐.

완료 기준: 위 시나리오. `setTopLevelAwait`가 TLA 비트만 토글하고(`0x6200` 확인) 콘솔 생성 직후 한 번만 적용된다(node + 실제 pyodide) — (RD-004에서 완료: `worker/top-level-await.ts`가 초기화 프레임의 `topLevelAwait`를 적용한다). `createRepl`의 `topLevelAwait` 옵션, 데모 스위치, 리셋 시 새 프레임에 값을 싣는 연동. 꺼짐/켜짐 모두 `asyncio.run(main())` 동작. 한 줄/블록/`input()`/Ctrl+C 기존 동작 유지.

결과: `ReplOptions.topLevelAwait?`·`reset(options?: { topLevelAwait? })`(sticky, boolean 명시 때만 바꿈) + `index.test.ts` 6건(①③④ 구현 전 RED 확인) + `top-level-await.test.ts`의 `asyncio.run(main())` 꺼짐/켜짐 node 시험 2건. 데모에 `<label><input type="checkbox" data-testid="top-level-await" />top-level await</label>` 추가, 변경 시 양방향 즉시 `reset({ topLevelAwait })`. 브라우저 절 5개(`tla-check.mjs` `scenario`·`smoke`·`arun`·`toggle-off`·`sticky`, `not-isolated`는 비격리 서버 구성 비용 대비 이 RD 범위에 비해 커서 생략) dev 16/16 + preview(`scenario`만) 4/4, 총 `pageerror` 0(`sticky` 절의 의도적 `forced` 1건은 별도 판정). 양성 대조 2건. 루트 4종 통과.

브라우저 TLA 셀(RD-007·RD-009가 node 시험으로 대체하고 이 RD에 넘긴 것. node 결과와 브라우저 결과를 병기한다): `sleep-await-check.mjs`(RD-009 사본)에 `tla: true` 셀 4개를 더해 각 N=20 전부 통과, 총 `pageerror` 0.

| 셀 | 프로그램(TLA 켜짐) | 판정 형식 | node(RD-009 대체) | 브라우저(RD-012, N=20) |
| --- | --- | --- | --- | --- |
| `await5` | `await asyncio.sleep(5)` | `line`: 트레이스백 0 + `KeyboardInterrupt` 한 줄(콘솔 task 취소, `10-parity-deviations.md` 1절 끝 "편차 아님" 문단) | `sigint-handler-idle.test.ts` TLA 4건 중 1건 | 20/20, 중앙값 27.28ms |
| `awaitloop` | `while True: await asyncio.sleep(0.1)` | `either`: `line` 규칙 또는 `tb1` 규칙 중 하나(가지 비율은 판정 안 함, 기록만) | 〃 | 20/20(전부 `line` 가지), 중앙값 25.03ms |
| `tla-sleep-0.1` | `while True: time.sleep(0.1)` | `tb1`: 트레이스백 1개 + 우리 프레임 0 | 〃 | 20/20, 중앙값 24.58ms |
| `tla-burst` | `while True: pass` 0ms 30회 연타 | `burst`(`sleep-await-check.mjs` 판정): 트레이스백 정확히 1개 + `print('ok')` 복귀(`pageerror` 0) — RD-007 `burst-matrix.mjs`의 프롬프트 복귀 판정(`CRASH>HANG>DIRTY>OK`)보다 엄격하다 | (해당 없음, 브라우저 전용 신규 셀) | 20/20, 중앙값 57.88ms(허용 편차 — 30회 연타라 RD-009 `sleep-burst`의 5회 연타 30.23ms보다 "첫 눌림 기준" 측정 구간이 길다, 사용자 확인) |

`sleep-await-check.mjs`에는 `tb1`·`catch3`·`burst` 판정만 있었으므로 이 RD가 `line`·`either`를 추가했다. 코루틴 안 동기 `time.sleep`(편차 28)은 이 셀들과 무관하다(RD-009a).

인계(RD-018): 확인 스크립트는 `_works/_completed/20260923-13-rd-012-top-level-await/verify/`에 있다 — `tla-check.mjs`(`scenario`·`smoke`·`arun`·`toggle-off`·`sticky` 절, `not-isolated`는 생략), `sleep-await-check.mjs`(RD-009 사본 + TLA 셀 4개), `results/`(`tla-dev.json`·`sleep-await-dev.json`), `positive-controls.md`(2건). `apps/demo/e2e/lib.mjs`의 `waitStatus`·`setTopLevelAwait`는 이미 저장소에 있어 추가 이관이 필요 없다.

### RD-013 — 자동 들여쓰기

상태: 완료 · 이전: RD-019 · 설계: `06-editing.md` 6.3

시나리오: `for i in range(2):` Enter → `... ` 다음 줄에 4칸. `    print(i)` Enter 뒤에도 4칸 유지. 공백뿐인 줄 Enter로 블록 종료. Backspace가 단위 배수까지 지운다. 2칸으로 쓴 블록 뒤 새 블록은 2칸, 세션 리셋 뒤 4칸.

완료 기준: 위 규칙 전부 + Shift+Enter/Alt+Enter 프리필, 일반 Enter·붙여넣기·`input()`에는 프리필 없음, 채워진 공백뿐인 줄은 history에 없음, 본문 없이 Enter 반복 시 블록이 끝나지 않음. `auto-indent.ts`가 pyodide에 든 `_pyrepl.readline` 함수와 차분 검증된다(`auto-indent-parity`).

결과: 벤더 `packages/xterm-readline`에 `ReadOptions.prefill?: string`(`read()`의 write 콜백 안, `new State`
직후 1회 채움 — 초안이던 `onInputReady`/`ready` Promise 대신 옵션으로 계약을 명시했다, TRP-008 재현 시험
RED→GREEN)과 `ReadOptions.onKey?: (input: Input) => boolean`(범용 키 훅, Backspace·Shift/Alt+Enter가 쓰고
Tab은 RD-015가 그대로 쓴다), `ReadlineOptions.skipBlankHistory`, `Readline.getCursor()`·`editInsert()`·
`editBackspace()`, `Input` 타입 export를 추가했다(`readline.test.ts`·`prefill.test.ts`·`on-key.test.ts`).
코어는 `terminal/auto-indent.ts`에 순수 함수(`nextIndentation`·`backspaceCount`·`indentUnitWidth`,
이전 구현 이식) + `createAutoIndent(readline)`(세션 소유 정책 객체, `readOptions(pending)`)을 두고,
`repl-reader.ts`·`read-guard.ts`·`session.ts`가 `pending`을 그대로 통과시킨다. `session.ts`의
`startSession()`이 세션마다 `createAutoIndent`를 새로 만들어 리셋 시 별도 초기화 없이 4칸으로 돌아간다.
검증: parity 29/29(pyodide `_pyrepl.readline` 오라클), 벤더+코어 단위 시험(RED→GREEN 다수) + 변이 검사
2세트(DELTA-02용 3건, DELTA-04용 7건, 모두 killed), 브라우저 `auto-indent-check.mjs` dev 26/26 + preview
9/9(`pageerror` 0), 양성 대조 2건(`readOptions`의 `prefill` 제거 → `prefill`·`unit` 실패, `onKey` 제거 →
`backspace`·`shift`·`alt`·`cancel` 대부분 실패). 루트 4종 통과.

인계(RD-008 이월 복원): RD-012b G1(2칸 블록을 취소해도 다음 블록 프리필이 2칸)·C1(본문을 `    print(2)`로
직접 쳐야 했던 것을 프리필 위 `print(2)`로)·D1·D2·D3(Shift+Enter 둘째 행이 `print(3)`였던 것을
`    print(3)`으로) 5건을 `auto-indent-check.mjs`의 `cancel` 절로 복원했다. `_works/_completed/…-rd-008-…/
verify/skipped-ids.md`에 "RD-013 복원" 표기를 남겼다.

인계(RD-014): `ReadlineOptions.skipBlankHistory`는 벤더 옵션(Enter 분기에서 처리)이고 블록 묶기
(`createBlockHistory`)는 이 옵션이 이미 거른 뒤의 `history.append` 호출 위에 겹쳐 쌓았다(계획대로).
프리필된 `... ` 줄의 ↑는 RD-014가 삼킨다(RD-014 절의 "RD-013 체크리스트 정정" 참고).

인계(RD-015): 키 훅(`ReadOptions.onKey`)은 이 RD가 범용으로 이미 벤더 소스에 추가했다 — RD-015는 새 훅을
만들 필요 없이 `readOptions`에 Tab 처리 분기를 합쳐 쓰고 `getLine`·`getCursor`·`editInsert`로 버퍼·커서를
다룬다(`07-tab-completion.md` 7.1 갱신 완료).

후속 후보 등록(범위 밖): 3.14 `backspace_dedent` 정확 이식(이전 줄들의 더 얕은 들여쓰기 수준까지 — 지금은
단위 배수로 단순화, 편차 12 유지). `pending` + 현재 버퍼로 원리적으로 가능해 보이나 이번 RD 범위 밖.

### RD-014 — 블록 입력을 history 항목 하나로

상태: 완료 · 이전: RD-020 · 설계: `06-editing.md` 6.4

시나리오: `for i in range(2):` / `    print(i)` / 빈 줄로 끝낸 뒤 ↑ → 블록 전체가 돌아오고 Enter 한 번으로 재실행. Ctrl+C로 취소한 블록은 history에 남지 않는다.

완료 기준: 위 시나리오 + 괄호 안 빈 줄 보존, 문법 오류·예외·`exit()`로 끝난 블록도 전체가 남음, 공백만 있는 제출 제외, `... ` 입력줄의 ↑ 무동작.

결과: 그릴링 확정(2026-09-23) = 벤더 API는 범용 원시 연산 3종만 추가(`Readline.getHistory()`·
`History.restore(entries)`·`ReadOptions.historyEntry`, 삭제 API는 추가하지 않음 — REPL 의미는 벤더에
넣지 않는다). 코어는 **세션 소유** `createBlockHistory(readline)`(`terminal/block-history.ts`, 노출은
`readOptions(pending)`·`discard()` 둘)와 순수 함수 `mergeReadOptions`(`terminal/read-options.ts`)로
`createReplReader`가 모듈 종류를 모르게 했다. ↑ 삼킴은 공개 API만으로(`pending` 있고 `getLine()`에 `\n`
없음) 판정하고 벤더 private `state.editing`과의 동치는 문서로만 근거를 남겼다. `discard()`는 취소
(`readLine`의 `line === null`)와 리셋(`terminate()`의 `reading` 가드) 두 지점에서 부른다.

검증(dev 29/29 · preview 11/11 · pageerror 0): 브라우저 `verify/block-history-check.mjs`(이전 RD-020
A0~J1 25개 + RD-006b X2·X3 + 붙여넣기 2건) 전부 PASS. 단위 `block-history.test.ts` 18×2=36건(RED 3건
확인 후 GREEN, `mutations-delta03.json` 8/8 killed), `session.ts` 배선 `index.test.ts` 4건
(`mutations-delta04.json` 4/4 killed), 벤더 `history-entry.test.ts` 5건(`mutations-delta01.json` 4/4
killed), `read-options.test.ts`(`mergeReadOptions`) 5건. 양성 대조 3종: 기준점 복원 제거 → A2 실패(B2는
`discard()`의 독립 복원 때문에 계획과 달리 안 죽음), `trimEnd` 제거 → 브라우저 스크린 하니스가 trailing
whitespace를 구조적으로 못 봐 A1·I1 모두 안 죽음(단위 시험 M2가 이미 커버), ↑ 삼킴 제거 → C1·C2 실패. 총
`pageerror` 0. 루트 4종(`check-types`·`lint`·`test`·`build`) 통과.

붙여넣기 2건 중 P1(`... `에서 붙여넣은 여러 줄이 블록 항목에 이어진다)은 실측 PASS. P2("`>>> `에서 블록을
연 채 끝나는 붙여넣기 뒤 `... ` 줄이 같은 항목에 이어진다")는 **완료 조건에서 재현 실패가 아니라 구조적으로
불가능함이 증명됐다**(DELTA-04a, 사용자 결정 2026-09-23: 원인 정정 문서화만) — `worker/submission-runner.ts`의
`runMultiline`/`runChunk` 반환 경로 3곳 전부 `pending`을 절대 반환하지 않아, 개행이 포함된 단일 제출이
`... `로 이어지는 경로 자체가 이 시스템에 없다(Python 버전과 무관). `block-history-check.mjs`의 `P P2`는
실측(붙여넣기는 여전히 한 항목으로 기록되되 즉시 완결된다)을 확인하도록 고쳤다. `06-editing.md` 6.4·
`10-parity-deviations.md`에 이 원인을 기록했다(DELTA-06).

벤더링 `History` 삭제/복원 API 결정: `restore(entries)`만 추가했다(스냅샷 복원). 별도 삭제 API
(`replaceFrom`/`truncate`)는 코어가 쓸 일이 없어 추가하지 않았다.

인계(RD-005): 건너뛴 이전 시나리오는 RD-006b의 X2·X3(블록 history 재호출 뒤 `012>>> ` 프롬프트 유지)였다 — 이 RD가 브라우저로 복원했다(`skipped-ids.md:69` "RD-014 복원" 표기).

RD-013 완료 반영: `createReadGuard`의 `readLine`은 이제 `(prompt, pending, cancelable)`을 받는다
(`ReadGuardDeps.readLine`·`createRepl`의 `readLine` 핸들러·조립을 RD-013이 넓혔다, REPL 읽기는 가드가
즉시 부르므로 시작 타이밍은 그대로다). 이 RD는 시그니처를 다시 바꾸지 않고 그 `pending`을 블록 묶기에
썼다.

인계(RD-008): 블록 history의 `discard()`를 건 지점은 main `readLine` continuation의 `line === null`(취소)이다 — worker 쪽에서 `run(null)`이 `clearPending()`하는 것과 짝이다. RD-008이 RD-012c H2(취소 뒤에도 제출한 블록 줄이 ↑로 돌아온다)와 RD-012b H1(취소한 입력 줄은 ↑ 30회 동안 없다)을 이미 브라우저로 통과시켰고, 이 RD는 블록을 항목 하나로 묶은 뒤의 동작(RD-006b X2·X3 포함)을 확인했다.

인계(RD-015): `mergeReadOptions(blockHistory.readOptions(pending), autoIndent.readOptions(pending))`
합성 자리에 Tab 리더 분기를 그대로 끼운다 — `mergeReadOptions(blockHistory, autoIndent, tab)`. 새 훅을
만들 필요 없음(`onKey` 규칙은 앞에서부터 먼저 소비한 쪽이 이긴다).

인계(RD-018): 확인 스크립트·결과는 `_works/_completed/20260923-15-rd-014-block-history/verify/`의
`block-history-check.mjs`(29개)·`positive-controls.md`(3건)·`results/dev.json`·`results/preview.json`에
있다.

RD-013 체크리스트 정정: RD-013 완료 폴더(`_works/_completed/20260923-14-rd-013-auto-indent/checklist.md`
21·55행)의 "프리필 뒤 ↑는 history 항목으로 교체"는 **실측과 다르다**(무동작이다, 편차 14와 같음) —
`previousHistory`는 `cursor === -1 && line.length() > 0`이면 즉시 반환해(`state.ts:254`) 프리필이 있는
줄의 ↑는 애초에 무동작이다. ↑ 탐색이 열리는 것은 프리필이 **없는** `... ` 줄(들여쓰기 0으로 돌아온 줄,
Ctrl+U로 지운 줄)뿐이고, RD-014의 ↑ 삼킴은 이 경로만 다룬다. 완료된 RD-013 폴더의 체크리스트 문구
자체는 읽기 전용이라 고치지 않는다.

### RD-015 — Tab 완성(이름·속성), 완성 중 Ctrl+C, Tab 큐

상태: 완료 · 이전: RD-016, RD-016c, RD-016f · 설계: `07-tab-completion.md` 7.1~7.4

시나리오: `a.` 뒤 Tab → 후보 하나면 삽입, 여럿이면 공통 접두사. 같은 자리 두 번째 Tab → 열 우선 목록(셀 폭 = 최장 + 2, 200개 상한). 빈 스템은 `4 - (열 % 4)`칸 공백을 왕복 없이. `important = ` 뒤 Tab 8연타(0ms) → 32칸. `__getattr__`가 무한 루프인 객체에서 `a.x` Tab 뒤 Ctrl+C → 세션 리셋 없이 `>>> `.

완료 기준(전부 충족, 실측 — `_works/_completed/20260923-16-rd-015-tab-completion/`의 DELTA-01~05):
- 이전 RD-016 브라우저 58개(C1~C12)가 3.14 pty 목록 화면 행과 일치(`res_s10_0.json` `screen2`와 `a.`·
  `A.`·`x.__cl`·`print` 전부 행 단위 정확 일치, 열 폭 계산 버그·후보 집합 차이 관찰 안 됨) + **C13**(큐:
  `a.` Tab 2연타 0ms → 왕복 1회 뒤 목록 1번) + **C14**(완성 중 Ctrl+C, 아래) 전부 PASS —
  `verify/results/dev.json` **68/68, 실패 0**, `pageErrors` 0. preview(빌드 산출물) C1·C3·C8·C11 재실행
  30/30 PASS.
- 경합: Tab→Enter·Tab→Ctrl+C 각 20회 정지 0(C8), 왕복 중 입력이 바뀌면 완성 폐기(`tab-reader.ts`
  `applyResume`의 세대·`ended`·버퍼·커서 4중 검사).
- 큐: `important = ` Tab 8연타 0ms → 32칸(왕복 없음, C5e), `a.` Tab 2연타 0ms → 왕복 1회 뒤 목록(C13).
- **C14 완성 중 Ctrl+C**: `__getattr__` 무한 루프 객체에 `a.x.` Tab 뒤 Ctrl+C → 세션 리셋 없이
  `KeyboardInterrupt` + `>>> `. **사용자 코드가 REPL 프롬프트에 직접 입력된 경로(컴파일 파일명이
  `<console>`)에서만** 즉시 복귀한다(실측 25.4ms) — `exec()`/`eval()`로 정의된 코드(파일명이 `<console>`이
  아님)는 worker `sigint-handler.py`가 완성 평가 프레임을 사용자 코드로 인식하지 못해 복귀하지 않는 좁은
  경계 사례가 남는다(`10-parity-deviations.md`에 등록, 코드는 고치지 않았다 — RD-012 계열 기존 인프라
  영역). 단위: 취소 시 `interruptCompletion` 정확히 1회, Enter 종료·요청 없음·이미 끝남은 0회
  (`tab-reader.test.ts`).
- `input()` 중 Tab 무동작·`\t` 없음(C9a·C9b, `stdin-reader.ts`에 `readOptions`가 없어 벤더가 무시) + 단위
  (`index.test.ts`: 가짜 `complete` 0회). `from os import pa` 무동작(C9c). (2026-09-24 정정: C9c는 Tab 직후 `!` 입력이 완성 왕복보다 먼저 도착해 통과한 것이다 — `rlcompleter`는 `pa`에 키워드 `pass`를 내며, `import os.pa`도 속성 후보 5개라 채워지지 않는다. RD-016이 C9c를 `path` 채우기로 재정의한다.)
- 세션 리셋 뒤 Tab 동작·삽입 1회(C11a), `exit()` 뒤 무동작(C11b), `exit()` 뒤 리셋 세션에서 동작(C11c).
- 지연(C12, 페이지 내부 시계 TRP-022, dev Chromium headless, 웜(세션 첫 Tab 제외) N=20): `a.` 속성 후보
  중앙값 **25.8ms**·최대 **33.5ms**, 빈 스템 공백 중앙값 **10.9ms**·최대 **17.0ms**. 정지 0, 둘 다 필수
  기준(200ms) 이내(참고 30ms 안쪽). `import os.pa`(지연 측정 3종째)는 RD-016 뒤로 미룸(미실행). (2026-09-24 갱신: RD-016이 C12에 기록 전용으로 추가, 중앙값 26.2ms·최대 33.4ms.)
- 코드포인트↔UTF-16: `x = "😀" ; a.at` Tab에서 Python `start`(코드포인트)와 JS `pos`(UTF-16) 변환이 맞아
  서로게이트 쌍이 잘리지 않는다(`tab-completion.test.ts` 61건 + `complete-source.test.ts`의 `start === 10`
  실측).
- 변이 검사: 벤더 훅(DELTA-01·01a) 큐 제거·`resetLayout()` 제거·`activeRead` 가드 제거 killed(단일 행
  버퍼 한정이던 "앵커 갱신 제거" 변이는 DELTA-01a가 다중 행 재그리기 버그를 근본 해소해 더 이상 관찰 대상이
  아니다), worker(DELTA-03) `except BaseException`·`atPrompt` 가드 제거·`warnings.simplefilter` 제거·
  `sorted()` 제거 4/4 killed, 코어(DELTA-04) 큐·세대·버퍼·커서·`ended`·취소 시 `send`·`lastKeyWasTab` 리셋·
  `tabReader` 합성 제거 7/7 killed, DELTA-04a `printAbove` 즉시 resolve·`terminate()`의 `readEnded(null)`
  제거 2/2 killed.
- 양성 대조 3건(서버 재시작 필수, `verify/positive-controls.md`): 큐(`queuedTabs.push`) 제거 → 브라우저
  C13 실패(계획과 일치). `readEnded` 배선 제거·`interruptCompletion` 무력화는 계획한 브라우저 시나리오
  (C8·C14) 대신 단위(`index.test.ts` "프롬프트 취소 중 완성 요청이 있으면 SIGINT를 1회 보낸다")로 확인
  (C8은 Playwright 타이밍상 재현 불가, C14는 사전 결함으로 변이 구분력 없음).
- 루트 4종(`pnpm check-types`·`pnpm lint`·`pnpm test`·`pnpm build`) 통과(시험: `xterm-readline` 16파일
  126개, `pyodide-repl` 40파일 909개, `demo` 1파일 3개 — 전부 통과, 회귀 0).

Tab 가로채기는 벤더 `readKey`(private)를 감싸지 않는다. **키 가로채기 공개 훅은 RD-013이 이미 벤더 소스에
추가했다**(`ReadOptions.onKey?: (input: Input) => boolean`, `Input`을 받아 소비했으면 `true`를 돌려준다,
`06-editing.md` 6.1·6.3) — `terminal/tab-reader.ts`의 `createTabReader(readline, { complete,
interruptCompletion })`(세션 소유 정책 객체, `session.ts`가 `blockHistory`·`autoIndent` 옆에서 만든다)가
그 훅과 `getLine`·`getCursor`·`editInsert`·`tty`·`printAbove`(벤더 공개 API, RD-013·RD-015)만 쓴다(새 훅을
만들 필요 없음). `07-tab-completion.md` 7.1은 이에 맞게 고쳤다.

인계(RD-006): "main이 `input()` 읽기 중 Tab을 요청하지 않는다"는 성질(메일박스 대기 중 worker는 `complete`에 답하지 못한다)은 `index.test.ts`의 "input() 읽기 중 Tab은 complete를 요청하지 않고 `\t`도 넣지 않는다" 시험이 고정한다. 프로토콜 쪽(메일박스 대기 중 보낸 `complete`는 `deliver` 전 응답 없음, 뒤 응답, 유실 없음)은 RD-006이 `protocol/thread-scenario.test.ts`에 넣었다. `input()` 안 Tab 무동작은 편차 17이다.

인계(RD-014): 실제 배선은 `mergeReadOptions(blockHistory.readOptions(pending), autoIndent.readOptions(pending), tabReader.readOptions(pending))` 3항 합성이다 — 새 훅 없이 `onKey`가 앞에서부터 먼저 소비한 쪽이 이기는 규칙 그대로 끼웠다.

인계(RD-016 — `import`/`from` 줄의 모듈 완성): `.py` 확장 지점은 `worker/complete-source.py`의
`complete_source(console, source, pending=None)` — `pending` 매개변수는 이미 받고 있으나 이 RD는 쓰지
않는다(RD-016이 `ZipStdlibModuleCompleter` 분기를 그 인자로 넣는다). `.ts` 확장 지점은
`worker/complete-source.ts`의 `loadCompleteSource`(시그니처 변경 없이 내부 분기만 넓히면 된다). main
게이트(`mentionsImportKeyword`) 삽입 자리는 `terminal/tab-completion.ts`의 `planTab` 앞(현재는 게이트
없이 스템 유무만 본다, `07-tab-completion.md` 7.5). `terminal/tab-reader.ts`의 `handleTab`이 이미
`deps.complete(plan.source, pendingBlock || undefined)`로 `pending`을 넘기고 있어 프로토콜 변경이 필요
없다. 지연 측정 3종째(`import os.pa`)는 이 RD가 미실행으로 남겼다(RD-016이 C12에 기록 전용으로 채움).

인계(RD-018): 확인 스크립트·pty 기준 데이터는 `_works/_completed/20260923-16-rd-015-tab-completion/verify/`의
`tab-check.mjs`(68개 절)·`pty/`(`res_s*.json` 복사, 3.14.4 기준)·`positive-controls.md`(3건)·
`results/dev.json`·`results/preview.json`에 있다.

### RD-016 — `import`/`from` 줄의 모듈 완성

상태: 완료 · 이전: RD-016a · 설계: `07-tab-completion.md` 7.5

시나리오: `import os.pa` Tab → `import os.path`. `import xml.dom.m` Tab → `xml.dom.mini`. `import ` Tab 두 번 → 모듈 목록. `from os import pa` → `path`. `import os; os.pa`는 속성 완성.

완료 기준(2026-09-24 그릴링 확정 — 이전 RD-016a 129/129·A 32개·코퍼스 53줄은 이력이며 합격 조건이 아니다, 검증은 L0 + L1, `docs/agents/rubber-workflow.md` "검증 실행 예산"):
- L0 정확성(node + 실제 pyodide): `complete_source` 결과를 3.14.4 pty 기준 A01~A36·X01~X04 전부와 대조(기대값은 케이스 ID와 함께 시험 리터럴로 옮김, 원본 JSON은 `apps/demo/e2e/pty/rd-016/`). 네이티브와 pyodide 모듈 집합이 갈리는 케이스(편차 18, `native_vs_pyodide.json`)는 후보 리터럴이 아니라 삽입 결과 구조로 판정(TRAP-27). A37은 3.14 quirk 단위 시험.
- 게이트 코퍼스 55줄(53 + 대소문자 변형 2): JS 게이트 `mentionsImportKeyword` 단위 시험 + "게이트 거짓인 줄은 `ModuleCompleter`가 `None`" 안전성 시험(node + 실제 pyodide, TRAP-33).
- zip stdlib 보정: 원본 `ModuleCompleter`가 `import collections.a`에 `[]`이고 보정 서브클래스가 `['collections.abc']`, 사설 이름(`_stdlib_path` str·`_is_stdlib_module`) 사전 조건 단정(TRAP-10). 호출마다 새 인스턴스(site-packages 가짜 패키지 `zz_fake_pkg`로 대리 시험). `_pyrepl` import 실패는 worker 부팅 실패. 모듈 분기도 `KeyboardInterrupt`를 삼키지 않는다.
- L1 배선(dev, `tab-check.mjs` C15 절, `waitFor`·마커 판정만 — `09-testing.md` 9.7): `import os.pa`→`os.path`, `from os import pa`→`path`(C9c 재정의), `import collections.a`→`abc`, `import xml.dom.m`→`mini`, `import ` Tab 두 번 목록(`os`·`sys` 포함, 개수 단정 없음), `if True:` 블록 `pending` 경로, `import os; os.pa` 속성 폴백. C5e(`important = ` 8연타 32칸)는 "게이트 참·왕복 + 큐" 셀로 제목 정정. C12 `import os.pa` 지연은 N=20 기록만(판정선 없음) — `baseline.json` `unrun` 제거, `BASELINE.md` 갱신.
- 200개 상한 브라우저 시험·실제 `loadPackage`·pty 재측정은 하지 않는다. 전체 `e2e:baseline`·preview는 사용자 지시 때만.
- 계획서: `_works/_completed/20260924-21-rd-016-module-completion/`.

결과(2026-09-24, L0 + L1, `docs/agents/rubber-workflow.md` "검증 실행 예산"): worker `worker/complete-source.py`에
`ZipStdlibModuleCompleter`(`_is_stdlib_module`만 오버라이드) 모듈 분기, main `terminal/tab-completion.ts`에
`mentionsImportKeyword`(`/import|from/`, 부분 문자열)와 `planTab(buf, pos, pending?)`, `terminal/tab-reader.ts`가 `pending`을 전달한다(RPC 변경 없음).
- L0: 3.14.4 pty 대조 `worker/module-completion-parity.test.ts` **40/40**(A01~A36·X01~X04, 편차 18 케이스 A11·A12 두 번째 Tab 목록만 구조 판정),
  A37·편차 23 quirk 단위 통과. 게이트 코퍼스 `terminal/import-gate.test.ts` **61/61**(55줄 + 대소문자 변형 확인) + `complete-source.test.ts` 133건(게이트 안전성 "거짓 ⇒ `None`",
  zip 보정 사전 조건, 새 인스턴스 `zz_fake_pkg`, 정렬 없음, `KeyboardInterrupt` 통과, `_pyrepl` import 실패 시 `loadCompleteSource` 실패) 통과.
  `tab-completion.test.ts` 71·`tab-reader.test.ts` 33 통과. 변이 검사 worker 10건·main 6건 전부 killed(게이트 상시 거짓·상시 참·`\b` 게이트·zip 보정 제거·인스턴스 캐시·
  모듈 후보 정렬·공백 분기 제거·`pending` 미결합·`tab-reader` `pending` 미전달 포함).
  루트 `pnpm check-types`·`lint`·`test`(pyodide-repl 43파일 1185건·xterm-readline 130건·demo 3건)·`build` `--force`(turbo 캐시 없이) 통과.
- L1(dev, `tab-check.mjs`): `ONLY=C5,C9,C12,C15` **20/20**, 총 `pageerror` 0. C15 절 6종 8개 확인(C15a `import os.pa`→`os.path`, C15b `import collections.a`→`abc`,
  C15c `import xml.dom.m`→`mini`, C15d `import ` Tab 두 번 목록, C15e `if True:` 블록 `pending` 경로, C15f `import os; os.pa` 속성 폴백), C9c를 `from os import pa`→`path` 채움으로
  재정의, C5e 제목 정정. 양성 대조 1건: 게이트 상시 거짓 → C15d 2개 실패, 원복 뒤 20/20. C12 `import os.pa` 지연(웜 N=20, 기록 전용): 중앙값 26.2ms·최대 33.4ms
  (같은 실행 `a.` 중앙값 28.7ms·최대 34.0ms). `baseline.json`의 `unrun`은 빈 배열, `BASELINE.md` 2절 `tab-check` 행 갱신.
- **미실행(예외)**: 전체 `e2e:baseline`(L2)·`e2e:measure`·preview는 사용자 지시가 없어 돌리지 않았다. `tab-check.mjs` 76개 중 실측은 20개이고 나머지 56개(C1~C4·C6~C8·C10·C11·C13·C14)는
  이 RD 뒤 재실행하지 않았다(C15는 전역을 바꾸지 않아 세션 상태 영향은 예상하지 않으나 확인은 아님). 3.14.4 pty 재측정도 하지 않았다(기준 데이터는 3.14.4 원본 복사, 번들은 3.14.2, 편차 19).
- 허용 편차: 18(모듈 집합 192 대 178)·19·20(미로드 패키지 후보 없음)·21(열 폭 근사)·23(`import os.pa  # c` → `# cs.path`). 새 편차 등록 0(목록 쪽 넘김 없음은 편차 16·18). 편차 건수 44 유지.
- 실측으로 확인한 사실: `Console({}).completer_word_break_characters`는 `STEM_DELIMITERS` 33자와 같은 문자열이다. 게이트 참·빈 스템 줄은 이제 worker 왕복을 만들어 Tab 연타 뒤 바로 입력하면
  남은 큐 Tab이 그 문자를 스템으로 재생한다(`07-tab-completion.md` 7.1 큐 규칙과 일치, 제품 결함 아님). 모듈 목록은 178개라 한 화면을 넘는다.

기준선(RD-018) 반영: 확인 스크립트는 이미 `apps/demo/e2e/checks/tab-check.mjs`(C1~C15 76개), pty 기준 데이터는 `apps/demo/e2e/pty/rd-016/`에 있고 `BASELINE.md`·`baseline.json`이 갱신됐다.
전체 `e2e:baseline` 재확인은 사용자가 L2를 지시할 때 한다. 양성 대조 수행 기록은 작업 폴더(`_works/`)에만 있고 `apps/demo/e2e/positive-controls/`에는 이관하지 않았다.

### RD-017 — 선택 영역 복사(선택 시 자동 복사, 선택 중 Ctrl+C는 복사)

상태: 완료 · 이전: RD-013 · 설계: `06-editing.md` 6.6

시나리오: 출력 텍스트를 마우스로 드래그해 놓으면(버튼을 뗀 순간) 클립보드에 그대로 들어가고 화면 우측 하단에 작은 글씨로 `copied 20 chars to clipboard`가 1초 표시된다. 선택이 있는 채 Ctrl+C → 복사만 하고 선택을 지운다 — 실행 중(`while True: pass`)이면 인터럽트하지 않고, `>>> `·`... `·`input()` 읽기 중이면 취소하지 않으며 `^C`도 찍지 않는다. 같은 자리 두 번째 Ctrl+C(선택 없음)는 기존 동작(RD-007 인터럽트·RD-008 취소) 그대로다. Ctrl+Shift+C도 선택이 있으면 같은 복사다. 데모의 "선택 시 자동 복사" 체크박스(기본 켜짐, localStorage 저장)를 끄면 드래그해도 복사되지 않고 Ctrl+C 복사만 남는다. 더블클릭(단어)·트리플클릭(줄) 선택도 드래그와 같다. 복사가 실패하면(`navigator.clipboard.writeText` reject) `copy failed`가 같은 자리에 1초 표시된다.

완료 기준: 위 시나리오 전부(브라우저, `verify/selection-copy-check.mjs`) + preview 재실행. 규칙·API는 `06-editing.md` 6.6과 `00-architecture.md` 4.1(`ReplOptions.copyOnSelect`·`onCopy`, `ReplHandle.setCopyOnSelect`)에 적힌 대로다. 벤더 `packages/xterm-readline`에 키 이벤트 훅 `ReadlineOptions.onKeyEvent?: (event: KeyboardEvent) => boolean` 하나만 추가한다(`true`면 xterm 기본 처리 생략 — 코어가 `attachCustomKeyEventHandler`를 덮어쓰지 않는다). 단위: 판정 순수 함수(`ctrlKey`·`shiftKey`·`altKey`·`metaKey`·`key`·선택 유무 → `copy`/`pass`)·정책 객체(가짜 터미널: 선택 있으면 Ctrl+C가 벤더에 닿지 않고 `clearSelection` 1회, 선택 없으면 원래 경로, `mouseup`(`button === 0`, 터미널 안에서 시작한 드래그만) 자동 복사, `copyOnSelect` 끄면 `mouseup` 무동작이되 Ctrl+C 복사는 유지, `writeText` reject → `onCopy({ ok: false })`, `dispose()` 뒤 리스너 0 + 벤더 훅에서 `false`)·`chars`는 코드포인트 수(`"😀"` 1) 전부 RED 확인 + 변이 검사(`hasSelection` 가드 제거·`clearSelection` 제거·`copyOnSelect` 게이트 제거·`dispose` 해제 제거·`preventDefault` 제거 killed). 양성 대조 2건(서버 재시작 필수): `hasSelection` 가드 제거 → 선택 없는 Ctrl+C 인터럽트 셀 실패, `clearSelection` 제거 → 두 번째 Ctrl+C 인터럽트 셀 실패. 편차 등록: `10-parity-deviations.md`에 "선택이 있으면 Ctrl+C가 SIGINT·취소 대신 복사(3.14 pty는 선택 개념이 없어 항상 SIGINT)" + "선택 시 자동 복사(tty에 없음)" 1건. 총 `pageerror` 0, 루트 4종 통과. 브라우저 기준선(RD-018)에 이식 세트로 인계한다.

결과: 벤더 `ReadlineOptions.onKeyEvent` 훅(DELTA-01, 벤더 시험 4건 추가 130/130) → 코어
`terminal/selection-copy.ts`(`decideKey` 순수 함수 + `createSelectionCopy` 정책 객체, DELTA-02, 단위
22개 + 변이 5/5 killed) → `createRepl` 배선(`copyOnSelect`·`onCopy`·`setCopyOnSelect`·`CopyResult`
export, DELTA-03, 코어 회귀 0·939/939 PASS) → 데모 체크박스·토스트 + e2e 도우미 6종(DELTA-04, `lib.mjs`의
`selectRows`·`dblclickCell`·`readClipboard`·`seedClipboard`·`setCopyOnSelect`·`toastText`) → 브라우저
확인(DELTA-05). 브라우저 `verify/selection-copy-check.mjs` dev 14/14 PASS(S01~S12 + Ctrl+Shift+C 변형
S03b + 추가 S08b, `pageerror` 0, 3회 반복 재현), preview 4/4 PASS(S01·S02·S05·S07). 양성 대조 2/2 계획대로
실패(`hasSelection` 가드 제거 → S05 실패, `clearSelection` 제거 → S02 2차 Ctrl+C 셀 실패). 단위 시험은
코어 41개 파일·939개 전부 PASS(`selection-copy.test.ts` 22개 포함), 벤더 130개 전부 PASS. 루트 4종
(`check-types`·`lint`·`test`·`build`) 통과. 편차 43 등록(`10-parity-deviations.md`). 실측으로 확인된 것:
`mouseup`에서 `getSelection()`을 동기로 읽어도 항상 드래그 최종값이라 `setTimeout(0)` 우회는 필요 없었다.
xterm 6.0.0 DOM 렌더러의 선택 해제 관찰 셀렉터는 계획서가 가정한 `.xterm-selection-layer`가 아니라
`.xterm-selection`이었다(`docs/design/06-editing.md` 6.6, DELTA-05 "## 결정"). e2e 도우미 `selectRows`의
`endOutside`는 열 좌표를 행 끝으로 clamp한다는 것도 실측으로 확인해 JSDoc·README에 반영했다(DELTA-04
"## 결정").

인계(RD-018): 확인 스크립트는 `_works/_completed/20260923-17-rd-017-selection-copy/verify/`에 있다 —
`selection-copy-check.mjs`(S01~S12 + S03b·S08b, `apps/demo/e2e/lib.mjs`만 import), `positive-controls.md`
(2건), 결과는 `results/dev.json`·`results/preview.json`. 이 RD가 `apps/demo/e2e/lib.mjs`에 이미 넣은
`selectRows`·`dblclickCell`·`readClipboard`·`seedClipboard`·`setCopyOnSelect`·`toastText` 6종은 저장소에
있어 추가 이관이 필요 없다 — RD-018은 `selection-copy-check.mjs` 파일을 옮기면서 `apps/demo/e2e/lib.mjs`를
가리키는 상대 import 경로(`../../../apps/demo/e2e/lib.mjs`)도 새 위치에 맞게 고쳐야 한다(최종 통합 리뷰가
`_works/_completed/`로 옮긴 뒤 그대로 실행하면 `ERR_MODULE_NOT_FOUND`가 남을 것을 실측으로 확인했다 —
RD-005~016의 `verify/` 스크립트도 같은 패턴이라 RD-018 전체가 이 경로 보정을 포함해야 한다).
시험 강도 공백 소수(`selection-copy.test.ts`의 빈 문자열 방어 경로 미도달, `dragging` 리셋 회귀 시험
부재, `index.test.ts`의 `copyOnSelect`/`onCopy` 배선 검증 없음, `selection-copy-check.mjs`의 S02 300ms
유예 없음·S06/S07 토스트 텍스트 미확인 등)이 리뷰로 발견됐으나 전부 "현재 구현 정확성에 영향 없음"이 변이
검사로 교차 확인됐다(`_works/_completed/…/pending-issues/01·03·06.md`) — 승격하지 않았다. `verify/` 스크립트
자체가 RD-018에서 다시 손댈 임시물이라 지금 보강하는 대신 옮길 때 함께 다듬는다.

### RD-019 — 읽기가 없는 구간에 친 키 버퍼링(type-ahead)

상태: 완료 · 이전: 없음(이전 구현 미구현. 2026-09-24 `.scratch/type-ahead/issues/01-keys-dropped-while-no-active-read.md`에서 승격 — 이전 구현의 "RD-019"는 RD-013 자동 들여쓰기이며 무관) · 설계: `06-editing.md` 6.7(규칙)·6.1(벤더 소스 수정 방침), `04-stdin-input.md`(read-guard), `03-ctrl-c.md` 2.7(읽기 전 갭), `10-parity-deviations.md` 32(해소)·45~49

시나리오: `time.sleep(2)` 실행 중 `abc`를 치면 실행이 끝난 뒤 프롬프트에 `>>> abc`가 보이고 커서가 그 끝에 있다. 실행 중 `print(1)` Enter를 치면 실행이 끝난 뒤 그 줄이 제출돼 `1`이 나온다. Enter 직후(다음 프롬프트가 그려지기 전) 친 키가 다음 프롬프트에 들어온다. 실행 중 친 키 뒤 `input()`이 다음 읽기면 그 키는 `input()` 값이 된다(다음 읽기가 소비 — tty 입력 큐와 같다). 실행 중 Ctrl+C는 버퍼에 쌓이지 않고 기존 중단 경로(RD-007)로 가며, 그때까지 쌓인 키는 버린다(tty `ISIG`의 입력 큐 비움과 같다). 창 안의 붙여넣기는 낡은 `State`에 그려지지 않고 버퍼에 들어간다.

완료 기준:
- 위 시나리오 전부를 새 판정 스크립트 `apps/demo/e2e/checks/type-ahead-check.mjs`로 확인(L1, dev). 판정은 마커 배리어·`waitFor`로만 한다 — 고정 대기 뒤 부재·존재 판정과 ms 상한 없음(`09-testing.md` 9.7). "Enter 직후" 셀은 지연 0ms 입력 1회 결정적 판정이다(통계 반복 없음).
- 3.14.4 pty 기준 데이터(`apps/demo/e2e/pty/rd-019/`)와 대조: 실행 뒤 프롬프트 줄 내용·커서 위치, 선입력 줄 제출 결과, Ctrl+C 뒤 선입력 폐기. pty에서 실행 **중**에 tty가 키를 에코하는 동작은 따르지 않는다(웹은 다음 읽기에서 그린다) — 실측에서 에코가 확인되면 `10-parity-deviations.md`에 편차로 등록한다.
- 단위(jsdom + 실제 `Readline` + 가짜 터미널, `09-testing.md` 9.2): 비활성 구간 키가 다음 활성 읽기에 순서대로 재생된다, Ctrl+C는 쌓이지 않고 버퍼를 비운다, `dispose()` 뒤 버퍼가 비고 재생하지 않는다, 붙여넣기가 버퍼에 들어간다 — 전부 RED 확인 + 변이 검사.
- 기존 판정 회귀 없음: `ctrl-c-check`·`prompt-cancel-check`·`input-cancel-check`·`stdin-input-check`·`tab-check`의 영향 절을 `ONLY=`로 L1 실행. 선입력 키를 "버려진다"로 기대하던 셀(편차 32 전제, 예: `keys-after-enter-probe.mjs`·TRP-005 우회 셀)은 새 동작으로 기대값을 갱신하고 `BASELINE.md` 해당 행을 고친다.
- 문서: `10-parity-deviations.md` 32 해소 표시(번호 유지), `04-stdin-input.md` 71행·`03-ctrl-c.md` 162행의 "버린다" 서술 갱신, `DESIGN.md` 편차 건수.
- 전체 `e2e:baseline`·`e2e:measure`는 사용자 지시 때만(`docs/agents/rubber-workflow.md` "검증 실행 예산").

그릴링 확정(2026-09-24, 계획서 `_works/20260924-22-rd-019-type-ahead/checklist.md` 확정 1~12): 버퍼는 벤더 `Readline` 안(공개 API 추가 없음).
`activeRead`가 없을 때 들어온 `onData` 덩어리 중 Ctrl+C·Ctrl+L을 뺀 전부를 원본 문자열째 쌓고(상한 4096 UTF-16 코드 유닛, 초과 덩어리는 통째로 버림),
`read()` write 콜백 안 `new State`·`prefill` 직후 `readData`로 재생한다(Enter로 읽기가 끝나면 나머지는 버퍼에 남아 다음 읽기가 받는다 — read-guard와 무관).
Ctrl+C는 활성 읽기가 없으면 게이트와 무관하게 버퍼를 비운 뒤 `ctrlCHandler`를 부른다. `cancelRead()`(리셋)·`dispose()`는 버퍼를 비우고, 부팅 중 친 키는
쌓아 첫 프롬프트에서 재생한다. `apps/demo/e2e/lib.mjs`의 `typeWhenReading`·`cancelWhenReading` 재시도 루프는 버퍼링 뒤 글자를 중복시키므로 제거하고
(영향: `stdin-input-check`·`input-cancel-check` 전체 L1), `docs/traps/TRP-005`는 Ctrl+C 손실 중심으로 좁혀 유지한다. pty 필수 4건은 완료 기준, 실행 중
Backspace·←·Ctrl+U·Ctrl+D·Tab은 관찰 뒤 웹과 다르면 편차 등록(완료 기준 아님). 분할: DELTA-01 벤더 버퍼(L0), 02 하니스·`type-ahead-check`·L1 회귀, 03 pty, 04 문서.

결과: 벤더 `Readline`이 활성 읽기 없는 구간의 `onData` 덩어리를 원본 문자열째 쌓았다가(Ctrl+C·Ctrl+L 단독 제외, 상한 4096 UTF-16 코드 유닛, 초과 덩어리 통째 폐기) `read()` write 콜백 안 `new State`·`prefill` 직후 `readData`로 재생한다(공개 API 추가 없음, `06-editing.md` 6.7). 편차 32 해소.
- 벤더 단위 `type-ahead.test.ts` 21건(계획 11 + 보조 5 + pty 대조 제어 키 5), 벤더 전체 18 파일 151/151, 코어 43 파일 1185/1185. 변이 검사 14/14 killed(재생 제거·순서 뒤집기·스냅샷 미비움·Ctrl+C 비움 제거·`dispose`/`cancelRead` 비움 제거·상한 제거 등).
- 브라우저 `type-ahead-check.mjs`(dev L1) 13/13: T01~T09·T11 통과, `pageerror` 0. T10(상한)은 브라우저 셀 없이 벤더 단위로 대체했다. **T11은 Tab이 마지막 키인 입력(`os.getc`+Tab → `os.getcwd`)만 판정한다** — Tab 뒤에 키가 이어지면 Tab의 worker 왕복 응답 전에 뒤 키가 삽입돼 완성이 버려진다(편차 48, 키 순서 역전·중복은 없음). 양성 대조 1건(재생 제거 → `ONLY=T01` FAIL → 원복 → 통과).
- 영향 L1 회귀 0: `stdin-input-check` 19/19, `input-cancel-check` 26/26, `ctrl-c-check ONLY=S1` 3/3, `prompt-cancel-check ONLY=E1` 2/2, `tab-check ONLY=C7,C9,C11` 14/14, `session-reset-check ONLY=reset,carry,exit` 14/14. 기대값이 바뀐 셀 없음. `lib.mjs`의 `typeWhenReading`·`cancelWhenReading` 재시도 루프는 제거했다(재시도하면 글자가 중복된다).
- 3.14.4 pty(`apps/demo/e2e/pty/rd-019/`): 필수 4건 P1~P4 웹과 **일치**(에코 접두를 뺀 프롬프트 부분·프롬프트 시작 기준 열로 비교, 3.14의 실행 중 tty 에코는 편차 45). 제어 키 관찰: Backspace·Ctrl+U·Tab 마지막 키 일치, `←`(ESC[D) 뒤 글자 소실은 편차 46, Ctrl+D의 NUL은 편차 47, Tab 뒤 키 이어짐은 편차 48. 상한 초과(한 줄 5000자): 3.14는 앞 4095자를 남기고 웹은 덩어리를 통째로 버리므로 편차 49(여러 줄 누적 4096 초과의 3.14 동작은 미실측).
- 예외·미실행: 전체 `e2e:baseline`(L2)과 `e2e:measure`·`keys-after-enter-probe` N=10(L3)은 실행하지 않았다(사용자 지시 때만). preview 미실행(dev 전용 셀). pty 값은 자동 대조가 아니라 손으로 옮긴 표이며, 웹의 C5b 값은 `type-ahead-check` T11 1회차 1건이다. Shift+Enter는 `onData`를 거치지 않아 쌓이지 않고 버려진다(`.scratch/type-ahead/issues/02-*.md`, open), 리셋 직후 `printAbove` 창의 키 유실은 추정만 있다(`03-*.md`, deferred). `TRP-005`는 Ctrl+C 손실 중심으로 좁혀 유지했고 pty 관찰 함정은 `TRP-032`로 승격했다.

인계: 확인 도구는 저장소에 있다 — `apps/demo/e2e/checks/type-ahead-check.mjs`(`e2e:type-ahead`), `apps/demo/e2e/positive-controls/rd-019.md`(양성 대조 절차), `apps/demo/e2e/pty/rd-019/`(`pty_type_ahead.py`·`raw.txt`·`results.md`), 벤더 `packages/xterm-readline/src/type-ahead.test.ts`. 실행 로그·변이 검사기·결과 JSON은 `_works/_completed/20260924-22-rd-019-type-ahead/verify/`에 있다(`mutate-safe.mjs`, `mutations-delta01.json`).

## Phase 3 — 검증 자산

### RD-018 — 브라우저 회귀 하니스와 3.14 기준 데이터를 저장소 안에 보관

상태: 완료 · 이전: 없음(이전에는 `_works/` 스크립트) · 설계: `09-testing.md` 9.5·9.6

각 RD의 확인 스크립트(`_works/_completed/*/verify/`)와 pty 기준 데이터(기대 행 파일)를 `apps/demo/e2e/`로 옮겨 수동 실행 가능하게 한다. 공용 하니스 `lib.mjs`와 Playwright devDependency는 RD-010 선행 DELTA가 먼저 둔다(RD-010 참고). CI 상시 실행은 범위 밖이다.

완료 기준: `pnpm --filter demo e2e:<이름>`으로 기준선이 재현된다. 기준선은 이전 통과 건수가 아니라 **시나리오 ID별 현재 기대 결과**다 — (1) RD-005~017 각 인계의 이식 세트가 실패 0, (2) 각 RD의 `skipped-ids.md`가 담당 RD로 넘긴 건너뜀 항목이 그 RD 완료 뒤 복원되어 실패 0(담당 RD 미완료면 "미실행 + 담당 RD"로 표기하고 실패와 구분한다), (3) `boot-press` N=30 정상, (4) 모든 확인에서 총 `pageerror` 0(RD-009 기준선). 이전 구현 수치(RD-016 58/58, RD-016a 129/129, RD-012b 22/24, RD-012c 20/24, RD-006b 74/74)는 이력이며 합격 조건이 아니다 — RD-012b·012c는 RD-008이 낡은 기대값 8건을 현재 설계로 고쳐 이식 세트 실패 0이다(아래 인계(RD-008)). 기준 인터프리터(3.14.4)와 pyodide 번들(3.14.2) 차이를 README에 적는다.

확인(DELTA-01~06, 2026-09-23, `pnpm --filter demo e2e:baseline` 서버 미기동 상태 전체 1회 7분44.7초,
`apps/demo/e2e/results/summary.json`·`apps/demo/e2e/BASELINE.md` 근거): (1) 이식 세트(판정 16종, dev
전부 + preview 부분) `failed: []` — 실패 0. (2) `skipped-ids.md` 3판(RD-006·007·008)을 재집계한
결과 73개(RD-006b 원본 선언 기준 1절 23 + 2절 20 + 3절 30, 옛 "74"와 1건 차이 — 원인 미상,
`BASELINE.md` 5절·`pending-issues/08.md`) 전부 복원 실행 확인, 미실행은 RD-016 담당 1건
(`import os.pa` 지연 측정, 2026-09-24 RD-016이 C12에 추가해 해소)뿐. (3) `boot-press` N=30 **30/30 OK**. (4) 총 `pageerror` **0**(`baseline.json`의
`expectedPageErrors`로 의도된 forced 3건 — session-reset dev·preview `crash` 절, tla dev `sticky` 절 —
을 제외, 초과분은 그대로 잡힌다). 허용 편차 1건(AD, 꼬리 든 프롬프트에서 Ctrl+L, 편차 44) + 양성 대조
허용 예외 1건(rd-007.py #3은 `burst-matrix COMBOS=a`에서 검출력 없음을 실측 확인한 무해한 회귀).
rd-008.py #2의 RM2 셀은 docstring 오류로 판정돼 정정
(`.scratch/signal-interrupt-rm2-regression/issues/01-rm2-positive-control-fails-opposite-of-docs.md`).
현재 위치는 `apps/demo/e2e/`, 표는 `apps/demo/e2e/BASELINE.md`.

인계(RD-005): RD-005 검증 스크립트(`lib.mjs` 하니스, `repl-check.mjs`(normal·cdn-blocked·not-isolated), `prompt-join-check.mjs`(RD-006b 이식 20개), `trailing-newline-check.mjs`(RD-011a 이식 12개), `carryover-check.mjs`, `keys-after-enter-probe.mjs`, `positive-controls.py`)는 `_works/_completed/20260922-05-rd-005-repl-loop/verify/`에 있다. 이 RD가 `apps/demo/e2e/`로 옮길 때 각 RD가 넘긴 "건너뛴 시나리오"를 되살려 기준선 5종을 채운다. `ONLY=<이름 접두어,…>` 환경변수로 확인을 분리해 돌릴 수 있다. 400토큰(25행, 스크롤백) 꼬리 관찰은 새 데모에 `window.__term`이 없어 옮기지 않았다. 함정: `docs/traps/TRP-005`·`TRP-007`·`TRP-008`.

인계(RD-006): RD-006 검증 스크립트(`lib.mjs`(RD-005 하니스 + `typeWhenReading`·`settled`), `stdin-input-check.mjs`(RD-006b stdin 23개 ID + `x: abc`·`TICK`), `bg-input-guard-probe.mjs`, `positive-controls.py`, 이전 74개 ID의 실행·건너뜀 표 `skipped-ids.md`)는 `_works/_completed/20260922-06-rd-006-stdin-input/verify/`에 있다. 이 RD는 `skipped-ids.md`의 표(RD-006 실행·RD-005 실행·건너뜀과 대상 RD)로 74개 복원 목록을 만든다. 입력은 읽기가 시작된 뒤에 보내야 하는데 stdin 프롬프트 글자는 읽기 시작보다 먼저 나오므로 첫 글자가 에코될 때까지 재시도한다(`TRP-005`). 출력 도착을 마커 포함으로 기다릴 때 입력한 코드 행을 뺀다(`TRP-011`).

인계(RD-008): RD-008 검증 스크립트는 `_works/_completed/20260922-08-rd-008-prompt-and-input-cancel/verify/`에 있다 — `lib.mjs`(RD-007 하니스 + `cancelWhenReading`·`ctrlCBurst`·`caretCount`·`interruptCount`), `prompt-cancel-check.mjs`(23개), `input-cancel-check.mjs`(26개), `input-burst-matrix.mjs`(8셀), `positive-controls.py`(3종), `pty/pty_cancel.py`·`pty/results.md`(3.14.4 취소 7건), `mutate-safe.mjs`(멈추는 변이를 끊는 변이 검사기), `skipped-ids.md`. **기준선 문구 갱신**: 이전 "RD-012b 22/24, RD-012c 20/24"는 더 이상 맞지 않다 — 낡은 기대값 8건을 현재 설계로 고쳐 **이식 세트 실패 0**이고, 남은 건너뜀은 5줄(RD-012b G1 → RD-013, RD-012b·012c J1·J2 → RD-010, RD-006b J3·AC1 → RD-010, X2·X3 → RD-014)이다. 확인 스크립트에서 출력 유무를 판정할 때 **부분일치를 쓰지 않는다**: 제출한 소스 줄이 화면에 에코되므로 `print('wrong')` 같은 줄이 `wrong`에 걸린다(행 정확일치 `hasRow` 또는 기준선 대비 증가분 `countOf`를 쓴다).

## Phase 4 — 패키지 분리와 새 소비자

[ADR-0006](./docs/adr/0006-pyodide-core-and-plugin-packages.md). 순서: RD-020 → RD-021 → RD-022 → RD-023 → RD-024. RD-025는 독립이다. 배포는 `pnpm pack` tarball(버전 동기)이고, 소비자는 `/work/cp949/runo/runo-pyodide-canvas`·`runo-lab`이다. 저장소는 향후 `runo-pyodide`로 개명한다(시점 미정).

### RD-020 — `pyodide-core` 추출과 `pyodide-repl` 축소(동작 불변)

상태: 대기 · 이전: 없음 · 설계: `00-architecture.md` 4절, ADR-0006, `01-protocols.md` 5절(초기화)

`packages/pyodide-core`(`@cp949/runo-pyodide-core`)에 프로토콜·`output-tail`·worker 커널(`PyodideConsole(globals, filename)` 뼈대, stdout/stderr, webloop 재보고 억제, sleep 조각, SIGINT, stdin 배선)·main 세션(worker 생성, RPC, 메일박스 writer, interrupt sender)을 옮기고, `pyodide-repl`은 REPL driver(`sys.ps1/ps2`·헬퍼·TLA·배너·제출 러너·여러 줄 분할·완성)와 REPL 프런트만 남긴다. `pyodide-repl` 공개 API(`createRepl`, `./worker`의 `runReplWorker`)는 그대로다. 공용 시험 도우미는 비공개 `packages/pyodide-testkit`(`@repo/pyodide-testkit`)로 뺀다.

시나리오: demo(`apps/demo`)가 import 경로 외 변경 없이 지금과 같은 REPL로 동작한다. 새 빈 프로젝트에 xterm-readline·core·repl tarball만 설치해도 import·타입이 해석되고 `node_modules`에 coincident가 없다.

완료 기준:
- 연결 지점: RPC 핸들러는 main·worker 모두 생성 시 core + driver 핸들러를 합성하고 이름 충돌은 생성 시 예외. "Python 실행 중" = `alive && inputReadsPending === 0 && !driver.isIdle()`(REPL `isIdle` = `readLinePending || cancelSettling`). core 출력은 stdout/stderr 원문 `{ stream, text }`, `writeOutput`·`writeError`는 REPL driver 핸들러. 초기화 프레임 `{ kind: "init", rpcPort, interruptBuffer, stdinCtrl, stdinData, pyodide: { indexURL }, driver }`(`topLevelAwait`는 `driver` 안). `runWorker({ driver })`만 구현(`plugins`는 RD-023).
- worker init 수신은 모듈 본문 동기 등록 + `!Array.isArray(data) && data.kind === "init"`만 받고 제거(첫 메시지 무조건 소비 금지). 단위 시험: 배열 메시지가 먼저 와도 init을 받는다, 늦은 등록 변이는 실패한다.
- 시험 제목 목록이 이동 전후 같다(diff 0). 모듈 시험은 모듈과 함께 이동.
- coincident 비의존: core·repl 의존 트리에 `coincident`·`reflected-ffi` 없음(단위 시험), 두 패키지 `dist/`에 `coincident` 문자열 없음, tarball 스모크(xterm-readline·core·repl pack → 임시 폴더 `file:` + `pnpm.overrides` 설치 → import·타입 해석 → `node_modules`에 coincident 없음).
- L1(마지막 DELTA 1회씩): `e2e:repl-check`(normal)·`e2e:ctrl-c`·`e2e:stdin-input`·`e2e:prompt-cancel`. L2 전체 `e2e:baseline` 병합 직전 1회(2026-09-24 사용자 사전 승인) — 결과가 RD-018·019 기준선과 같다. 시간 측정 관련 deferred 셀은 판정에서 제외한다.
- 문서: `00-architecture.md` 4절 재작성, `CONTEXT-MAP.md`에 core 컨텍스트, 02~08은 경로만 갱신.

### RD-021 — pyodide 버전 원천 통합과 호환 탐지

상태: 대기 · 이전: 없음 · 설계: `13-version-upgrade.md`(신설), ADR-0007(신설, 버전 정책)

pyodide 버전 원천을 devDependency `"pyodide"` 하나로 두고 코드는 `pyodide/package.json`에서 읽는다(`DEFAULT_PYODIDE_INDEX_URL`·시험 기대값 유도). worker 부팅 시 비공개 API 7지점을 한 번 탐지해 `ready` 페이로드 `{ pyodideVersion, versionMismatch, degraded }`로 알리고 main은 비어 있지 않으면 `console.warn`한다(공개 API 불변). 등급: `setInterruptBuffer`·`checkInterrupt` 부재는 시작 거부, `_compile.compiler.flags`·WebLoop 핸들러·`run_sync` 교체·sleep 조각·`pyodide/webloop.py` 파일명·`_IncompleteInputError` 문구는 저하(해당 기능만 끄고 `degraded` 기록).

시나리오: 소비자가 `indexURL`로 다른 pyodide 버전을 로드하면 콘솔에 버전 불일치 경고가 한 번 나오고 REPL은 계속 동작한다.

완료 기준: 버전 리터럴 `314.0.7`이 `package.json` 밖 코드·시험에 0건. `dist`가 `pyodide`를 런타임 import하지 않는다. 저하 지점별 속성 제거(문구 변조) 단위 시험이 `degraded` 항목과 해당 기능 꺼짐을 확인하고, interrupt 공개 API 부재 시 시작 거부 시험, `versionMismatch` 참/거짓 시험, 탐지 분기 제거 변이 시 실패. 업그레이드 절차(patch·minor, 판단 자료를 만들고 멈춘다, 재측정은 사용자 결정)를 `13-version-upgrade.md`에 적는다. L0만.

### RD-022 — 실행 driver와 `pyodide-terminal` 실행창

상태: 대기 · 이전: 없음 · 설계: ADR-0006, `00-architecture.md` 4절

core에 실행 driver(`runDriver`)를, `packages/pyodide-terminal`에 xterm 실행창을 둔다. xterm 결합 공통 부품(`sinks`·`rewind-tail`·`stdin-reader`·`notice`·`selection-copy`)을 repl에서 terminal로 옮긴다. `run(code)`는 run마다 새 globals(`__name__ == "__main__"`, 파일명 옵션 기본 `"main.py"`), `sys.modules` 유지(편차 등록), 실행 중 `run()`은 거부. `stop()`은 interrupt → 1000ms 안에 복귀하지 않으면 terminate → worker 자동 재생성(`stopped`와 `restarted` 구분). 상태 `loading`·`ready`·`running`·`waiting-input`·`restarting`·`load-failed`·`crashed`·`not-isolated`, `run()` 결과 `ok` / `error{ errorType, traceback }` / `interrupted` / `exit{ code }` / `restarted`, 트레이스백은 stderr와 결과 양쪽. 실행창은 `input()` 대기 중에만 한 줄 편집(history 없음), 그 외 키 무시. Ctrl+C는 선택이 있으면 복사, 실행 중이면 `^C` + interrupt, `ready`면 무동작. 화면 지우기는 기본 안 함(`clear()`·`clearOnRun`). REPL에는 `runSource(code)`를 추가한다(REPL globals, 입력 줄 에코 없이 출력, 치던 한 줄 보존·재그리기, 블록 입력 중·실행 중이면 거부).

시나리오: `name = input("이름: "); print(name)`을 `run()`하면 `이름: `에서 한 줄을 받아 출력한다. `while True: pass` 실행 중 Ctrl+C 또는 `stop()`이면 `KeyboardInterrupt` 트레이스백과 결과 `interrupted`. `input()` 대기가 아닐 때 친 글자는 화면에 나타나지 않는다. 연속 두 번 `run()`은 두 번째가 거부된다.

완료 기준: 첫 DELTA에서 `PyodideConsole(filename="main.py")` + `compile(..., "exec")` → `console.runcode` 재사용 가설을 확인한다(실패 시 SIGINT 계층을 "실행 호스트"(`filename`·실행 래퍼·트레이스백 포맷터) 인터페이스로 일반화하고 같은 RD에서 처리). 위 시나리오의 단위·jsdom 시험(RED + 변이 검사). 실행창용 새 e2e 판정 스크립트(demo에 실행창 화면 추가) L1. REPL 회귀는 영향 스크립트 `ONLY=` L1. coincident 비의존 검사를 terminal에 확장.

### RD-023 — `pyodide-dom-bridge`(coincident DOM 프록시)

상태: 대기 · 이전: 없음 · 설계: ADR-0006, canvas 저장소 `docs/design/01-bridge.md`·`08-facts-and-traps.md`

`packages/pyodide-dom-bridge`에 coincident upstream 4.1.1 + reflected-ffi 0.7.2(포크 없음)로 `registerJsModule("runo", { browser: { window, document } })`를 설치하는 worker 플러그인과 main 쪽 Worker 생성 도우미를 둔다. core에 `runWorker({ driver, plugins })`의 `plugins`를 추가한다. canvas 결정 계승: `import js` 비사용, 얕은 `guardedWindow`와 보안 한계, 비격리 시 `unsupported`, CSP 금지 목록(`ffi.evaluate`, blob `sync.js`). `input()`·출력·중단은 core 채널. REPL + dom-bridge는 비지원(문서화).

시나리오: 실행창에서 `from runo.browser import document`로 canvas에 그리고, 같은 코드의 `input()`과 Ctrl+C가 실행창과 똑같이 동작한다.

완료 기준: worker 첫 import 규칙 위반(부트스트랩 전 core 메시지 수신) 시 명시 오류. 공존 스파이크 S1~S7을 저장소 시험으로 재현(Chromium). 착수 조건: Firefox·`native: false` 환경 공존 실측, terminate 후 재생성 누수 확인, `reflected_ffi_timeout`로 동기 호출 중 중단(S5) 완화 가능성 판단 — 결과가 공존 불가면 설계를 다시 한다. 출력(비동기)·DOM(동기) 순서 역전은 허용하고 문서화한다(스파이크 500쌍 역전 0).

### RD-024 — `pyodide-react`와 demo 이전

상태: 대기 · 이전: 없음 · 설계: ADR-0006, `08-session.md`(이중 마운트)

`packages/pyodide-react`에 `<PythonRunner ref>`(handle `run`·`stop`·`reset`, props `createWorker`·`indexURL?`·`inputProvider?`·`onStatus`·`onOutput?`·`terminalOptions?`)와 `<PythonRepl ref>`(handle `runSource`·`reset`), 저수준 `usePythonRunner`를 둔다. 컴포넌트가 xterm 생성·FitAddon 리사이즈·dispose·StrictMode 이중 마운트를 처리하고, `inputProvider`를 생략하면 xterm 줄 입력이다. React 19 ref-as-prop. iframecall 어댑터는 넣지 않는다(앱 계층). demo는 이 패키지로 옮긴다.

시나리오: React 19 StrictMode 앱에서 `<PythonRepl>`을 마운트하면 worker가 하나만 살아 있고, 창 크기를 바꾸면 터미널이 맞춰진다. `ref.current.run(code)`가 실행창에서 실행된다.

완료 기준: StrictMode 이중 마운트에서 worker 1개(시험), 언마운트 시 worker·Terminal 정리. demo 이전 뒤 RD-020 L1 스크립트와 RD-022 실행창 스크립트가 같은 결과. L2는 사용자 지시 때만.

### RD-025 — 저장소에 없는 pty 캡처 도구 복원

상태: 대기 · 이전: 없음 · 설계: `09-testing.md`, `13-version-upgrade.md`

RD-018·019가 `apps/demo/e2e/pty/`에 rd-008·015·016·019 기준 데이터와 `pty_cancel.py`·`pty_type_ahead.py`를 두었다. 아직 이전 구현 `_works/`에만 있는 캡처 도구(rd-015·016의 `ptyrepl.py`·`compare_native_pyodide.py`·`build_gate_corpus.py` 등)를 옮기고 기준 인터프리터를 인자로 받게 한다(3.15 재측정 대비).

시나리오: CPython 3.14.4로 도구를 실행하면 저장소의 rd-015·016 기준 데이터와 같은 파일이 다시 만들어진다.

완료 기준: 재생성 결과가 저장소 데이터와 같다(다르면 항목별 원인 기록). 실행 전제(인터프리터 경로, `pyte` 등, pty 24×80 `TERM=xterm`)를 `apps/demo/e2e/pty/README` 또는 `09-testing.md`에 적는다. 재측정 여부는 사용자가 정한다(ADR-0007).

---

## 보류

이전 구현에서 보류·미착수였던 항목. 시나리오와 완료 기준이 갖춰지면 위 규칙으로 등록한다.

| 항목 | 이전 | 사유 |
| --- | --- | --- |
| `input()` 안 Tab 완성 | RD-016b | `input()`은 메일박스 대기라 worker가 멈춰 있어 worker 완성이 불가. main 쪽 완성이나 별도 배선이 필요 |
| `time.sleep` 대기 중 워커 CPU 점유 | RD-012j | 정확성 영향 없음. 재측정 비용이 이득보다 큼 |
| 후보 선택 UI(popover) | RD-016d | 3.14 동등 밖 UI 기능 |
| "Python 정지" 플래그(송신기 잔류 제거) | RD-012h(a) | 정확성 영향 없음 |
| Ctrl+D(빈 줄 EOF) | 없음 | 이전 구현 미구현. 시나리오 정하면 등록 |

## 범위 밖

`docs/design/10-parity-deviations.md` 2절(3.14 편차 중 범위 밖 확정 5건)과 다음 v1 제외 항목: 히스토리 영구 저장, Ctrl+R 역검색, syntax highlighting, session export/import, 패키지 설치 UI, 파일시스템·터미널 명령·디버거, Service Worker COOP/COEP 우회, CI 상시 E2E, 서버 CPython 프로세스 아키텍처, `@cp949/runo-xterm-readline`의 npm 배포(재사용 가치가 확인되면 별도 결정).
