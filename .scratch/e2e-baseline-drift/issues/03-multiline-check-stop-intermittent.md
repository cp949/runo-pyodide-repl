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
