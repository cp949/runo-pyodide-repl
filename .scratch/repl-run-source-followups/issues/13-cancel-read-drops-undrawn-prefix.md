# 재그리기 콜백 전 `cancelRead()`는 아직 그리지 않은 배경 출력 접두를 잃는다

Status: done
Origin: RD-022b 독립 second-opinion 리뷰(가설 SO-V5), 벤더 jsdom 재현 1회. 브라우저·사용자 시나리오 미관찰.

## 현상

열린 읽기 중 개행 없는 배경 출력은 `printAboveRaw("", "tick")`으로 입력줄을 지운 뒤 write 콜백에서 접두 붙은 프롬프트(`tick> abc`)를 다시 그린다. 콜백 전에 `cancelRead()`가 오면 재그리기가 무효가 되어 입력줄도 접두도 그려지지 않는다. `takeRead()`는 브리지가 `abovePrefix()`를 먼저 읽어 복원하지만(`docs/design/02-console-core.md` 5.6.3) `cancelRead()` 경로에는 복원이 없다.

`cancelRead()` 호출자: REPL `terminate`(`packages/pyodide-repl/src/repl-main-driver.ts`, `reset()`), 실행창 abort(`packages/pyodide-terminal/src/terminal-runner.ts` `onAbort`).

재현(벤더 `print-above-raw.test.ts`의 `StubTerminal`): `read("> ")` → `abc` → `asyncWrite = true` → `printAboveRaw("", "tick")` → `cancelRead()` → `flush()`.

- 실제: 화면 `""`(`tick`·`> abc` 모두 없음)
- 기대(`docs/design/05-output.md` 4.4 "`reset()`의 `cancelRead()`는 화면을 건드리지 않는다(행이 그대로 남는다)"): 화면에 `tick`이 있다.

## 완료 기준

위 순서의 벤더 jsdom 시험에서 `tick`이 화면에 남는다. 수정 후보: `cancelRead()`가 재그리기 대기 중이고 접두가 있으면 `접두 + "\x1b[0m"`을 쓴다(개행 여부는 호출자 규칙과 맞춘다). 또는 `docs/design/05-output.md` 4.4 경계로 문서화만 유지한다.

## 재개 조건

리셋·실행창 중단 직후 배경 출력 조각이 사라진 것이 브라우저·사용자 시나리오에서 관찰될 때.

## Comments

- 2026-09-25 등록 시점 분류: 창이 xterm write 파싱 한 번이고 jsdom 재현뿐 → `deferred`. `05-output.md` 4.4에 창 예외를 적었다.
- 2026-09-25 판정: `deferred` 유지. 문서(`05-output.md` 4.4)가 이미 창 예외로 적어 코드와 문서가 일치한다. 다만 근인이 같아 RD-026의 같은 하니스에서 곁들여 판정한다(수정 또는 문서화 유지 결론을 RD-026에 적는다).
- 2026-09-25 재분류 `deferred` → `open` (RD-026 편입, 그릴링 확정 5): 문서화 유지 대신 고친다. 방식은 이슈 본문의 "수정 후보"(`cancelRead()`가 직접 쓴다)가 아니라 **호출자 복원**이다 — 벤더 `cancelRead()`의 "화면에 아무것도 쓰지 않는다" 계약(`readline.ts:238` 주석)을 깨지 않고, `takeRead()`가 이미 쓰는 패턴대로 호출자가 `abovePrefix()`를 먼저 읽어 `prefix + "\x1b[0m"`을 쓴다. 대상은 reset(`packages/pyodide-repl/src/index.ts:202`)과 실행창 abort(`packages/pyodide-terminal/src/terminal-runner.ts:153`) 2곳이고, dispose·terminate의 화면 미기록 경로는 제외한다. 추적은 `ROADMAP.md` RD-026, 계획은 `_works/20260925-34-rd-026-redraw-window/DELTA-05.md`.

## 해결

- 결과: 코드 수정 완료(RD-026). 방식은 수정 후보(`cancelRead()`가 직접 쓴다)가 아니라 **호출자 복원**이다: 벤더 `cancelRead()`의 화면 미기록 계약은 그대로다. reset·실행창 abort 각각에서 재그리기 콜백 전 취소해도 접두 `tick`이 화면에 남는다.
- 원인: 재그리기 대기 중에는 입력줄이 접두째 지워져 있고 `cancelRead()`가 그 재그리기를 무효로 만들어 접두가 화면에 없게 된다.
- 수정: 벤더에 `Readline.undrawnAbovePrefix()`(재그리기 대기 중일 때만 `abovePrefix()`)를 추가했다. `packages/pyodide-repl/src/index.ts` `reset()`은 `cancelRead()` 앞에서 이 값이 비어 있지 않으면 `prefix + "\x1b[0m\r\n"`을 쓰고, `packages/pyodide-terminal/src/terminal-runner.ts` `onAbort`는 `prefix + "\x1b[0m"`을 벤더 `write`로 직접 쓴 뒤 기존 `sinks.write("\r\n")`에 잇는다(열린 읽기가 남아 있어 `sinks.write`는 재그리기를 다시 건다). dispose·terminate 경로는 화면 미기록 규칙이라 그대로다. 설계: `docs/design/05-output.md` 4.4, `docs/design/06-editing.md` 6.1, `docs/design/08-session.md`, `docs/design/14-runner.md`.
- 계획과 다른 점: 계획은 `abovePrefix()`로 복원하는 것이었으나 재그리기가 끝난 뒤 취소에서 접두가 중복된다(`tick>>> pritick`, 실측). 그래서 `undrawnAbovePrefix()`를 두었다. `docs/traps/TRP-079`.
- 시험(jsdom): repl `run-source.test.ts` "재그리기 대기 중 reset()의 접두 복원(이슈 13)" 2건, terminal `terminal-runner.test.ts` "재그리기 대기 중 abort의 접두 복원(이슈 13)" 2건, 벤더 `print-above-raw.test.ts` "undrawnAbovePrefix(이슈 13)" 3건. 각 describe에 재그리기가 끝난 뒤 취소해도 접두를 다시 쓰지 않는 대조가 있다. 수정 전 RED(repl 1건·terminal 1건 실패, 대조는 통과). 변이: reset 복원 제거·abort 복원 제거 2건 + 보조 1건(`undrawnAbovePrefix`가 재그리기 밖에서도 접두를 돌려줌) killed.
- 브라우저: L1 셀 없음(재개 조건이 사용자 관찰이고 jsdom으로 판정). 회귀는 `run-source`·`repl-check`가 본다.
- 사후 리뷰 수정(2026-09-25): reset이 접두를 쓴 뒤에도 `terminal.buffer.active.cursorX`를 봐 빈 행이 하나 더 날 수 있었다. `buffer.active`는 해석이 끝난 바이트까지만 반영하는데 재그리기 콜백 전이라는 것은 앞선 `state.erase()`조차 해석 전이라는 뜻이라 `cursorX`가 옛 입력줄 끝으로 읽힌다. 접두를 썼으면(끝이 `\r\n`) 검사를 건너뛴다(`packages/pyodide-repl/src/index.ts`, `docs/design/08-session.md`). 시험: repl `run-source.test.ts` "접두를 쓴 뒤에는 낡은 cursorX를 보지 않아 안내 줄 앞에 빈 행이 없다"(가짜 터미널의 동기 커서 갱신을 묶어 xterm의 미해석 상태를 흉내 낸다). RED `verify/review-red-reset-newline.log`, 변이 2/2 killed(`review-mutation-repl.log`).
