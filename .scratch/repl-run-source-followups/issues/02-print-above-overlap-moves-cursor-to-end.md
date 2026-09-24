# 겹친 `printAbove` 두 번이 커서를 끝으로 옮긴다(벤더 기존 결함)

Status: promoted (RD-022b)
Origin: RD-022a 벤더 `takeRead` 조사 중 실측. 이번 RD가 만든 결함이 아니다.

## 현상

스텁 터미널에서 `read("> ")` → `abc` 입력 → `←` 1회(커서 2) → 재그리기 콜백을 미룬 채 `printAbove("A")`, `printAbove("B")` → 콜백을 순서대로 실행하면 `getCursor()`가 2가 아니라 3(끝)이다.

원인(추정, 코드 읽기): 두 번째 호출이 `state.cursor()`를 저장할 때 첫 호출의 `moveCursorToEnd()`가 이미 `line.pos`를 끝으로 옮긴 뒤라 끝 값을 저장하고, 그 콜백의 `restoreCursor`가 첫 콜백이 되돌린 값을 덮어쓴다. `takeRead`용 `redrawCursor`에는 "겹친 호출은 처음 값 유지"를 적용했지만(`packages/xterm-readline/src/readline.ts`) `printAbove` 자체는 고치지 않았다.

실경로에서는 재그리기 promise를 기다린 뒤 다음 호출을 하는 Tab 리더(`terminal/tab-reader.ts`)만 `printAbove`를 부르므로 겹치지 않는다.

## 완료 기준

위 시나리오에서 두 콜백이 끝난 뒤 `getCursor()`가 2다. 벤더 `print-above.test.ts`에 재현 시험이 있고 기존 시험이 그대로 통과한다.

## 재개 조건

`printAbove`를 재그리기 완료 전에 다시 부르는 소비자가 생길 때(RD-024 React 래퍼 등).

## Comments

- 2026-09-24 등록 시점 분류: 스텁 터미널에서 실측 재현했지만 실경로에서 닿지 않아 사용자 시나리오가 없다. `deferred`.

- 2026-09-24 재개 조건 충족: RD-022b가 열린 읽기 중 배경 출력을 같은 재그리기 상태(`redrawing`)로 보내므로 Tab `printAbove`와 겹칠 수 있다. 사용자 결정(그릴링 Q8)으로 RD-022b 범위에 넣었다. 완료 기준은 이 이슈 본문 그대로다.
