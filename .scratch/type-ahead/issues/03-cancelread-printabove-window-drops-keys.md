# cancelRead 뒤 printAbove 재그리기 콜백 전 창에서 친 키가 유실된다

Status: open
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
- 2026-09-24 `deferred` → `open` 재분류(사용자 결정, `docs/agents/issue-tracker.md` 재개 조건의 예외). 재개 조건 중 "재현 가능한 사용자 시나리오"는 **충족되지 않는다**: 유실은 Tab 후보 목록 재그리기 대기 중 리셋(마우스 클릭)이 일어나고 수 ms 안에 키가 도착해야 하는 경우뿐이다. 재개 사유는 불변식 정합이다 — `cancelRead()` 뒤에 친 키는 새 맥락의 키라 type-ahead가 보존해야 한다. 재현은 벤더 단위 시험(RED)으로만 확인한다. 시험이 RED가 아니면 구현을 멈추고 사용자가 재분류(`wontfix`·`deferred`)를 정한다.
- 2026-09-24 그릴링 확정(Q1~Q5 전부 추천안). 처리 경로는 이 이슈 기준 rubber-workflow 소규모 실행(ROADMAP RD 없음). 수정은 `cancelRead()`가 `redrawing = false`, `queued = []`도 정리하는 방식이다(취소 이전 키는 폐기, 이후 키는 `typeAhead`). `printAbove` 콜백의 취소 분기·`dispose()`·코어는 바꾸지 않는다. 검증은 L0(벤더 단위 시험 4건, RED → GREEN)만이고 브라우저 L1은 하지 않는다(수 ms 창을 재현할 안정적 수단이 없음). 계획서는 `_works/20260924-24-cancelread-printabove-window/`(브랜치 `cancelread-printabove-window`), 구현은 다른 에이전트가 맡는다.
