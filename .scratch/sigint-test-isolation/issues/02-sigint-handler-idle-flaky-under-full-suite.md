# 02 `sigint-handler-idle.test.ts`의 시험 2건이 전체 스위트 병렬 실행에서 가끔 실패한다

Status: open

## 현상

RD-013 DELTA-03 검증 중(2026-09-23) `pnpm test`(루트, 전체 스위트) 반복 실행에서
`packages/pyodide-repl/src/worker/sigint-handler-idle.test.ts`의 시험이 회차마다 다른 것 1건씩 실패했다.

- 1차: `정지한 run_sync 루프의 콜백이 소비한 SIGINT도 루프를 끊는다` — `screen.stderr`에 예상 밖
  `Exception in callback _set_result_unless_cancelled() at .../asyncio/futures.py:319` +
  `asyncio.exceptions.InvalidStateError: invalid state` 노이즈가 섞여 기대 트레이스백과 달랐다.
- 2차: 다른 시험 1건이 `screen.stderr`의 `KeyboardInterrupt\n$` 매치에서 실패(`pressed count 1` 관련 단언).

같은 시험을 단독으로 돌리면(`vitest run sigint-handler-idle -t "..."`) 항상 통과하고, 전체 스위트를
바로 재실행해도 대부분 통과한다(재현율은 낮음, 1~2회 반복에 한 번꼴로 추정).

## 왜 지금은 크게 안 보이나

간헐적이라 개별 PR 검증에서는 대체로 통과하고 넘어간다. `_works/20260923-14-rd-013-auto-indent/pending-issues/01.md`에서
처음 관찰했다.

## 판단 근거

RD-013(자동 들여쓰기) 범위와 무관한 파일이라 그 RD에서는 다루지 않고 여기 등록만 한다. 타이밍 경계 근처의
비동기 폴링/타이머 시험으로 추정되나 근본 원인은 미조사. 다음에 `sigint-handler-idle.test.ts`를 만지거나
반복 재현되면 원인을 좁힌다(전체 스위트 병렬 실행에서만 나는 것으로 보아 리소스 경합·타이밍 문턱 후보).

## Comments

- (2026-09-23, RD-017 DELTA-02 리뷰) 위 "판단 근거"의 전제가 틀렸다는 것을 실측으로 확인했다: **단독
  실행이 오히려 더 자주 실패한다**(단독 5회 중 4회 실패 vs 전체 스위트 3회 중 1회 실패) — "전체 스위트
  병렬 실행에서만 나는 리소스 경합"이 아니다. 오류 문구는 `asyncio.exceptions.InvalidStateError: invalid
  state`로, 타이밍 문턱보다 Pyodide asyncio 내부 경쟁 조건으로 보인다. RD-017 변경(커밋 `79ccdb0` 이전
  코드에서도 재현)과는 무관 — RD-017 범위 밖이라 이 라운드에서 고치지 않는다. 다음에 이 파일을 만질 때는
  "전체 스위트에서만" 가설을 버리고 단독 실행 반복(N≥5)으로 재현율부터 다시 잰다.
