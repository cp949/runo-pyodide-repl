# 04 `sigint-handler-sleep-slice.test.ts`의 `time.sleep(2**31)도 조각돼 눌림에 끊긴다`가 병렬 실행에서 1회 실패했다

Status: deferred

## 현상

`pnpm test --force`(루트, 패키지 5개 병렬)에서 `packages/pyodide-repl/src/worker/sigint-handler-sleep-slice.test.ts` >
`time.sleep(2**31)도 조각돼 눌림에 끊긴다`가 `expected 104.52 to be less than 100`으로 1회 실패했다(눌림 뒤 복귀 시간의 100ms 판정에
104.5ms). 같은 파일 단독 3회는 26/26 통과했고 이어서 돌린 `pnpm test` 전체는 1063/1063 통과했다.

## 재개 조건

- 같은 파일을 단독으로 N=10 돌려 1회 이상 재현되면 `open`으로 바꾸고 재현율·부하 조건을 `## Comments`에 남긴다.
- 그 전에는 원인을 조사하지 않는다(1회 관찰·원인 불명, `docs/agents/issue-tracker.md` "등록·분류 기준").

## 참고

- 관찰 당시 변경은 `time.sleep` 조각 교체 코드(`worker/sleep-slice.py` 동작)를 바꾸지 않고 보고 호출(`warn` → `report`)만 교체한 것이라 이 시험의 대상 동작은 그대로였다. 병렬 부하에서 눌림 복귀 여유(100ms)가 좁은 시간 판정으로 보인다(추정, 미검증). 시간 판정 규칙은 `docs/design/09-testing.md` 9.7.
- 원시 로그는 남기지 않았다(실패 메시지만 기록). 재현되면 그때의 로그 경로를 `## Comments`에 적는다.

## Comments
- 2026-09-24 RD-022 추가 관찰(분류는 `deferred` 유지): 부품 이동(repl → terminal) 뒤 루트 `pnpm test --force`(기본 병렬도)를 2회 돌렸고 둘 다 같은 파일에서 실패했다(1회차 `time.sleep(5) 도중의 눌림이 100ms 안에…` 133.97ms·`time.sleep(2**31)…` 107.08ms, 2회차 같은 파일의 다른 시험 3건). 이동 **전** 커밋(`git worktree`로 뗀 HEAD)에서 같은 명령이 1건·3건 실패해 이동과 무관함을 확인했다. 단독 실행은 3/3 통과했다. 이 이슈의 재개 조건(같은 파일 단독 N=10에서 1회 이상 재현)은 충족하지 못했으므로 `open`으로 바꾸지 않았다. 병렬 부하에서는 이동 전 커밋에서도 2/2 재현이므로(원인은 결정적 결함이 아니라 100ms 고정 상한 대비 CPU 포화로 추정) 재분류(`open`)는 사용자 판단으로 남긴다. 실무 규칙: L0 판정은 `pnpm test --force --concurrency=1`(15 태스크 통과, `docs/design/09-testing.md` 9.1). 로그: `_works/_completed/20260924-26-rd-022-run-driver-terminal/verify/l0-delta05-head-parallel-run{1,2}.log`(이동 전), `l0-delta05-test-run{1,2}-flaky.log`(이동 뒤), `sleep-slice-rerun-delta05.log`(단독 3/3).
- 2026-09-24 RD-022a 추가 관찰(분류는 `deferred` 유지): 루트 `pnpm test --force`(기본 병렬도) 1회에서 같은 파일 3건이 실패했다(`time.sleep(5) 도중의 눌림이 100ms 안에…` 126.99ms, `time.sleep(2**31)도…` 111.24ms, `__index__ 객체도…` 120.74ms). 이 브랜치의 변경(core `exec_in_console` 분리, 벤더 `takeRead`, REPL `runSource`)은 `sleep-slice.py`·SIGINT 계층을 바꾸지 않는다. turbo가 실패로 core 시험을 중단해 core 시험 수는 이 실행에서 나오지 않았다. 같은 파일 단독 실행은 26/26 통과했고 `pnpm test --force --concurrency=1`은 15 태스크 전부 통과(1948 시험)했다. 재개 조건(단독 N=10 재현)은 충족하지 못했다. 로그: `_works/_completed/20260924-27-rd-022a-repl-run-source/verify/l0-delta06-test.log`(병렬 실패), `l0-delta06-sleep-slice-solo.log`(단독 통과), `l0-delta06-test-concurrency1.log`(통과).
- 2026-09-24 RD-022b 추가 관찰(분류는 `deferred` 유지): 이번에는 **`--concurrency=1`에서도** 실패했다(이전 관찰은 모두 기본 병렬도). (1) 루트 `pnpm test --concurrency=1`(`--force` 없음) 1회차 같은 파일 2건 실패 — `time.sleep(5) 도중의 눌림이 100ms 안에…` 110.55ms, `time.sleep(2**31)도…` 133.30ms(`_works/_completed/20260924-28-rd-022b-bg-output-above-read/verify/l0-delta01-root-test.log`). 같은 파일 단독 26/26(`l0-delta01-sleep-slice-solo.log`), 이어 `pnpm test --force --concurrency=1` 15/15 태스크·1992 시험 통과(`l0-delta01-root-test-run2.log`). (2) 다른 변경 뒤 루트 `pnpm test --force --concurrency=1` 1회차 1건 실패 — `time.sleep(5) 도중의 눌림이…` 119.99ms(`l0-delta02-root-test.log`), 단독 26/26(`l0-delta02-sleep-slice-solo.log`), 2회차 15/15(`l0-delta02-root-test-run2.log`). 두 변경 모두 벤더 `xterm-readline`·terminal sink·repl main 쪽이고 `sleep-slice.py`·SIGINT 계층은 건드리지 않았다. 재개 조건(단독 N=10 재현)은 충족하지 않았다. "L0 판정은 `--concurrency=1`" 규칙으로도 1회차 실패가 날 수 있다는 점만 새로 확인됐다.
