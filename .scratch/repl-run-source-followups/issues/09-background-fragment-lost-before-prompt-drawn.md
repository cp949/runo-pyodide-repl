# 프롬프트가 그려지기 전 창에 온 개행 없는 배경 출력 조각이 프롬프트 그리기에 지워진다

Status: deferred
Origin: RD-022b 그릴링 확정 3(범위 제외, 후속 이슈로 등록하기로 함). 코드 읽기로 정한 경계이고 사용자 시나리오로 관찰하지 않았다.

## 현상

REPL·stdin 리더가 `readline.read(prompt)`를 부른 뒤 벤더 write 콜백이 프롬프트를 그리기 전(`pendingReads`, 수 ms. 긴 꼬리면 `rewindTail` flush 뒤)에는 `Readline.isReading()`이 `false`다. 이 창에 온 배경 출력은 열린 읽기 위 출력 경로(`docs/design/05-output.md` 4.4)가 아니라 읽기 밖 경로(꼬리 공급 + `readline.print`)로 가서 커서 행에 그대로 쓰이고, 곧 이어지는 프롬프트 그리기(`\r\x1b[J`)가 개행 없는 조각을 지운다(예: `tick`이 화면에서 사라지고 `>>> `만 남음). 완성 행(`tick\n`)은 그 위 행에 남는다.

추정(코드 읽기, 미확인): 지워진 조각은 꼬리 추적기에 남아 있으므로, 그 읽기가 끝난 뒤 개행 있는 출력이 없으면 다음 읽기의 꼬리(`tick>>> `)로 다시 나타날 수 있다. REPL 읽기 중 배경 `input()`이 미뤄지는 경로는 `moveAbovePrefixToTail`이 꼬리를 접두로 바꿔 이 조각을 버린다(terminal `sinks.test.ts` "읽기가 그려지기 전에 꼬리에 들어간 조각은 접두로 바뀐다").

## 완료 기준

그리기 전 창에 온 개행 없는 조각이 프롬프트 앞 접두로 그려지고(`tick>>> `) 이후 편집·Enter·`runSource`에서 사라지지 않는다는 벤더·sink jsdom 시험(비동기 write 모드로 write 콜백을 미룬 채 출력). 기존 `print-above-raw.test.ts` "write 콜백 전 읽기(그리기 전)에는 지우지 않고 그대로 쓴다"의 기대값 변경 여부를 함께 정한다.

## 재개 조건

사용자 시나리오에서 배경 출력 조각이 프롬프트가 나타나는 순간 사라지거나 다음 프롬프트 앞에 늦게 나타나는 것이 관찰될 때(화면·호출 시각 기록).

## Comments

- 2026-09-24 등록 시점 분류: 1회도 관찰되지 않은 코드 읽기 경계라 `deferred`(`docs/agents/issue-tracker.md` "등록·분류 기준"). RD-022b checklist "범위(제외)" 1번.
- 2026-09-25 판정: `deferred` 유지(RD-026 범위 밖). 재현이 아직 없고(코드 읽기 경계) 기존 시험 `print-above-raw.test.ts`의 기대값 변경 여부를 먼저 정해야 한다. 재개 조건 그대로.
