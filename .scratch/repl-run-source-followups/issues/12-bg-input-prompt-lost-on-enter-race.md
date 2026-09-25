# 배경 `input()`의 `write`와 `readInput` 알림 사이에 REPL 줄 Enter가 끼면 stdin 프롬프트를 잃는다

Status: done (편차 등록)
Origin: RD-022b 독립 second-opinion 리뷰(가설 SO-R2), jsdom 재현 1회. 브라우저·사용자 시나리오 미관찰.

## 현상

REPL `>>> x = 41`이 열린 채 배경 task가 `input("bg> ")`을 부르면 worker는 `write("bg> ")` 알림과 `readInput` 알림을 같은 포트로 연달아 보낸다. `bg> `는 열린 REPL 줄의 접두가 되고(`bg> >>> x = 41`), 경합이 없으면 `readInput` 도착 때 read-guard가 `inputDeferred` → `TerminalSinks.moveAbovePrefixToTail()`로 접두를 꼬리로 옮겨 미뤄진 stdin 읽기의 프롬프트로 쓴다(`docs/design/04-stdin-input.md` 3.2).

두 알림 사이(다음 메시지 태스크 한 번)에 사용자가 REPL 줄에서 Enter를 치면 읽기가 끝나 `abovePrefix()`가 `""`이고, 접두는 확정된 행(`bg> >>> x = 41`)에만 남는다. 꼬리는 비어 있어(열린 읽기의 출력은 꼬리에 먹이지 않는다, RD-022b 확정 7) stdin 읽기는 프롬프트 없이 열린다.

재현(jsdom, `packages/pyodide-repl/src/run-source.test.ts` 하니스와 같은 조립): `openPrompt(session, "x = 41")` → `session.output("bg> ")` → 화면 `bg> >>> x = 41` → `fake.type("\r")` → `rpc.notify("readInput", true)` → `fake.type("hello")`.

- 실제: 화면 행 `["bg> >>> x = 41", "hello"]`
- 기대: `["bg> >>> x = 41", "bg> hello"]`(2026-09-25 그릴링 확정 4로 정정). Enter가 온 시점에 `bg> `는 이미 확정 행에 그려져 있어 되돌릴 수 없으므로, 경합 없는 경로의 결과 `[">>> x = 41", "bg> hello"]`를 그대로 요구하지 않는다. 판정 기준은 stdin 입력 행에 `bg> `가 있는 것이고, 프롬프트가 두 번 보이는 것은 받아들인다.

RD-022b 전에는 sink가 읽기 중 출력도 꼬리에 먹여 이 경합에서도 `bg> `가 stdin 프롬프트가 됐다(코드 읽기, 실행 확인 안 함).

## 완료 기준

위 순서의 jsdom 시험에서 stdin 입력 행이 `bg> hello`다. 수정 후보: Enter로 끝난 읽기의 마지막 접두를 벤더(또는 sink)가 한 번 보관해 read-guard가 꺼내 쓴다. 또는 편차로 등록한다(`docs/design/10-parity-deviations.md`).

## 재개 조건

브라우저·사용자 시나리오에서 배경 `input()`의 프롬프트가 stdin 입력 행에서 빠진 것이 관찰될 때(화면 기록).

## Comments

- 2026-09-25 등록 시점 분류: 같은 포트로 연달아 오는 두 알림 사이의 키 입력이라는 좁은 경합이고 jsdom 재현뿐, 사용자 시나리오 미관찰 → `deferred`. 설계 문서 기록: `docs/design/04-stdin-input.md` 3.2.
- 2026-09-25 재분류 `deferred` → `open` (RD-026 승격, 예외 근거): 창이 두 알림 사이 태스크 한 번이라 브라우저 관찰을 요구하지 않고, `docs/design/04-stdin-input.md` 3.2의 접두→꼬리 이전 규칙 위반 + jsdom 재현을 근거로 삼는다(영향: 무엇을 입력해야 하는지 화면에 없다). 추적은 `ROADMAP.md` RD-026.
- 2026-09-25 그릴링 확정 4·9(RD-026 계획, `_works/20260925-34-rd-026-redraw-window/`): 기대 화면을 위와 같이 정정했다. 수정 방식은 벤더가 Enter 제출 시점의 접두를 `lastAbovePrefix`로 1회 보관하고 `takeLastAbovePrefix()`로 꺼내며, `sinks.moveAbovePrefixToTail()`이 `abovePrefix()`가 `""`일 때만 폴백으로 쓴다. 만료는 `read()` 새 시작·`cancelRead()`·`dispose()`·소비 중 먼저 오는 것이다.
- 2026-09-25 RD-026 DELTA-04 결과: 코드로 고치지 않고 편차 56으로 등록했다. 그릴링 확정 4(기대 화면 `["bg> >>> x = 41", "bg> hello"]`)·확정 9(벤더 `lastAbovePrefix`·`takeLastAbovePrefix()` 보관)는 이 결정(사용자 확정 2026-09-25)으로 대체됐다.

## 해결

- 결과: 편차 등록(`docs/design/10-parity-deviations.md` 편차 56, `docs/design/04-stdin-input.md` 3.2 "경합: 두 알림 사이의 Enter" 문단). 이 이슈의 대체 완료 기준을 채웠다. 코드 변경 없음.
- 원인: 재현 화면 `["bg> >>> x = 41", "hello"]`. Enter 처리의 마이크로태스크가 `readInput` 메시지 태스크보다 먼저 돌아, `readInput` 도착 시 read-guard의 `replOpen`이 이미 false라 `inputDeferred`(`moveAbovePrefixToTail`)가 불리지 않는다. 임시 로그 `readInput replOpen= false`로 확인했다. 계획 문구 그대로의 재현 순서(중간 await 없음)도 같은 이유로 실패한다.
- 시도하고 포기한 이유: 벤더가 Enter 시점 접두를 보관하고 sinks 폴백이 꼬리를 채우는 방식을 구현했고(벤더 6·terminal 1건 RED→GREEN) repl 재현 시험만 통과하지 않았다. `inputDeferred?.()`를 무조건 호출하면 repl 재현이 통과하지만 (1) 기존 read-guard 시험 2건("활성 REPL 읽기가 없으면 inputDeferred를 부르지 않는다", "끝난 REPL 읽기 뒤에 온 readInput은 inputDeferred를 부르지 않는다")의 기대값을 바꿔야 하고 (2) 접두가 남은 채 `input()` 코드를 Enter로 제출하는 정상 경로에서 접두가 stdin 프롬프트로 재그려지거나 `input("name: ")` 프롬프트를 덮을 수 있다(추정, 미시험). 경합과 정상 지연을 main이 구분할 수단이 없다.
- 근거 로그: `_works/20260925-34-rd-026-redraw-window/verify/delta04-red.log`·`delta04-green.log`·`delta04-wip.patch`(폐기한 구현 diff).
- 재개 조건: 경합과 정상 경로의 `readInput`을 구분할 수단(worker 알림에 응답 수신 표지·순번 등)이 생기면 재검토한다.
