# 겹친 `printAbove` 두 번이 커서를 끝으로 옮긴다(벤더 기존 결함)

Status: done
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

- 2026-09-24 RD-022b 구현으로 종결(`Status: done`). 원인은 본문 추정대로였다: 겹친 두 번째 `printAbove`가 첫 호출의 `moveCursorToEnd()`로 끝으로 옮겨진 커서를 저장하고 자기 콜백에서 그 값으로 되돌렸다. 수정: 재그리기 하나(`RedrawRun`)에 겹친 호출이 합류하고, 저장 커서(`redrawCursor`)는 처음 값 하나이며, 마지막 호출의 콜백만 다시 그리고 모든 프로미스는 그 뒤 resolve한다. 재그리기 대기 중 `printAbove`는 `moveCursorToEnd()`를 부르지 않고 앞 `\r\n` 없이 쓴다(겹친 Tab 두 번 사이의 빈 행도 사라졌다 — 이를 단정한 기존 시험은 없었다). 설계: `docs/design/06-editing.md` 6.1.
  - 완료 기준 시험은 본문 문구의 `print-above.test.ts`가 아니라 새 파일 `packages/xterm-readline/src/print-above-raw.test.ts` "겹친 printAbove 두 번 뒤에도 커서는 처음 위치다"에 뒀다(`getCursor() === 2`, 화면 `> abc` / `A` / `B` / `> abc`). 기존 시험 파일 수정 0을 RD-022b 완료 조건으로 지키기 위해서다. 기존 `print-above.test.ts` 등은 제목·단정 변경 없이 통과했다(`vitest list` 전후 사라진 제목 0, `_works/_completed/20260924-28-rd-022b-bg-output-above-read/verify/titles-{before,after}.txt`).
  - RED: 원래 소스에서 `expected 3 to be 2`(`_works/_completed/20260924-28-rd-022b-bg-output-above-read/verify/red-delta01.log`, 스텁 하니스 결함을 고친 뒤 원래 소스에서 다시 확인한 로그 — `docs/traps/TRP-058`). GREEN: 벤더 249/249(`_works/_completed/20260924-28-rd-022b-bg-output-above-read/verify/l0-delta01-test.log`). 변이 `redrawCursor` 덮어쓰기 M04·M05 killed(`_works/_completed/20260924-28-rd-022b-bg-output-above-read/verify/mutations-delta01.log`).
