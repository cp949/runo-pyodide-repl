# runner-check R01 간헐 실패: `input()` 뒤 `print` 행이 결과·ready 뒤에도 없음

Status: deferred
Origin: terminal-surface 작업의 L1 실행(dev 분기 브랜치, 2026-09-26). 원인 미조사.

## 현상

`pnpm --filter demo e2e:runner-check` 첫 실행 15/16에서 R01만 실패했다(`pageErrors` 0·`problemLogs` 0). `input("이름: ")` 뒤 `kim`+Enter 입력에서 결과 `ok`·상태 `ready`까지 통과한 뒤 행 조회가 `["이름: kim"]`이었고 기대는 `["이름: kim", "안녕 kim"]`이다. R02~R13은 통과했다. 소스 변경 없이 1회 재실행하면 16/16이었다(1/2회 실패).

## 미확인 가설(조사 0회)

1. 스크립트가 결과·ready 직후 `h.trimmedRows`를 읽는데 xterm의 write 파싱이 타이머로 미뤄져 마지막 행이 아직 반영되지 않았다(스크립트 쪽 경합).
2. terminal 실행창의 surface 전환이 만든 회귀. 재실행 통과로 가능성은 낮지만 전환 전 코드와 대조하지 않아 배제하지 못했다.

## 완료 기준

원인을 확정하고, 스크립트 경합이면 행 조회를 조건 대기(폴링)로 바꿔 결함 없는 코드에서 거짓 실패가 없어야 한다(`docs/design/09-testing.md` 9.7). 제품 결함이면 재현 시나리오와 수정.

## 재개 조건

`runner-check` 단독 실행 N=10에서 R01이 1회 이상 다시 실패할 때. 그 전에는 조사하지 않는다.

## Comments

- 등록 시점 분류: 1회 관찰·원인 불명 간헐 실패이므로 `docs/agents/issue-tracker.md` "등록·분류 기준"의 `deferred`. 원시 로그는 작업 폴더 `verify/l1-runner-check.log`·`l1-runner-check-rerun1.log`(작업 완료 후 `_works/_completed/20260926-40-terminal-surface/verify/`).
