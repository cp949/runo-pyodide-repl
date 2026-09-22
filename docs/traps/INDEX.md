# 함정 색인

rubber-workflow의 "함정 → 장기 문서화" 기준(재발 조건 특정 가능, 성공처럼 보이는 신호, 재발 가능성)을 모두 만족해 승격한 항목이다. `docs/design/11-known-traps.md`는 이전 구현에서 이관한 목록이며 수정하지 않는다.

| ID                                                               | 제목                                                    | 상태   | 적용 조건                                                                                  |
| ---------------------------------------------------------------- | ------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------ |
| [TRP-001](./TRP-001-vite-dev-caches-failed-workspace-resolve.md) | vite dev가 워크스페이스 서브패스의 해석 실패를 캐시한다 | ACTIVE | `dist` 없는 클린 체크아웃의 `pnpm dev`, 새 패키지·서브패스 추가 시 `development` 조건 누락 |
| [TRP-002](./TRP-002-non-shared-view-breaks-sharing-silently.md) | 비공유 typed array를 postMessage로 넘기면 메모리 공유가 조용히 끊긴다 | ACTIVE | 초기화 프레임·`workerData`로 뷰를 넘길 때, 프레임에 SharedArrayBuffer 채널을 추가하거나 버퍼 생성 코드를 바꿀 때 |
| [TRP-003](./TRP-003-state-change-without-notify.md) | 상태를 되돌리는 쪽이 notify하지 않으면 반대편 대기가 영영 깨어나지 않는다 | ACTIVE | SharedArrayBuffer 상태를 양쪽이 `Atomics.wait`/`waitAsync`로 번갈아 기다리는 채널(메일박스)의 상태 전이를 추가·수정할 때 |
| [TRP-004](./TRP-004-xterm-write-callback-runs-after-dispose.md) | xterm write 콜백은 `term.dispose()` 뒤에도 실행되고, 그 안의 `buffer` 접근은 경고만 남긴다 | ACTIVE | `term.write(text, callback)` 콜백 안에서 `term`에 접근하는 코드를 추가·수정할 때, 마운트 직후 읽기를 시작하는 코드를 StrictMode 아래에서 쓸 때 |
| [TRP-005](./TRP-005-automation-input-before-prompt-is-dropped.md) | 자동화 입력은 새 프롬프트가 보인 뒤에 보내야 한다(활성 읽기 전 키는 버려진다) | ACTIVE | 브라우저 하니스가 Enter 뒤 이어서 키를 보낼 때, 읽기를 요청하는 코드(REPL 읽기, `input()`)를 추가하거나 읽기 시작 경로를 바꿀 때 |
| [TRP-006](./TRP-006-row-text-check-misses-extra-blank-line.md) | 화면 행 텍스트만 비교하면 출력 끝의 여분 빈 줄을 놓친다(커서 행을 봐야 한다) | ACTIVE | Playwright로 xterm 화면의 출력 뒤 개행 수를 확인하는 하니스, 배너·값 에코·트레이스백·stderr 뒤 "빈 줄 없음"을 검증할 때 |
| [TRP-007](./TRP-007-vite-dev-stale-module-after-file-replace.md) | 파일을 `git checkout`으로 되돌린 뒤 다시 변조하면 vite dev가 낡은 모듈을 계속 준다 | ACTIVE | vite dev를 띄워 둔 채 소스를 변조 → `git checkout` 원복 → 재변조하며 브라우저 확인을 반복할 때(양성 대조) |
| [TRP-008](./TRP-008-negative-check-misses-scrolled-log.md) | "로그가 없다"는 브라우저 확인을 뷰포트만 훑어 하면 화면 밖으로 밀려난 로그를 놓친다 | ACTIVE | 브라우저 하니스가 후속 출력 뒤 뷰포트(24행)에서 "이 문자열이 없다"를 판정할 때, 여러 행짜리 stderr 로그가 대상일 때 |
| [TRP-009](./TRP-009-concurrent-agents-contaminate-worktree.md) | 한 작업 트리에서 에이전트 둘이 동시에 일하면 변이 검사와 시험이 서로를 오염시킨다 | ACTIVE | 한 저장소·브랜치에서 에이전트 둘 이상이 변이 검사기·임시 계측·커밋을 동시에 쓸 때 |
| [TRP-010](./TRP-010-stdin-read-n-leaves-newline-in-buffer.md) | `sys.stdin.read(n)`이 남긴 줄 끝 `\n`이 다음 읽기를 콜백 없이 채운다 | ACTIVE | 같은 pyodide 인스턴스에서 `sys.stdin.read(n)` 뒤 `input()`·`readline()`·`readlines()`로 읽는 시험·세션 |
| [TRP-011](./TRP-011-echoed-input-satisfies-output-wait-instantly.md) | 출력 도착을 "화면 행에 마커 포함"으로 기다리면 입력한 코드 행이 마커를 포함해 즉시 통과한다 | ACTIVE | 브라우저 하니스가 지연·배경 출력을 텍스트 포함으로 기다리고 마커가 입력한 코드에도 들어 있을 때 |
| [TRP-012](./TRP-012-sigint-polling-lands-before-try-entry.md) | 눌림 뒤 첫 폴링이 `try` 진입 전에 떨어지면 `KeyboardInterrupt`가 `except` 바깥으로 나간다 | ACTIVE | 눌림을 일으킨 뒤 `try`/`except KeyboardInterrupt`로 잡는 node·브라우저 시나리오를 쓸 때 |
| [TRP-013](./TRP-013-three-discard-paths-mask-each-other.md) | 대상 없는 SIGINT를 없애는 방어가 여럿이라 서로의 배선 결함을 가린다 | ACTIVE | 루프·버퍼 연결·핸들러의 SIGINT 폐기를 시험하거나 그 배선을 바꿀 때 |
| [TRP-014](./TRP-014-atomics-wait-kills-sender-resend-timer.md) | 눌림 스레드를 `Atomics.wait`로 재우면 송신기의 재전송 점검이 죽고 "소실 0"이 저절로 나온다 | ACTIVE | 별도 스레드에서 `createInterruptSender`를 써서 소실·복구를 재는 하니스를 쓸 때 |
| [TRP-015](./TRP-015-nohup-background-dies-with-agent-session.md) | `nohup ... &`로 띄운 장시간 작업은 에이전트 세션 정리에 죽고, 로그만 보면 정상 종료와 구별되지 않는다 | ACTIVE | 에이전트가 셸 도구로 수 분 이상 걸리는 측정·서버를 띄울 때 |
| [TRP-016](./TRP-016-burst-screen-assertions-break-three-ways.md) | 연타 Ctrl+C의 화면 판정은 행 감김·스크롤 아웃·프롬프트 재그리기에 세 번 깨진다 | ACTIVE | 실행 중 Ctrl+C를 여러 번 누르고 화면 텍스트로 판정하는 브라우저 확인을 쓸 때 |
| [TRP-017](./TRP-017-mutation-runner-timeout-misses-grandchild.md) | 변이 검사기의 `spawnSync` timeout이 `pnpm exec vitest`에는 듣지 않는다(손자가 파이프를 붙잡는다) | ACTIVE | `spawnSync("pnpm", ["exec", "vitest"…], { timeout })`로 변이 검사를 돌리는데 어떤 변이가 스위트를 멈추게 할 때 |
| [TRP-018](./TRP-018-pkill-f-matches-own-shell.md) | `pkill -f`가 자기 셸 명령줄을 매치해 뒤 단계(원복)를 날린다 | ACTIVE | 한 셸 호출에서 `pkill -9 -f` 뒤에 원복·정리 단계를 이어 붙일 때 |
| [TRP-019](./TRP-019-residual-sigint-passes-loose-assertion.md) | 잔류 SIGINT가 다음 시험에서 터져 느슨한 단언이 우연히 통과한다 | ACTIVE | 한 파일에서 실제 pyodide + interrupt buffer를 공유하며 취소·중단 시험을 연달아 돌릴 때 |
| [TRP-020](./TRP-020-non-console-filename-drops-cancel-into-retry-loop.md) | `<console>` 밖 파일명(`runPython`의 `<exec>`)에서 취소하면 핸들러가 버려 읽기 재시도 루프가 된다 | ACTIVE | stdin 취소·실행 중 중단을 node 시험에서 `pyodide.runPython`으로 재현할 때 |
| [TRP-021](./TRP-021-coroutine-sync-sleep-leaks-our-frames.md) | 코루틴 프레임 안의 동기 `time.sleep` 중단은 우리 파일명이 든 트레이스백을 한 번 더 찍는다 | ACTIVE | `async def` 안에서 동기 `time.sleep`을 부르는 코루틴을 `asyncio.run`·`run_sync`로 돌리는 중 Ctrl+C, 그 화면 형식을 판정할 때 |
| [TRP-022](./TRP-022-node-side-polling-inflates-browser-latency.md) | 브라우저 지연을 Node 쪽 폴링으로 재면 문턱 근처에서 5~8ms 과대 측정된다 | ACTIVE | Playwright 하니스가 키 입력 → 화면 변화 지연을 재고 판정선이 수십 ms일 때 |
