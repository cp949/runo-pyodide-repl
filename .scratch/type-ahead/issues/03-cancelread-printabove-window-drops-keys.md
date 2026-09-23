# cancelRead 뒤 printAbove 재그리기 콜백 전 창에서 친 키가 유실된다

Status: deferred
Origin: RD-019 벤더 `Readline` 버퍼 구현 중 코드 읽기로 발견(재현 시험 미작성, 브라우저 미관찰).

## 현상(코드 읽기 기준)

`printAbove`가 `redrawing = true`로 write 콜백을 기다리는 중에 `cancelRead()`가 끝나면, 콜백이 오기 전에 도착한 키는 `readData`의 `redrawing` 분기로 `queued`에 들어가고 콜백의
`activeRead === undefined` 분기가 `queued = []`로 버린다. type-ahead 버퍼로 가지 않으므로 다음 읽기가 받지 못한다. 창은 write 콜백 한 번(수 ms)이고, 리셋은 새 프로세스라
`cancelRead()` 이전 키는 어차피 폐기 대상이라 `cancelRead()` 뒤에 친 키만 문제다.

## 재개 조건

벤더 단위 시험(`printAbove` → `cancelRead()` → 콜백 전 `feed`)으로 유실이 재현되고, 리셋 직후 사용자가 그 창에서 키를 치는 시나리오가 확인되면 `open`으로 바꾼다.
그 전에는 조사하지 않는다(코드 읽기로만 추정, 완료 조건·기존 판정에 영향 없음, `docs/agents/issue-tracker.md` "등록·분류 기준").

## Comments

- 2026-09-24 등록 시점 분류: 재현 가능한 사용자 시나리오가 없어(시험 미작성) `deferred`.
