# 01 붙여넣기 덩어리 안 취소 가능한 Ctrl+C 뒤의 글자가 끝난 읽기의 입력 상태에 들어가 화면에 찍힌다

Status: deferred
Origin: readline 읽기 종료 작업(2026-09-26, 브랜치 `readline-read-end`)의 벤더 Ctrl+C 경로 바이트 대조 중 발견. 이 작업이 만든 결함이 아니다(변경 전후 바이트 동일).

## 현상

벤더 `Readline`에서 `read("> ", { cancelable: true })` 뒤 `onData("ab\x03cd")`를 한 덩어리로 넣으면 읽기는 `null`로 끝나지만 화면은 `"> ab"` / `"cd"`, 커서 `[1, 2]`다. `cd`가
끝난 읽기 아래 행에 그려진다(jsdom `StubTerminal` + `VTerm`, 결정적 재현).

## 원인(코드 읽기, 미검증)

`readPaste()`가 토큰 루프 중 `readKey()`가 활성 읽기를 끝내도 멈추지 않고 남은 `Text` 토큰을 `this.state.editInsert()`로 옛 상태에 넣는다(`activeRead` 확인 없음). 붙여넣기의
Enter는 `Text("\n")`으로 바뀌므로 Enter로는 생기지 않고, 붙여넣기 안 Ctrl+C(취소 가능한 읽기)에서만 생긴다.

## 재현 조건(사용자 시나리오)

취소 가능한 읽기(실행창 `input()`·REPL `input()`·REPL 취소 가능한 읽기)에 `\x03`이 섞인 텍스트를 붙여넣거나, 읽기 밖에서 `\x03` 섞인 다중 토큰 덩어리가 type-ahead로 쌓였다가
재생될 때. 실사용 빈도 낮음. 실제 xterm 붙여넣기가 `\x03`을 그대로 넘기는지는 브라우저에서 확인하지 않았다.

## 왜 deferred인가

- 완료 기준을 정할 사양이 없다: Ctrl+C 뒤 남은 글자를 버릴지, type-ahead로 넘겨 다음 읽기가 받을지 정하지 않았다(`docs/agents/issue-tracker.md` "등록·분류 기준" — `open`은
  관찰 가능한 완료 기준이 있어야 한다).
- 사용자 영향이 작고 사용자 보고가 없다.

## 재개 조건

사용자 보고가 있거나, 붙여넣기 안 Ctrl+C 뒤 남은 입력의 처리(버림/type-ahead)를 사양으로 정할 때 `open`으로 바꾼다. 그때 벤더 시험(`type-ahead.test.ts`·`cancel.test.ts` 계열)에
`onData("ab\x03cd")` 화면·다음 읽기 단언으로 RED를 먼저 만든다.

## Comments

- 2026-09-26 등록 시점 분류: 결정적 재현은 있으나 기대 동작 미정·사용자 영향 작음 → `deferred`.
