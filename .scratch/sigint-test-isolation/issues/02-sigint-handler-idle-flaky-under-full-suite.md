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
