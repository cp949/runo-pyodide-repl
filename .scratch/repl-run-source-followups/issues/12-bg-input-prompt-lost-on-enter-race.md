# 배경 `input()`의 `write`와 `readInput` 알림 사이에 REPL 줄 Enter가 끼면 stdin 프롬프트를 잃는다

Status: deferred
Origin: RD-022b 독립 second-opinion 리뷰(가설 SO-R2), jsdom 재현 1회. 브라우저·사용자 시나리오 미관찰.

## 현상

REPL `>>> x = 41`이 열린 채 배경 task가 `input("bg> ")`을 부르면 worker는 `write("bg> ")` 알림과 `readInput` 알림을 같은 포트로 연달아 보낸다. `bg> `는 열린 REPL 줄의 접두가 되고(`bg> >>> x = 41`), 경합이 없으면 `readInput` 도착 때 read-guard가 `inputDeferred` → `TerminalSinks.moveAbovePrefixToTail()`로 접두를 꼬리로 옮겨 미뤄진 stdin 읽기의 프롬프트로 쓴다(`docs/design/04-stdin-input.md` 3.2).

두 알림 사이(다음 메시지 태스크 한 번)에 사용자가 REPL 줄에서 Enter를 치면 읽기가 끝나 `abovePrefix()`가 `""`이고, 접두는 확정된 행(`bg> >>> x = 41`)에만 남는다. 꼬리는 비어 있어(열린 읽기의 출력은 꼬리에 먹이지 않는다, RD-022b 확정 7) stdin 읽기는 프롬프트 없이 열린다.

재현(jsdom, `packages/pyodide-repl/src/run-source.test.ts` 하니스와 같은 조립): `openPrompt(session, "x = 41")` → `session.output("bg> ")` → 화면 `bg> >>> x = 41` → `fake.type("\r")` → `rpc.notify("readInput", true)` → `fake.type("hello")`.

- 실제: 화면 행 `["bg> >>> x = 41", "hello"]`
- 기대(경합 없는 경로, read-guard 시험 "배경 input()의 프롬프트는 REPL 줄에서 떼어져 …"의 결과): `[">>> x = 41", "bg> hello"]`. 최소한 stdin 입력 행에 `bg> `가 있어야 한다.

RD-022b 전에는 sink가 읽기 중 출력도 꼬리에 먹여 이 경합에서도 `bg> `가 stdin 프롬프트가 됐다(코드 읽기, 실행 확인 안 함).

## 완료 기준

위 순서의 jsdom 시험에서 stdin 입력 행이 `bg> hello`다. 수정 후보: Enter로 끝난 읽기의 마지막 접두를 벤더(또는 sink)가 한 번 보관해 read-guard가 꺼내 쓴다. 또는 편차로 등록한다(`docs/design/10-parity-deviations.md`).

## 재개 조건

브라우저·사용자 시나리오에서 배경 `input()`의 프롬프트가 stdin 입력 행에서 빠진 것이 관찰될 때(화면 기록).

## Comments

- 2026-09-25 등록 시점 분류: 같은 포트로 연달아 오는 두 알림 사이의 키 입력이라는 좁은 경합이고 jsdom 재현뿐, 사용자 시나리오 미관찰 → `deferred`. 설계 문서 기록: `docs/design/04-stdin-input.md` 3.2.
