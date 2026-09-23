# 03 `multiline-check.mjs` dev `stop:` 확인이 간헐적으로 실패한다(4회 중 1회)

Status: open

## 현상

2026-09-24, chromium, `node apps/demo/e2e/run.mjs baseline` 4회 중 1회(`repl-check.mjs` 기대값 임시 변조 양성 대조 실행,
`multiline-check.mjs`·데모 코드는 무변경)에서 `multiline-check-dev.json` 17/18:

```
stop: exit() 뒤 나머지 문장은 실행하지 않고 terminated Alert가 뜬다 — "1"이 안 보인다 —
["Traceback (most recent call last):", ..., "ZeroDivisionError: division by zero", ">>> print(1)", "exit()", "print(2)"]
```

`pageErrors` 0. 같은 날 다른 baseline 3회는 18/18. 등록 편차(01·02) 밖.

## 가설(미검증)

앞 셀의 트레이스백 출력 직후 붙여넣은 다중 행의 첫 문장 `print(1)` 출력을 기다리는 타이밍. 판정 스크립트 쪽 대기
부족인지 제품 동작(붙여넣기 직후 실행 누락)인지 구분되지 않았다.

## 다음에 이어받을 때

전체 baseline을 반복하지 말고 `pnpm --filter demo e2e:multiline`을 dev 서버에 단독으로 돌려 재현 빈도를 먼저 본다
(`docs/agents/rubber-workflow.md` "검증 실행 예산"). 재현되면 `stop:` 셀 직전 출력 대기 조건을 확인한다.

## Comments

- 2026-09-24 재분류: `deferred`(`docs/agents/issue-tracker.md` "등록·분류 기준"). 4회 중 1회 관찰, 원인 미상(판정 대기 부족인지 제품 동작인지 미구분). 원시 결과: 본문 인용. 재개 조건: 이후 L1·L2 실행에서 `stop:` 실패가 다시 관찰되면 `open`. 그 전에는 조사하지 않는다.
- 2026-09-24 재개(`deferred` → `open`, 재개 조건 충족): RD-016 반영 뒤 `dev` `65b1640` 전체 `e2e:baseline`(사용자 지시 L2) 1회에서 같은
  셀이 같은 화면으로 실패했다 — `multiline-check-dev.json` 17/18, `["Traceback …","ZeroDivisionError: division by zero",">>> print(1)","exit()","print(2)"]`,
  `pageErrors` 0. 같은 날 전체 실행 누계 6회 중 2회(이 이슈 등록 때 4회 중 1회 + 이후 2회 중 1회). 첫 관찰은 RD-016·편차 22 수정 전이라 두 변경의 회귀가 아니다.
  관찰: 셀은 `waitFor(status === "terminated")`를 **통과한 뒤** `tail(6)`을 한 번 읽는다(`checks/multiline-check.mjs:148-157`). 즉 `exit()`는 실행됐고
  읽은 시점에 `1` 출력 행이 화면에 없었다. 가설(미검증): (A) 판정 대기 부족 — 상태 DOM 갱신이 xterm의 `1` 쓰기 렌더보다 먼저 보인다(9.7 "존재 확인은
  조건 대기" 위반 셀). (B) 제품 결함 — 세션 종료 처리 중 직전 stdout이 버려진다. 구분 방법: `1` 행을 `waitFor`로 기다리게 고친다 — (A)면 통과, (B)면
  시간 초과로 여전히 실패한다.
