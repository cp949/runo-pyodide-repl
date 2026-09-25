# 재그리기 콜백 전 `cancelRead()`는 아직 그리지 않은 배경 출력 접두를 잃는다

Status: deferred
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
