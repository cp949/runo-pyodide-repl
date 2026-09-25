# 06 `sigint-handler.test.ts`의 `눌림 20회` 시험이 `expected '19\n' to be '20\n'`로 간헐 실패한다

Status: deferred
Origin: RD-023(2026-09-25). 이슈 01 `## 해결`·이슈 03 "참고(별개 현상)"가 "재발하면 이 폴더에 별도 이슈로 등록한다"고 적은 현상이다. 원인 미조사.

## 현상

`packages/pyodide-repl/src/worker/sigint-handler.test.ts`의 눌림 스레드 시험이 20회 눌림 중 1회를 세지 못하고 실패한다(기대 `"20\n"`, 수신 `"19\n"`).

- 이슈 01 작업 중(2026-09-23): 변경 전 10회 중 1회, 변경 후 5회 중 1회(`sigint-handler.test.ts:368`, `stdin-callback.test.ts`와 병렬 실행).
- RD-023 DELTA-01(2026-09-25): 루트 `pnpm test --force`(기본 병렬도) 1회차 1건. 시험 `KeyboardInterrupt를 잡고 세는 루프에 25ms 간격 20회 → 정확히 20(누락·이중 0)`(원시 로그 `_works/_completed/20260925-32-rd-023-dom-bridge/verify/delta01-l0-pnpm-test---force.log`, 병합 뒤 이동 예정 경로).
- RD-023 DELTA-04 마무리(2026-09-25): 루트 `pnpm test --force --concurrency=1` 1회차 1건, 시험 `눌림 스레드 > 눌림 20회 사이에 같은 번호의 재도착 5회가 섞여도 정확히 20`이 `expected '19\n' to be '20\n'`. 같은 명령 재실행은 21/21 통과했다(`.../verify/delta04/fix4/l0-test-1st-flaky-sigint.log`).

RD-023 브랜치는 `packages/pyodide-repl`을 바꾸지 않았다. 세 관찰 모두 이 시험의 대상 경로와 무관한 변경 중에 났다. 병렬 부하에서만 나는 것은 아니다(`--concurrency=1`에서도 관찰).

## 재개 조건

같은 파일 단독 N=10에서 1회 이상 재현되거나 같은 단언 실패가 다시 관찰되면 `open`으로 바꾸고 원시 stderr를 보존한다. 눌림 처리 위치는 폴링 위상에 좌우되므로(`docs/traps/TRP-030-natural-repro-zero-under-sigint-polling-phase.md`) "지금 안 난다"를 "고쳐졌다"로 읽지 않는다. 그 전에는 원인을 조사하지 않는다(`docs/agents/issue-tracker.md` "등록·분류 기준").

## Comments

- 2026-09-25 등록 시점 분류: 원인 불명 간헐 실패 → `deferred`. 같은 폴더 04·05(병렬·`--concurrency=1` 시간 판정·SIGINT 위치 계열)와 같은 실행에서 함께 관찰됐다.
