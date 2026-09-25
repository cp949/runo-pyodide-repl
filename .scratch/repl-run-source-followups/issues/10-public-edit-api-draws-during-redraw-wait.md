# 재그리기 대기 중 리사이즈(`onResize`)가 화면에 없는 입력줄을 그린다

Status: open
Origin: RD-022b 벤더 `printAboveRaw` 구현 중 코드 읽기. 2026-09-25 RD-022b 리뷰 반영 뒤 범위를 리사이즈로 줄였다(아래 Comments).

## 현상

`printAbove`·`printAboveRaw`의 write 콜백을 기다리는 동안(`redrawing`) 벤더 `onResize` 핸들러(`packages/xterm-readline/src/readline.ts` `activate`)는 활성 읽기가 있으면 곧바로 `state.refresh()`를 부른다(RD-015부터 있던 경로). `printAboveRaw` 뒤에는 입력줄이 지워지고 레이아웃이 초기화돼 있어, 출력 아래 행에 입력줄을 먼저 그리고 콜백이 그 자리에서 다시 그린다. 감긴 입력은 첫 행이 흔적으로 남는다.

재현(second-opinion SO-V2, 벤더 `StubTerminal`에 `onResize` 핸들러 호출을 더한 하니스): cols 10, `read("> ")` → `abcdefghijkl` → `asyncWrite = true` → `printAboveRaw("t\n", "")` → resize 이벤트(같은 크기) → `flush()`.

- 실제: 화면에 `> abcdefgh` 2번
- 기대: `t` / `> abcdefgh` / `ijkl`(`> abcdefgh` 1번)

공개 편집 API(`editInsert`·`editBackspace`·`updateLine`) 부분은 RD-022b 리뷰 반영에서 고쳤다: 재그리기 대기 중에는 그리지 않고 저장 커서 자리의 버퍼만 고친다(`docs/design/06-editing.md` 6.1, 벤더 `print-above-raw.test.ts` "재그리기 대기 중 공개 편집 API"). 리사이즈는 그 수정이 닿지 않는 별도 경로다.

## 완료 기준

위 재현의 벤더 jsdom 시험에서 `> abcdefgh`가 한 번이고 콜백 뒤 커서가 원래 위치다. 수정 후보: `onResize`가 재그리기 대기 중이면 `tty` 크기만 갱신하고 `refresh()`를 생략한다(콜백의 `refresh()`가 새 크기로 그린다).

## 재개 조건

배경 출력 직후 창 크기 변경(fit 애드온 등)에서 입력줄 흔적 행이 관찰될 때.

## Comments

- 2026-09-24 등록 시점 분류: 코드 읽기 1회 관찰, 재현 시험·사용자 시나리오 없음 → `deferred`.
- 2026-09-25 범위 재정의: RD-022b 독립 리뷰가 공개 편집 경로의 결함을 재현했다(Tab 완성 삽입이 배경 출력 재그리기 콜백 전에 오면 커서가 삽입 전으로 되돌아가 제출 줄 `imp osort`, 기대 `import os`). 벤더가 재그리기 대기 중 공개 편집 API를 버퍼에만 반영하고 저장 커서를 편집 뒤로 옮기도록 고쳤다(시험: 벤더 `print-above-raw.test.ts` "재그리기 대기 중 공개 편집 API" 11개, repl `run-source.test.ts` "Tab 완성 응답과 배경 출력 재그리기의 겹침" 2개. 근거 로그 `_works/_completed/20260924-28-rd-022b-bg-output-above-read/verify/red-delta05b.log`, 변이 `mutations-delta05b-vendor.log` 13/13 killed). 감긴 입력 `editInsert` 흔적 행 가설은 리뷰에서 미재현. 남은 범위는 리사이즈(SO-V2, 수정 뒤에도 재현 — `verify/so-vendor-after-delta05b.log`)라 제목·현상·완료 기준을 그것으로 바꾸고 `deferred`를 유지한다.
- 2026-09-25 재분류 `deferred` → `open` (RD-026 승격): RD-024가 `fit` 기본값 `true`로 `ResizeObserver` 리사이즈를 실사용 경로로 만들었다(등록 시점에 없던 조건). `?fit=1` + 배경 출력 + 창 크기 변경의 L1 확인 셀로 관찰할 수 있다. 추적은 `ROADMAP.md` RD-026.
