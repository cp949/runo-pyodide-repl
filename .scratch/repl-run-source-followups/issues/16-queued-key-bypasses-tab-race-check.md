# 배경 출력 재그리기 대기 중 큐에 쌓인 키가 Tab 완성 경합 판정을 우회한다

Status: done
Origin: RD-022b 독립 second-opinion 리뷰 2차(가설 SO2-R1·SO2-V2), jsdom 재현. 브라우저·사용자 시나리오 미관찰.

## 현상

Tab 완성 응답을 기다리는 중(`complete` 왕복)에 배경 출력이 와서 벤더가 재그리기(`printAboveRaw`) write 콜백을 기다리면, 그 사이 친 키는 벤더
`queued`에 쌓이고 버퍼에는 아직 없다. 완성 응답이 콜백보다 먼저 오면 `packages/pyodide-repl/src/terminal/tab-reader.ts` `applyResume`의 경합
판정(`getLine()`·`getCursor()`가 Tab 때 스냅숏과 같은가)이 통과하고, 완성 삽입(`editInsert`)은 재그리기 대기 중 오프스크린 편집으로 곧바로
버퍼에 들어간다(`packages/xterm-readline/src/readline.ts` 재그리기 대기 분기). 큐의 키는 콜백에서 그 뒤에 재생된다 — 도착 순서(키 → 완성)가
뒤집힌다.

재현(jsdom, `packages/pyodide-repl/src/run-source.test.ts` 하니스와 같은 조립): `>>> imp` → Tab(완성 왕복 중) → worker `write("tick\n")`
(재그리기 콜백 미배출) → `x`(또는 Enter) → 완성 응답 `{ completions: ["import"], start: 0 }` → 콜백 배출 → Enter.

- 실제: `x` → 제출 `"importx"`, Enter → 제출 `"import"`.
- 기대(배경 출력이 없는 같은 입력, `docs/design/07-tab-completion.md` 경합 규칙 "버퍼·커서가 어긋나면 완성을 버린다"): `"impx"`, `"imp"`.
- 리뷰 시험 이름: "배경 출력 재그리기 콜백 전 x(큐) → 완성 응답 → 콜백: 대조와 같게 impx여야 한다", "배경 출력 재그리기 콜백 전
  Enter(큐) → 완성 응답 → 콜백: 대조와 같게 imp가 제출돼야 한다"(대조 2개 "대조: 배경 출력 없이 Tab 왕복 중 x를 치면 완성은 버려진다(impx)",
  "대조: 배경 출력 없이 Tab 왕복 중 Enter를 치면 imp가 제출된다"는 통과).

이 경합은 RD-022b 리뷰 반영(재그리기 대기 중 공개 편집 API 오프스크린 편집) 전에도 있었다: 판정은 그때도 통과했고 `x`는 `impxort`,
Enter는 `import`였다(리뷰 SO2-V2p·코드 읽기). 창은 `printAboveRaw`와 그 write 콜백 사이(xterm 파싱 한 번)에 키와 완성 응답이 함께
들어와야 한다.

## 완료 기준

위 순서의 jsdom 시험에서 제출이 `"impx"`·`"imp"`(배경 출력이 없는 대조와 같음). 수정 방향 후보:

1. 벤더가 재그리기 대기 중 큐 유무를 공개(예: `Readline.hasQueuedInput()`)하고 `applyResume`이 큐가 있으면 경합으로 보고 완성을 버린다.
2. 벤더가 `queued`가 비어 있지 않으면 오프스크린 편집을 거절하고 호출자에게 알린다.
3. 편차·`07-tab-completion.md` 7.3 경계로만 유지한다(현재 문서화됨).

## 재개 조건

브라우저·사용자 시나리오에서 배경 출력 중 Tab 완성 직후 친 키가 완성 뒤로 밀린 제출(`importx` 형태)이 관찰될 때.

## Comments

- 2026-09-25 등록 시점 분류: RD-022b 이전부터 있던 좁은 경합(재그리기 콜백 한 번의 창)이고 jsdom 재현뿐, 사용자 시나리오 미관찰 →
  `deferred`. 설계 문서 기록: `docs/design/07-tab-completion.md` 7.3·`docs/design/06-editing.md` 6.1 알려진 경계.
- 2026-09-25 재분류 `deferred` → `open` (RD-026 승격, 예외 근거): 창이 메시지 태스크 한 번이라 브라우저 재현 실패가 결함 부재를 뜻하지 않으므로 사용자 시나리오 관찰을 요구하지 않는다. 대신 `docs/design/07-tab-completion.md` 7.3 경합 규칙 위반 + jsdom 재현·대조 2개를 근거로 삼는다(영향: 사용자가 치지 않은 코드가 제출된다). 추적은 `ROADMAP.md` RD-026.

## 해결

- 결과: 코드 수정 완료(RD-026). 방향은 수정 후보 1이다. 재현 시험 x·Enter가 `"impx"`·`"imp"`로 통과하고 배경 출력 없는 대조 2건이 그대로 통과한다.
- 원인: 재그리기 대기 중 친 키는 벤더 `queued`에만 있고 콜백에서 재생되기 전까지 버퍼에 없어 `applyResume`의 `getLine()`·`getCursor()` 비교를 통과했다. 완성 삽입이 큐의 키보다 먼저 버퍼에 들어가 `importx`·`import`가 제출됐다.
- 수정: 벤더 `Readline.hasQueuedInput()`(`redrawing && queued.length > 0`, type-ahead 버퍼 제외)을 공개하고, `packages/pyodide-repl/src/terminal/tab-reader.ts` `applyResume`이 참이면 삽입·목록 둘 다 버린다. 설계: `docs/design/07-tab-completion.md` 7.3, `docs/design/06-editing.md` 6.1.
- 시험(jsdom): repl `run-source.test.ts` "Tab 완성 응답과 배경 출력 재그리기의 겹침"(x·Enter·목록 3건과 배경 출력 없는 대조 "대조: 배경 출력 없이 Tab 왕복 중 x를 치면 완성은 버려진다(impx)"·"… Enter를 치면 imp가 제출된다" 2건. 이 대조 2건은 저장소에 없어 같은 이름으로 새로 추가했고 수정 전에도 통과한다), 벤더 `print-above-raw.test.ts` "hasQueuedInput(결함 16)" 5건. 수정 전 RED(벤더 5건·repl 3건 실패).
- 변이 검사: `applyResume`의 `hasQueuedInput()` 항 제거·`hasQueuedInput()` 항상 false 2건 killed. 보조 변이(`redrawing &&` 제거)는 동치라 생존한다(`queued`는 재그리기 대기 중에만 쌓인다).
- 브라우저: L1 셀 없음. 창이 `printAboveRaw`와 그 write 콜백 사이 메시지 태스크 한 번이라 브라우저 관찰을 완료 기준으로 삼지 않았다(예외 승격 근거와 같다).
- 한계(2026-09-25 RD-026 사후 리뷰): 판정이 큐의 내용을 보지 않아 버퍼를 바꾸지 않는 키도 경합으로 센다. `Readline.dispatch()`가 재그리기 대기 중에는 Ctrl+C·Ctrl+L 같은 즉시 키도 큐에 쌓으므로, Tab 왕복 중 Ctrl+L은 배경 출력이 있을 때만 완성이 버려진다(없으면 적용된다). 결과가 보수적(완성 폐기)이고 큐 항목을 `parseInput`으로 훑어 즉시 키를 빼면 벤더 API 의미가 복잡해져 고치지 않는다(사용자 확정 2026-09-25). 위 "대조 2건"이 주장하는 불변식은 버퍼를 바꾸는 키에 한정된다. `docs/design/07-tab-completion.md` 7.3·`docs/traps/TRP-078`.
