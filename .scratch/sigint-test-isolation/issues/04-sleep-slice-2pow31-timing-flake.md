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
