# 04 `sigint-handler-sleep-slice.test.ts`의 `time.sleep(2**31)도 조각돼 눌림에 끊긴다`가 병렬 실행에서 1회 실패했다

Status: done

## 현상

`pnpm test --force`(루트, 패키지 5개 병렬)에서 `packages/pyodide-repl/src/worker/sigint-handler-sleep-slice.test.ts` >
`time.sleep(2**31)도 조각돼 눌림에 끊긴다`가 `expected 104.52 to be less than 100`으로 1회 실패했다(눌림 뒤 복귀 시간의 100ms 판정에
104.5ms). 같은 파일 단독 3회는 26/26 통과했고 이어서 돌린 `pnpm test` 전체는 1063/1063 통과했다.

## 해결 (2026-09-25)

원인은 **절대 ms 상한이 동시 실행 부하의 정상 지연을 흡수하지 못한 것**이다. 제품 결함이 아니다 — 실패한 실행에서도 같은 시험의
기능 단언(`screen.stderr` = `KeyboardInterrupt` 트레이스백)은 통과했고 시간 단언만 깨졌다.

같은 장비 실측(`_works/20260925-35-l0-time-limits/verify/measure.tsv`, 임시 계측을 넣어 `afterPressMs`를 모으고 원복했다):

| 조건                                        | n   | `afterPressMs`    | 옛 판정선 100ms 대비 |
| ------------------------------------------- | --- | ----------------- | -------------------- |
| 파일 단독(`vitest run <file>`)              | 25  | 42.8 ~ 56.9       | 43~57%               |
| 패키지 전체 병렬(34파일)                    | 15  | 63.5 ~ 92.1       | 63~92%               |
| 루트 `pnpm test --force --concurrency=1`    | 1   | **133.2 → 실패**  | 133%                 |

- CPU 포화는 원인이 아니다: busy 6프로세스(load 2.5)로 단독 N=10을 돌려 20/20 통과했다(`phase-b-summary.txt`).
  실패를 만드는 것은 동시에 살아 있는 pyodide 인스턴스 수다(패키지 단독 실행만으로 이미 판정선의 92%).
- 재현율: 루트 전체 1/1(`m-root-1.log`, `expected 133.227264 to be less than 100`). 단독 0/10, CPU 부하 0/10.

수정: 응답성 상한을 1초로 올리고 상수·근거 주석으로 고정했다(`09-testing.md` 9.7 예외 2, 선례는
`run-driver-pyodide.test.ts`의 1초 판정과 `sigint-handler-idle.test.ts`의 `WAKE_LIMIT_MS`).

- `sigint-handler-sleep-slice.test.ts`: `PRESS_LIMIT_MS = 1000` 4곳(옛 100ms 3곳·200ms 1곳). 시험 제목의 `100ms`도 `1초`로 고쳤다.
- `boot.test.ts`: `WATCH_LIMIT_MS = 1000` 2곳(옛 200ms·100ms). 제목 2개도 같이 고쳤다.
- 손대지 않은 것: `run-source.test.ts:250`(1100ms), `run-driver-pyodide.test.ts:315`(1000ms), `sigint-handler-idle.test.ts`
  (`200·300 + WAKE_LIMIT_MS 1000`) — 이미 여유가 크고 실패 관찰이 없다.

검출력 확인(변이 검사, 상한을 올려도 회귀를 잡는지):

- M1 `SLEEP_SLICE = 3600.0`(폴링 제거): 시험이 멈춰 10분 안에 끝나지 않았다 → 멈춤 변이로 killed 판정하고 원복했다.
  조각 없는 `time.sleep(2**31)`은 워커를 동기 블로킹해 vitest 타임아웃도 듣지 않는다.
- M2 `SLEEP_SLICE = 1.5`(폴링은 살아 있고 느려짐): 4건 실패, 그중 3건을 **새 1000ms 상한이 잡았다**
  (`expected 1207.48/1302.57/1302.31 to be less than 1000`). killed.
- M3 `interrupt-watch.ts`의 `tickMs = 1500`: 3건 실패, 그중 2건을 새 상한이 잡았다
  (`expected 1397.35/1517.43 to be less than 1000`). killed.

검증: `pnpm check-types`·`pnpm lint` 통과, 루트 `pnpm test --force --concurrency=1` 21/21 태스크 통과
(`verify.log`, 직전 같은 명령 1회차는 이 시험에서 실패했다).

## 옛 재개 조건(충족하지 않은 채로 남긴다)

- "같은 파일을 단독으로 N=10 돌려 1회 이상 재현" → 단독 0/10, CPU 부하 0/10으로 **미충족**이다. 대신
  `docs/agents/issue-tracker.md` `open` 기준 2("결함 없는 코드에서 판정이 실패한다 — 거짓 실패 재현")를 루트 전체 실행 1/1로
  충족해 승격·수정했다(사용자 확정 2026-09-25).

## 참고

- 관찰 당시 변경은 `time.sleep` 조각 교체 코드(`worker/sleep-slice.py` 동작)를 바꾸지 않고 보고 호출(`warn` → `report`)만 교체한 것이라 이 시험의 대상 동작은 그대로였다. 병렬 부하에서 눌림 복귀 여유(100ms)가 좁은 시간 판정으로 보인다(추정, 미검증). 시간 판정 규칙은 `docs/design/09-testing.md` 9.7.
- 원시 로그는 남기지 않았다(실패 메시지만 기록). 재현되면 그때의 로그 경로를 `## Comments`에 적는다.

## Comments

- 2026-09-24 RD-022 추가 관찰(분류는 `deferred` 유지): 부품 이동(repl → terminal) 뒤 루트 `pnpm test --force`(기본 병렬도)를 2회 돌렸고 둘 다 같은 파일에서 실패했다(1회차 `time.sleep(5) 도중의 눌림이 100ms 안에…` 133.97ms·`time.sleep(2**31)…` 107.08ms, 2회차 같은 파일의 다른 시험 3건). 이동 **전** 커밋(`git worktree`로 뗀 HEAD)에서 같은 명령이 1건·3건 실패해 이동과 무관함을 확인했다. 단독 실행은 3/3 통과했다. 이 이슈의 재개 조건(같은 파일 단독 N=10에서 1회 이상 재현)은 충족하지 못했으므로 `open`으로 바꾸지 않았다. 병렬 부하에서는 이동 전 커밋에서도 2/2 재현이므로(원인은 결정적 결함이 아니라 100ms 고정 상한 대비 CPU 포화로 추정) 재분류(`open`)는 사용자 판단으로 남긴다. 실무 규칙: L0 판정은 `pnpm test --force --concurrency=1`(15 태스크 통과, `docs/design/09-testing.md` 9.1). 로그: `_works/_completed/20260924-26-rd-022-run-driver-terminal/verify/l0-delta05-head-parallel-run{1,2}.log`(이동 전), `l0-delta05-test-run{1,2}-flaky.log`(이동 뒤), `sleep-slice-rerun-delta05.log`(단독 3/3).
- 2026-09-24 RD-022a 추가 관찰(분류는 `deferred` 유지): 루트 `pnpm test --force`(기본 병렬도) 1회에서 같은 파일 3건이 실패했다(`time.sleep(5) 도중의 눌림이 100ms 안에…` 126.99ms, `time.sleep(2**31)도…` 111.24ms, `__index__ 객체도…` 120.74ms). 이 브랜치의 변경(core `exec_in_console` 분리, 벤더 `takeRead`, REPL `runSource`)은 `sleep-slice.py`·SIGINT 계층을 바꾸지 않는다. turbo가 실패로 core 시험을 중단해 core 시험 수는 이 실행에서 나오지 않았다. 같은 파일 단독 실행은 26/26 통과했고 `pnpm test --force --concurrency=1`은 15 태스크 전부 통과(1948 시험)했다. 재개 조건(단독 N=10 재현)은 충족하지 못했다. 로그: `_works/_completed/20260924-27-rd-022a-repl-run-source/verify/l0-delta06-test.log`(병렬 실패), `l0-delta06-sleep-slice-solo.log`(단독 통과), `l0-delta06-test-concurrency1.log`(통과).
- 2026-09-24 RD-022b 추가 관찰(분류는 `deferred` 유지): 이번에는 **`--concurrency=1`에서도** 실패했다(이전 관찰은 모두 기본 병렬도). (1) 루트 `pnpm test --concurrency=1`(`--force` 없음) 1회차 같은 파일 2건 실패 — `time.sleep(5) 도중의 눌림이 100ms 안에…` 110.55ms, `time.sleep(2**31)도…` 133.30ms(`_works/_completed/20260924-28-rd-022b-bg-output-above-read/verify/l0-delta01-root-test.log`). 같은 파일 단독 26/26(`l0-delta01-sleep-slice-solo.log`), 이어 `pnpm test --force --concurrency=1` 15/15 태스크·1992 시험 통과(`l0-delta01-root-test-run2.log`). (2) 다른 변경 뒤 루트 `pnpm test --force --concurrency=1` 1회차 1건 실패 — `time.sleep(5) 도중의 눌림이…` 119.99ms(`l0-delta02-root-test.log`), 단독 26/26(`l0-delta02-sleep-slice-solo.log`), 2회차 15/15(`l0-delta02-root-test-run2.log`). 두 변경 모두 벤더 `xterm-readline`·terminal sink·repl main 쪽이고 `sleep-slice.py`·SIGINT 계층은 건드리지 않았다. 재개 조건(단독 N=10 재현)은 충족하지 않았다. "L0 판정은 `--concurrency=1`" 규칙으로도 1회차 실패가 날 수 있다는 점만 새로 확인됐다.
- 2026-09-25 RD-024 DELTA-04 추가 관찰(분류는 `deferred` 유지): 루트 `pnpm test --force`(기본 병렬도) 1회에서 같은 파일 2건이 실패했다(`time.sleep(5) 도중의 눌림이 100ms 안에…`·`time.sleep(2**31)도…`). 이 브랜치는 `packages/pyodide-repl`을 바꾸지 않았다(react 패키지·`scripts/pack-smoke.mjs`만). 같은 파일 단독 26/26, 이어 루트 `pnpm test`(`--force` 없음) 18/18 통과. 재개 조건(단독 N=10 재현)은 충족하지 못했다.
- 2026-09-25 REPL 리셋 새 buffer 수정 작업 추가 관찰(분류는 `deferred` 유지): (1) DELTA-02 루트 `pnpm test`(기본 병렬도) 1회차에서 repl 2건 실패(`time.sleep(2**31)도 조각돼 눌림에 끊긴다` `afterPressMs` 115.06 < 100 포함)와 core test ELIFECYCLE가 났고, `--concurrency=1` 18/18·병렬 재실행 18/18이었다. (2) DELTA-04 최종 확인 루트 `pnpm test`(기본 병렬도) 1회차에서 같은 파일 1건 실패(`time.sleep(5) 도중의 눌림이 100ms 안에 KeyboardInterrupt로 끊는다` 102.98 < 100), 이어 `pnpm test --concurrency=1` 18/18 통과. 이 브랜치의 변경(`packages/pyodide-repl/src/{index,session}.ts`, 시험, core 주석)은 `sleep-slice.py`·SIGINT 계층을 바꾸지 않는다. 같은 파일 단독 N=10은 돌리지 않았고(재개 조건 미충족) 조사하지 않았다. 로그: `_works/_completed/20260925-30-repl-reset-fresh-interrupt-buffer/verify/delta-04/test-parallel-flaky.log`(병렬 실패), `verify/delta-04/test-concurrency1.log`(통과). (1)의 원시 로그는 남기지 않았고 같은 작업 폴더 `DELTA-02.md` 결과에 요지만 있다.
- 2026-09-25 RD-023 추가 관찰(분류는 `deferred` 유지): 이 브랜치는 core(`plugins`·init 버퍼링)·새 패키지·scripts·demo·문서를 바꿨고 `packages/pyodide-repl`·`sleep-slice.py`·SIGINT 계층은 바꾸지 않았다. (1) DELTA-01 루트 `pnpm test --force`(기본 병렬도)가 2회 연속 실패했다: 1회차 `sigint-handler-sleep-slice` 1건(`time.sleep(5) 도중의 눌림이…` 106ms > 100 포함)·`sigint-handler-idle`(05)·`sigint-handler`(06), 2회차 같은 파일 2건. 변경 전 커밋(`git stash`)의 같은 명령도 같은 파일 2건이 실패했다(`_works/_completed/20260925-32-rd-023-dom-bridge/verify/delta01-l0-baseline-test-force-prefix.log`, 병합 뒤 이동 예정 경로). 병렬 부하 재현율 2/2(변경 전 포함 3/3)이고 `pnpm --filter @cp949/runo-pyodide-repl test` 단독은 1106/1106, `pnpm test --force --concurrency=1`은 18/18이었다. (2) DELTA-02 `--concurrency=1` 3회 중 1회차 `__index__ 객체도 조각돼 눌림에 끊긴다` `expected 103.68 to be less than 100`(`.../verify/delta02/l0-test-force-concurrency1.log`), 2회차는 core 시험 1건 실패(07), 3회차는 18/18이었다. 단독 N=10은 돌리지 않았고 재개 조건은 충족하지 못했다.
- 2026-09-25 RD-026 DELTA-01 추가 관찰(분류는 `deferred` 유지): 이 브랜치는 벤더 `tty.ts`·core `output-tail.ts`·시험·e2e 스크립트를 바꾸었고 `sleep-slice.py`·SIGINT 계층은 바꾸지 않았다. 루트 `pnpm test --force --concurrency=1` 2회 중 1회차(같은 코드, check-types만 실패한 통과 전 시도)는 통과했고 2회차에서 `time.sleep(5) 도중의 눌림이 100ms 안에 KeyboardInterrupt로 끊는다`가 `expected 112.48 to be less than 100`으로 1건 실패했다(repl 1109/1110). 같은 파일 단독 26/26 통과. 로그: `_works/20260925-34-rd-026-redraw-window/verify/delta01-l0.log`(2회차), `delta01-l0-first-attempt.log`(1회차), `delta01-l0-flake-rerun.log`(단독 재실행). 재개 조건(N=10 단독) 미충족이라 조사하지 않았다.
- 2026-09-25 RD-026 DELTA-02 추가 관찰(분류는 `deferred` 유지): 이 브랜치의 이번 변경은 벤더 `readline.ts`(`onResize` 가드)·시험·e2e 스크립트이고 `sleep-slice.py`·SIGINT 계층은 바꾸지 않았다. 루트 `pnpm test --force --concurrency=1`이 2회 모두 `time.sleep(5) 도중의 눌림이 100ms 안에 KeyboardInterrupt로 끊는다` 1건만 실패했다(1회차 `expected 135.57 to be less than 100`, 2회차는 `--continue`로 다른 패키지까지 돌려 repl 1109/1110만 실패, 나머지 패키지 전부 통과). 같은 파일 단독 26/26 통과. 로그: `_works/20260925-34-rd-026-redraw-window/verify/delta02-l0.log`(1회차), `delta02-l0-test-continue.log`(2회차 요약), `delta02-l0-flake-rerun.log`(단독 재실행). 재개 조건(N=10 단독) 미충족이라 조사하지 않았다.
