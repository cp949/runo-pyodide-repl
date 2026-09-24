# Tab 완성

> 이 문서의 규칙·상수는 이전 구현(`/work/cp949/pyodide-samples/apps/repl`, 읽기 전용 참고)이 CPython 3.14.4 pty 실측과 브라우저 회귀로 확정한 것이다. 새 구현은 통신 계층만 바꾸고(`docs/design/00-architecture.md`, `01-protocols.md`) 이 규칙은 그대로 지킨다. 절 끝의 "참고:" 경로는 이전 구현의 근거 위치다.

`complete(source, pending)` 요청은 main→worker RPC 요청이다(`01-protocols.md` 1절). worker가 프롬프트 대기 중(`readLine` 요청을 보내고 응답을 기다리는 동안)에만 답하고, `input()` 메일박스 대기 중에는 worker가 멈춰 있어 답하지 못한다(그 구간의 Tab은 main이 무동작 처리). `pending`은 main이 넘기고 worker는 RD-016 전까지 무시한다.

## 7.1 요청 프로토콜
- 요청: `complete(source, pending)` → 응답 `{ completions: string[], start: number }`(repl `worker/complete-source.ts`
  의 `SourceCompletion`). `source`는 커서 앞 텍스트(`buf.slice(0, pos)`), `pending`은 `... ` 블록의 이전 줄들
  (`\n`으로 이음).
- worker 핸들러(repl `worker/repl-driver.ts`가 `WorkerDriverSession.handlers`로 내고 core `bootWorker`가 core 표와 합성해 `createRpc(frame.rpcPort, …)`로 등록)는 **프롬프트를 기다리는
  동안(`atPrompt`)에만** 실제로 계산하고, `completer`가 아직 없거나(로드 중) 실행 중에 늦게 도착한 요청은
  `{ completions: [], start: 0 }`로 돌려 사용자 코드와 겹쳐 돌지 않게 한다.
- main은 `terminal/tab-reader.ts`의 `createTabReader(readline, { complete, interruptCompletion })`(세션
  소유 정책 객체, `repl-main-driver.ts`가 `blockHistory`·`autoIndent` 옆에서 만든다)가 벤더 readline의 **키 가로채기
  공개 훅**(`ReadOptions.onKey`, RD-013이 범용으로 이미 추가)으로 Tab(`UnsupportedControlChar`, `data:
  ['\t']`)을 가로챈다(이전 구현은 private `readKey`를 런타임 래핑했다. 벤더링 뒤에는 `06-editing.md` 6.1
  규칙대로 private 멤버를 쓰지 않는다). 노출은 둘뿐이다: `readOptions(pending)`(세대 `generation` +1,
  `ended=false`, `pendingBlock` 저장, `lastKeyWasTab=false`, `queuedTabs=[]` — `repl-main-driver.ts`가
  `mergeReadOptions(blockHistory.readOptions(pending), autoIndent.readOptions(pending),
  tabReader.readOptions(pending))`로 3항 합성해 `createReplReader`에 넘긴다)와 `readEnded(line)`(세션이
  `readLine` continuation에서 `null`·문자열 둘 다에 호출, `blockHistory.discard()`와 같은 자리 — 순서는
  `readEnded` 먼저). `getLine`·`getCursor`·`editInsert`·`tty`·`printAbove`(RD-013·RD-015가 더한 접근자)로
  버퍼·커서를 읽고 고친다. 응답(`applyResume`)은 **세대가 같고, 읽기가 끝나지 않았고(`!ended`), 버퍼·커서가
  요청 때와 같을 때만** 적용한다. 하나라도 어긋나면(Enter·Ctrl+C로 읽기가 그 사이 끝났거나 다른 입력이
  버퍼를 바꿨으면) 완성을 버린다. 요청이 reject되면 무동작이고 입력은 그대로다.
- 왕복 중 들어온 Tab은 **버리지 않고 큐에 두었다가**(`requesting`, `queuedTabs`) 끝난 뒤(`drainQueue`, 성공·
  실패 모두) 그 읽기에 이어 처리한다 — 다른 세대의 큐 항목은 버린다. 목록 재그리기 중 들어온 키는 코어가
  아니라 **벤더 `printAbove`**가 큐에 두고 순서대로 재생한다(6.1·7.3). 이전 구현의 `redrawing`/`queuedKeys`에
  해당하는 상태는 벤더 쪽 `redrawing`/`queued`로 옮겨졌다 — 코어 `tab-reader.ts`에는 이 상태가 없다.
- `input()` 읽기(`stdin-reader.ts`는 `readOptions`가 없다 → Tab이 `onKey`에 닿지 않아 벤더가 무시), 실행 중,
  읽기 시작 전(활성 읽기가 없어 벤더가 `onKey` 자체를 부르지 않음)의 Tab은 무동작이고 `\t`도 넣지 않는다.
- 완성 요청 중 읽기가 Ctrl+C로 취소되면(`readEnded(null)`이 `requesting === true`일 때) `interruptCompletion`
  (= `interruptSender.send()`)이 1회 worker의 후보 계산(무한 루프인 `__getattr__` 등)을 끊는다. 사용자
  프레임이 `<console>`이라 핸들러가 `KeyboardInterrupt`를 올리고, `complete_source`의 `except Exception`은
  `BaseException`을 잡지 않아 요청이 reject된다. 요청이 없을 때·이미 끝난 뒤·Enter로 끝난 읽기에는 보내지
  않는다. `exec()`/`eval()`로 정의된 코드(파일명이 `<console>`이 아님)는 이 인식이 걸리지 않는 좁은 경계
  사례가 남는다(`10-parity-deviations.md`).

## 7.2 스템과 공백(32칸 규칙)
- `STEM_DELIMITERS`는 pyodide `Console.completer_word_break_characters`와 같은 **33자**
  (`` ` ``~`?`까지, 공백·탭·개행 포함). 스템은 커서가 있는 논리 줄에서 마지막 구분자 뒤이고 커서 뒤
  텍스트는 보지 않는다.
- 스템이 빈 곳은 공백 `' ' * (4 - 열 % 4)`를 넣는다(`TAB_STOP = 4`). 열은 현재 논리 줄 안 위치이고
  프롬프트는 세지 않으며 `\t`는 1로 센다.
- **32칸 규칙**: 왕복 중 Tab을 큐에 두어 이어 처리하므로 Tab 8회를 간격 0ms로 눌러도 공백이 **32칸**이다
  (옛 동기 모드는 버려진 Tab 때문에 4칸이었다). 게이트가 참인 빈 스템 줄(`important = ` 등)도 마찬가지.

## 7.3 후보 표시
- 삽입: `cand[len(stem):]`을 커서 위치에 넣는다(후보 하나면 그 후보, 여럿이면 공통 접두사). 채울 것이
  없을 때만 **연속 두 번째 Tab**(`second`)이 목록을 연다. 후보 하나가 이미 입력과 같으면 목록을 열지 않는다.
- 목록은 열 우선이다: `CELL_GAP = 2`, 셀 폭 = 최장 후보 길이 + 2, 열 수 = `floor(터미널 열 / 셀 폭)`
  (최소 1), 행 수 = `ceil(n / 열 수)`. 후보는 스템을 포함한 전체 문자열. `LIST_CAP = 200`을 넘으면
  `...N개 더` 한 행. 열 폭은 문자열 길이 근사(전각 미반영).
- 그리는 순서: 벤더 `printAbove(text)`(`06-editing.md` 6.1)가 **같은 읽기로 앵커만 갱신해 다시 그린다**
  (State 재생성 없음, TRP-030 해당 없음) — `text`는 `formatCompletionList`가 만든 행을 `\n`으로 이은
  문자열이고, `printAbove`가 `state.moveCursorToEnd()`(원래 논리 커서를 먼저 저장) → `\r\n` + `text` +
  `\r\n` 원시 쓰기 → `term.write("", cb)` 콜백에서 `Tty.anchorRow`를 실제 물리 커서(`term.buffer.active.
  cursorY`)로 갱신 → `State.restoreCursor(cursor)`(저장해 둔 논리 커서 위치로 되돌림) → `State.resetLayout()`
  (`moveCursorToEnd()`가 남긴 옛 레이아웃을 0으로 되돌려, 다중 행 블록 입력에서 재그리기가 옛 줄을 지우지
  않게 함, DELTA-01a) → `state.refresh()` 순서로 처리한다. `printAbove`가 돌려주는 `Promise<void>`는 이
  전체가 끝난 뒤에만 resolve하고, `tab-reader.ts`의 `applyResume`이 `list` 분기에서 이 프로미스를 그대로
  반환해 `.finally(drainQueue)`가 재그리기가 실제로 끝난 뒤에야 큐의 다음 Tab을 처리한다(재그리기 중
  벤더 큐를 우회해 옮겨진 커서로 계산하는 것을 막는다, DELTA-04a). 콜백을 기다리는 동안 도착한 키는 벤더
  `queued`에 원본 문자열째 쌓였다가 콜백에서 순서대로 재생된다(붙여넣기 덩어리도 하나로, `readPaste`
  경로를 그대로 탐). 사이에 다른 키가 끼면(재그리기가 끝난 뒤 도착한 키) 첫 Tab 규칙으로 돌아간다.
- 배경 출력과의 겹침(RD-022b, `06-editing.md` 6.1): 위 순서는 재그리기를 기다리지 않을 때다. 배경 출력(`printAboveRaw`)의
  재그리기를 기다리는 중에 목록이 오면 `moveCursorToEnd()`·앞 `\r\n` 없이 목록을 쓰고 그 재그리기에 합류하며, 프로미스는 합친
  재그리기가 끝난 뒤 resolve한다. 목록은 배경 출력의 프롬프트 앞 접두를 비운다(옛 입력행에 남는다, `10-parity-deviations.md` 편차 55).
  완성 **삽입**(`applyResume` → `editInsert`)이 배경 출력 재그리기 콜백 전에 오면 벤더는 그리지 않고 저장 커서 자리의 버퍼에 넣은 뒤
  저장 커서를 삽입 뒤로 옮기고, 콜백이 그 커서로 다시 그린다(RD-022b 리뷰 반영. 이전에는 콜백이 커서를 삽입 전으로 되돌려
  `imp` → Tab → ` os`가 `imp osort`로 제출됐다). 경합 판정(`getCursor() === snap.pos`)은 `printAboveRaw`가 논리 커서를 옮기지 않아
  그대로 통과한다. 시험: repl `run-source.test.ts` "Tab 완성 응답과 배경 출력 재그리기의 겹침".
  알려진 경계: 재그리기 대기 중 친 키는 벤더 `queued`에 있어 버퍼에 아직 없으므로 경합 판정(`getLine()`·`getCursor()` 비교)에 보이지
  않는다. `>>> imp` → Tab(완성 왕복 중) → 배경 출력 → `x` → 완성 응답 → 재그리기 콜백 순서면 완성이 먼저 버퍼에 들어가고 `x`가 콜백에서
  뒤에 재생돼 `importx`가 제출된다(배경 출력이 없으면 버퍼가 달라져 완성을 버리고 `impx`). Enter면 `import`(기대 `imp`). 창은
  `printAboveRaw`와 그 write 콜백 사이 한 번이다. jsdom 재현(second-opinion 2차 SO2-R1), 브라우저 미관찰,
  `.scratch/repl-run-source-followups/issues/16-*.md` `deferred`.

## 7.4 인덱스 변환
- Python `start`는 **코드포인트 인덱스**, `xterm-readline`의 `pos`는 **UTF-16**이다.
  `resolveCompletion`이 `[...buf.slice(0, pos)].slice(start).join('')`로 스템을 구하고 공통 접두사도
  코드포인트 단위로 계산한다(서로게이트 쌍의 절반만 남기면 삽입이 깨진다, TRP-031).

## 7.5 모듈(`import`/`from`) 후보
- main 사전 게이트: `mentionsImportKeyword(text) = /import|from/.test(text)` — **부분 문자열, 단어 경계
  없음**. 입력은 커서 앞 텍스트에 `pending`을 `\n`으로 앞에 붙인 것(worker가 `ModuleCompleter`에 넣는 것과 동일).
  거짓이면 스템이 빈 곳은 왕복 없이 main이 공백을 넣고 스템이 있으면 요청한다. 참이면 스템이 비어도 항상
  worker가 판정한다. `\b` 게이트는 `1import os` 류 5줄에서 거짓인데 파서가 반응해 쓸 수 없다(TRP-033).
- worker 판정 순서(`complete_source(console, source, pending=None)`):
  1. `ZipStdlibModuleCompleter().get_completions`에 `pending + '\n' + source`를 넣어 결과가 `None`이 아니면
     (`[]` 포함) **그것이 최종**이다(폴백 없음). `INTERNAL_PREFIXES = ('_pyodide', '___')`로 시작하는 후보만
     빼고 정렬하지 않은 ModuleCompleter 순서 그대로 돌려준다.
  2. `None`이고 스템이 비면 공백 후보 1개 `' ' * (4 - 열 % 4)`, `start = len(source)`(공백도 후보로 돌려
     프로토콜을 바꾸지 않는다).
  3. 그 외는 `console.complete` 경로(경고 억제, 예외 삼킴, 전체 정렬, 내부 이름 제외).
- **호출마다 `ZipStdlibModuleCompleter()`를 새로 만든다**(인스턴스가 모듈 목록을 캐시해 `loadPackage`·
  micropip 뒤 설치된 패키지를 놓친다). 클래스 import는 worker 시작 때 1회이고 후보 계산은 `sys.modules`를
  바꾸지 않는다.
- zip stdlib 보정: pyodide stdlib는 `/lib/python314.zip`(zipimporter)이라 원본 `_is_stdlib_module`이
  `FileFinder`만 인정해 `HARDCODED_SUBMODULES`가 빠진다. **그 판정만 오버라이드**해 zipimporter의
  `archive == _stdlib_path`도 인정한다(vendoring·`pkgutil` 패치 없음).
- 3.14의 삽입 quirk(스템이 파싱이 아니라 구분자 기반이라 생기는 어긋남)도 그대로 따른다.
- 구현 위치: worker `packages/pyodide-repl/src/worker/complete-source.py`(`ZipStdlibModuleCompleter`·`complete_source`의 모듈
  분기, 클래스 import 실패는 try/except 없이 `loadCompleteSource` 실패 = 부팅 실패, TRAP-10). main
  `packages/pyodide-repl/src/terminal/tab-completion.ts`의 `mentionsImportKeyword`와 `planTab(buf, pos, pending?)`(스템이 빈 분기에서만
  게이트를 평가), `terminal/tab-reader.ts`가 `pendingBlock || undefined`를 넘긴다. RPC 변경 없음.
- 시험 위치: `worker/module-completion-parity.test.ts`(3.14.4 pty 기준 A01~A36·X01~X04, 실제 pyodide),
  `worker/complete-source.test.ts`(모듈 분기·zip 보정 사전 조건·새 인스턴스·정렬 없음·게이트 안전성·quirk A37·편차 23),
  `terminal/import-gate.test.ts`(코퍼스 55줄 `mentionsImportKeyword`), `terminal/tab-completion.test.ts`·`terminal/tab-reader.test.ts`
  (`planTab` 게이트 분기·`pending`·연타 큐·오래된 응답 버리기), 브라우저 `apps/demo/e2e/checks/tab-check.mjs` C15(6종 8개 확인).
  기준 데이터는 `apps/demo/e2e/pty/rd-016/`(재측정 없음)이고 시험은 이를 읽지 않고 케이스 ID와 리터럴로 옮겨 둔다.
- `completer_word_break_characters`(pyodide `Console`)와 `tab-completion.ts`의 `STEM_DELIMITERS`는 같은 33자 문자열이다
  (`Console({}).completer_word_break_characters === STEM_DELIMITERS`, 2026-09-24 pyodide 314.0.7 실측). worker의 모듈 분기
  `start` 계산은 이 문자열을 그대로 쓰므로 둘이 어긋나면 삽입 시작 위치가 어긋난다. `tab-completion.test.ts`가 33자 개수와
  구분자 뒤 `indent` 판정을 고정한다.
- 알려진 차이: 편차 18(모듈 집합 178 대 192)·19·20·21·23(`10-parity-deviations.md`).

참고: `/work/cp949/pyodide-samples/apps/repl/docs/design/06-tab-completion.md`,
`/work/cp949/pyodide-samples/apps/repl/src/repl/{tab-completion,tab-reader,complete-source}.ts`,
`/work/cp949/pyodide-samples/apps/repl/src/repl/complete-source.py`

