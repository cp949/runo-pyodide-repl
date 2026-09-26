# 부하 아래에서 시간 의존 시험 1건이 흔들렸다("25ms 간격 20회 → 정확히 20")

Status: deferred
Origin: terminal-surface 작업의 변이 검사 중 1회 관찰. 원인 미조사.

## 현상

`packages/pyodide-repl/src/worker/sigint-handler.test.ts`의 "KeyboardInterrupt를 잡고 세는 루프에 25ms 간격 20회 → 정확히 20(누락·이중 0)"이 옵션과 무관한 변이(`createRepl`의 `copyOnSelect` 전달 삭제) 실행에서 신규 시험과 함께 실패했다. 같은 시험은 다른 변이 7회 실행과 전체 repl 1120건 정상 실행에서는 통과했다. 변이 검사 중 vitest가 다른 프로세스와 CPU를 나눴을 가능성은 추정이고 재현은 시도하지 않았다.

## 완료 기준

부하 아래에서 같은 시험이 실패하는 조건(동시 실행 프로세스 수·워커 수)을 측정하고, 실패한다면 `docs/design/09-testing.md` 9.7 기준(고정 대기·절대 ms 상한 금지)에 맞게 판정을 고친다. 결함 있는 코드에서 실패하는 검출력은 유지한다.

## 재개 조건

변이 검사나 루트 `pnpm test` 단독 실행 중 같은 시험이 다시 실패할 때. 그 전에는 조사하지 않는다.

## Comments

- 등록 시점 분류: 1회 관찰된 원인 불명 간헐 실패이므로 `docs/agents/issue-tracker.md` "등록·분류 기준"의 `deferred`.
