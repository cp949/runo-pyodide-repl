# 편집: 벤더링한 xterm-readline·자동 들여쓰기·블록 히스토리·붙여넣기·선택 복사

> 이 문서의 규칙·상수는 이전 구현(`/work/cp949/pyodide-samples/apps/repl`, 읽기 전용 참고)이 CPython 3.14.4 pty 실측과 브라우저 회귀로 확정한 것이다. 새 구현은 통신 계층만 바꾸고(`docs/design/00-architecture.md`, `01-protocols.md`) 이 규칙은 그대로 지킨다. 절 끝의 "참고:" 경로는 이전 구현의 근거 위치다.

## 6.1 xterm-readline 사용 방식 (새 구현)

- 이전 구현은 npm `xterm-readline@1.2.2`를 그대로 설치하고 모든 수정을 **런타임 래핑**(타입상 private인 `readKey`/`state`/`activeRead`/`history`/`readPaste`를 감쌈)으로 넣었다. 우회 7건 중 4건(TRP-006·008·016·030)이 비공개 내부에 의존했다.
- 새 구현은 소스를 **`packages/xterm-readline`(`@cp949/runo-xterm-readline`)으로 벤더링**한다([ADR-0003](../adr/0003-vendor-xterm-readline.md)). 원본은 `/work/thrd/xterm-readline`(strtok/xterm-readline 1.2.2, MIT, `src/*.ts` 2,832행 중 테스트 제외 약 1,470행). `LICENSE-MIT`와 저작권 고지를 패키지에 유지한다.
- 벤더링 뒤 수정 방침: 아래 6.2 표의 우회 중 **TRP-006(`readPaste` 탭 보존)·TRP-016/TRP-004(재그리기 전제)·TRP-030(`moveCursorBack` 단위)은 소스에서 직접 고치고**, `read()`의 write 콜백 타이밍(TRP-008, 이전 구현 트랩 — 이 저장소 `docs/traps/TRP-008`과는 다른 문서)은 공개 옵션 `ReadOptions.prefill?: string`으로 계약을 명시한다(RD-013 완료: write 콜백 안, `new State` 직후 1회 채운다 — "onInputReady 콜백/ready Promise" 초안은 채택하지 않았다, 6.3). `InputType`은 export해 상수 복제를 없앤다. `History`에 삭제 API(`replaceFrom`/`truncate` 류)는 추가하지 않았다(RD-014 결정) — 블록 히스토리는 `restore(entries)`로 스냅샷을 되돌리는 것만으로 충분하고, 삭제 전용 API는 코어가 쓸 일이 없다.
- `History`의 `localStorage` 자동 저장/복원은 옵션으로 끈다(벤더링했으므로 no-op 덮어쓰기 대신 생성자 옵션 `persist: false`).
- `Readline.dispose()`는 리스너를 해제하고 `term`을 비우며 대기 중인 읽기(write 콜백 대기 중이라 `activeRead`가 없는 것 포함)를 `Error("readline disposed")`로 reject한다. 두 번째 호출은 무동작이다(RD-003). `term.dispose()`가 로드된 addon을 다시 dispose하므로 멱등이 필수다. dispose 뒤 `read()`는 reject하고 `println`·`print`는 터미널에 쓰지 않는다. 실제 xterm 6은 `term.dispose()` 뒤에도 write 콜백을 돌리고 그 안의 `term.buffer` 읽기는 `DisposableStore` 경고를 낸다.
- `Tty`·`State`·`InputType`·`History`를 패키지에서 export한다. 코어(`packages/pyodide-repl`)는 이 export만 쓰고 private 멤버에 손대지 않는다. 코어가 필요로 하는 진입점은 벤더에 **공개 훅**으로 추가한다: 입력 준비 알림(프리필, `ReadOptions.prefill` — RD-013 완료), 키 가로채기(`ReadOptions.onKey`, RD-013이 범용으로 추가했고 Tab은 RD-015가 그 훅을 그대로 쓴다, `07-tab-completion.md` 7.1), 입력줄 위 출력(`Readline.printAbove(text: string): Promise<void>`, RD-015 완료 — 활성 읽기를 그대로 둔 채 입력줄 위에 텍스트를 찍고 같은 읽기로 다시 그린다. 재그리기 중 들어온 키는 큐에 쌓았다가 순서대로 재생한다. 활성 읽기가 없으면 `println`과 같다. `07-tab-completion.md` 7.3). 키 이벤트 가로채기(`ReadlineOptions.onKeyEvent?: (event: KeyboardEvent) => boolean`, RD-017 완료 — xterm `attachCustomKeyEventHandler` 수준에서 벤더 처리 앞에 불리고 `true`면 xterm 기본 처리를 생략한다. 선택 중 Ctrl+C 복사가 쓴다, 6.6). 붙여넣기 탭 보존(TRP-006)은 훅이 아니라 `readPaste` 소스 수정으로 했다(RD-011 완료: `readPaste`의 매핑 단계에서 `UnsupportedControlChar`+단일 `\t` 토큰만 `Text`로 승격. Tab은 REPL 읽기의 `onKey`(Tab 리더, `createTabReader`)가 소비하고, `input()` 읽기는 `readOptions`가 없어 벤더가 그대로 무시한다, RD-015 완료).
- RD-019가 소스에 더한 내부 동작(공개 API 추가 없음, `index.ts` 값 export 목록 불변): 활성 읽기가 없는 구간에 들어온 키를 `Readline`이 쌓았다가 다음 읽기에서 재생한다. 규칙은 6.7.
- RD-022가 소스에 더한 공개 옵션: `ReadlineOptions.typeAhead?: boolean`(기본 `true` = 위 type-ahead 동작 그대로, `=== false`일 때만 끈다). 끄면 활성 읽기가 없는 구간에 들어온 입력(키·붙여넣기·IME `onData`·Shift+Enter)을 쌓지 않고 버린다. Ctrl+C·Ctrl+L 단독 입력은 그대로 즉시 처리하고(Ctrl+C는 `setCtrlCHandler` 핸들러를 부른다), `printAbove` 재그리기 중 `queued`는 대상이 아니다. 생성 시 고정이고 런타임 토글은 없다. 실행창(`createTerminalRunner`)이 `false`로 만든다(`14-runner.md` 14.5.2). 차단은 `pushTypeAhead` 한 곳이다. 변경 목록은 `packages/xterm-readline/README.md`.
- RD-008이 소스에 더한 공개 API: `read(prompt: string): Promise<string>` / `read(prompt: string, options: ReadOptions): Promise<string | null>` 오버로드와 `ReadOptions = { cancelable?: boolean }`(기본 `false` = 원본 `^C` + 같은 프롬프트 재그리기). `cancelable`이면 활성 읽기 중 Ctrl+C가 읽기를 `null`로 끝낸다(6.3). 오버로드라 기존 `read(prompt)` 호출부의 반환형은 `Promise<string>`으로 남는다. `ReadOptions`도 export한다.
- RD-010이 더한 `cancelRead(): void`: 열린 읽기(활성 읽기 + `read()`의 write 콜백을 기다리는 읽기)를 `ReadCancelledError`(export)로 끝내는 **프로그램에 의한** 취소. `dispose()`와 달리 리스너·`term`·history·state는 건드리지 않고 화면에도 아무것도 쓰지 않는다(커서 이동·개행·재그리기 없음 — 개행 여부는 코어가 결정, `08-session.md`). 콜백이 아직 오지 않은 읽기는 `dispose()`처럼 콜백 안에서 취소 여부를 확인해 늦게 온 콜백이 `activeRead`를 되살리지 않는다. 열린 읽기가 없으면 읽기·화면에 대해서는 무동작이다. 단 쌓인 type-ahead·`queued`를 비우고 `redrawing`을 푸는 일은 열린 읽기 유무와 무관하게 먼저 실행된다(6.7, `docs/traps/TRP-053`). 코어의 `reset()`이 옛 세션의 열린 읽기를 끝내는 데 쓴다(`08-session.md`).
- RD-013이 소스에 더한 공개 API: `ReadOptions.prefill?: string`(`read()`의 write 콜백 안, `new State` 직후 1회 `state.update(prefill)`로 채운다 — 커서는 끝, 빈 문자열·미지정은 원본과 같이 `state.refresh()`만 부른다. `cancelable`이 아닌 읽기의 `^C` 재그리기는 다시 채우지 않는다). `ReadOptions.onKey?: (input: Input) => boolean`(활성 읽기의 키마다 벤더 처리 앞에서 부르고 `true`면 처리를 생략한다. `readPaste`가 `editInsert`로 바로 넣는 `Text` 토큰은 거치지 않는다. 활성 읽기가 없으면 부르지 않는다). `Readline.getCursor(): number`(UTF-16 커서 위치, `State.cursor()` 경유)·`editInsert(text)`·`editBackspace(n)`(`getLine`/`updateLine`과 같은 수준으로 활성 읽기가 없어도 현재 state에 작용한다). `ReadlineOptions.skipBlankHistory?: boolean`(기본 `false`, 켜면 Enter 분기에서 trim 결과가 빈 문자열인 제출을 `history.append` 대신 `history.resetCursor()`만 한다). `Input` 타입도 export한다(값 export 목록은 불변).
- RD-014가 소스에 더한 공개 API: `Readline.getHistory(): History`(history 객체 그대로 돌려준다 — 코어의 블록 히스토리가 `entries` 스냅샷·`restore`에 쓴다). `History.restore(entries: string[]): void`(복사본 대입 → `resetCursor()` → `saveToLocalStorage()`, 넘긴 배열과 공유하지 않는다). `ReadOptions.historyEntry?: (line: string) => string`(Enter 분기에서 `skipBlankHistory`가 공백뿐인 제출을 거른 **뒤**, `history.append` 직전에 불려 돌려준 문자열이 기록된다. `resolve`는 원래 줄 그대로 돌려준다. 취소(`cancelable` Ctrl+C)에는 부르지 않는다).
- RD-022a가 소스에 더한 공개 API(REPL `runSource`가 쓴다, `02-console-core.md` 5.6): `Readline.takeRead(): { text: string; cursor: number } | undefined`, 오류 클래스 `ReadTakenError`(export), `ReadOptions.prefillCursor?: number`.
  - **`takeRead()`**: 열린 읽기를 제출·history 없이 끝내고 그 읽기의 입력 상태를 가져간다. 열린 읽기(활성 읽기 또는 write 콜백을 기다리는 읽기)가 없으면 아무것도 하지 않고 `undefined`다. 활성 읽기면 화면에서 프롬프트 첫 행부터 입력 마지막 행까지(감긴 행·멀티라인 버퍼 포함)를 지우고(`\x1b[<행>A` + `\r\x1b[J`, `refreshLine` 3·4단계와 같은 계산을 `Tty.eraseLine(layout)`으로 뗀 것 — 새 비공개 레이아웃 상태에 의존하지 않는다) 커서를 프롬프트 첫 행 열 0에 두며 지우기 전의 `{ text, cursor }`(커서는 UTF-16 인덱스)를 돌려준다. 프롬프트 앞에 붙은 꼬리(`a>>> `의 `a`)도 프롬프트라 함께 지워지므로 복원은 호출자 몫이다. history는 건드리지 않는다.
  - **읽기 promise**: `ReadTakenError`로 reject한다. `ReadCancelledError`의 하위 클래스가 아니다. 소비자(REPL `readLine` 핸들러)가 `ReadCancelledError`(리셋 경로, 응답 없이 끝냄)와 구분해 `{ source }`로 응답해야 하고, 하위 클래스로 만들면 기존 `instanceof ReadCancelledError` 분기가 삼킨다. `read()`의 반환 타입 `Promise<string | null>`은 그대로다.
  - **경계**: (a) write 콜백 전의 읽기(`pendingReads`)는 그려지지 않았으므로 `{ text: "", cursor: 0 }`이고(`prefill`은 반영하지 않는다), 늦게 오는 콜백은 `cancelRead()`와 같은 `cancelled` 표시로 읽기를 되살리지 않는다. 활성 읽기와 그리기 전 읽기가 함께 있으면(오용) 활성 읽기의 값을 돌려주고 둘 다 끝낸다. (b) `printAbove` 재그리기 중이면 옛 입력줄 아래에 이미 출력이 써져 있어 화면을 지울 수 없다: 지우지 않고 재그리기 전의 논리 커서(`redrawCursor`, 겹친 호출은 처음 값 유지)와 텍스트를 돌려주며 늦게 오는 재그리기 콜백은 활성 읽기가 없어 입력줄을 다시 그리지 않는다. 옛 입력줄은 화면에 남는다. (c) 재그리기 중 쌓인 `queued`는 type-ahead로 옮겨 다음 읽기가 재생한다(6.7, `typeAhead: false`이면 버린다). 이미 쌓인 type-ahead는 비우지 않는다. (d) `takeRead()` 직후 `cancelRead()`는 이미 끝난 읽기를 `ReadCancelledError`로 바꾸지 않고 화면에 쓰지 않지만 type-ahead·`queued`는 비운다(위 RD-010 항목, `TRP-053`). (e) 입력이 뷰포트보다 커서 위쪽 행이 스크롤백으로 넘어갔으면 화면에 남은 행만 지운다(스크롤백은 지울 수 없다, `02-console-core.md` 5.6.7).
  - **`prefillCursor`**: `prefill`을 채운 직후 커서를 그 위치에 둔다. `Math.trunc` 뒤 `[0, prefill 길이]`로 자르고 `NaN`·`undefined`는 끝이다. `prefill`이 없거나 빈 문자열이면 무시한다. `State.update(text, cursor = text.length)`로 한 번의 `refresh()`에 그린다. 서로게이트 쌍 중간의 값은 검사하지 않는다(UTF-16 인덱스 그대로). `takeRead()`가 돌려준 `cursor`를 그대로 넘기면 커서가 복원된다.
  - 변경 목록은 `packages/xterm-readline/README.md`. 시험은 `take-read.test.ts`(39개, jsdom + `VTerm`).
- 업스트림 추적: 원격을 연결하지 않는다(runo-coincident와 같은 방식). 업스트림 변경을 가져올 때는 `CHANGELOG.md`의 버전 기준으로 수동 diff한다.

## 6.2 이전 구현이 적용한 수정(무엇을 / 어떤 방법으로) — 새 구현은 6.1 방침대로 소스에서 처리
| 항목 | 증상 | 들어간 방법 |
| --- | --- | --- |
| TRP-004 | `read(prompt)`가 커서 행을 열 0부터 다시 그려(`\r\x1b[J`) 개행 없는 출력이 지워짐 | 라이브러리를 고치지 않고 **브리지에서 꼬리를 프롬프트로 넘겨** 그 자리에 다시 그린다(`repl-reader.ts`, `stdin-reader.ts`). 옛 `cursorX !== 0` 개행 가드는 제거했다(`cursorX`는 비동기 파싱 값이라 낡는다) |
| TRP-008(이전 구현 문서, 이 저장소 `docs/traps/TRP-008`과 다름) | `read()`가 입력 상태를 **비동기로** 만들어 직후의 버퍼 조작이 사라짐 | 이전 구현: `term.write('', cb)` 콜백 안에서 `updateLine`/커서 복원/`editing` 복원을 한다. 취소 방어 해제도 `read()` 호출이 아니라 `activeRead`로 판단한다. 새 구현(RD-013): `ReadOptions.prefill`이 같은 콜백 안에서 처리하므로 코어가 콜백 타이밍을 알 필요가 없다 |
| TRP-016 | 여러 행으로 감기는 프롬프트의 첫 재그리기가 앞 행을 남김 | `read()` 앞에 `rewindTail`이 `\x1b[nA`로 첫 행까지 올린다(flush 후 `isWrapped` 카운트) |
| TRP-017 | 뷰포트를 채운 레이아웃에서 행이 늘 때 스크롤백 맨 윗행이 사라짐 | **미해결**. 보이는 화면은 정상이라 관찰로만 남겼다(꼬리 상한을 두려던 계획은 근거가 없어 폐기) |
| TRP-030 | `moveCursorBack(0)`은 줄 맨 앞으로 가고 `n`은 코드포인트 수 | 목록 재그리기 뒤 커서 복원에서 **0이면 호출을 생략**하고 개수는 `[...text]` 코드포인트로 센다 |
| TRP-006 | `readPaste`가 붙여넣은 `\t`를 버림 | 새 구현: `readPaste`(벤더 소스)가 `UnsupportedControlChar`+단일 `\t` 토큰만 `Text`로 승격해 버퍼에 보존한다(RD-011). 이전 구현은 `preservePastedTabs(readline)`가 `readPaste`를 런타임 패치했다 |
| TRP-001 | StrictMode 이중 마운트에서 dispose된 인스턴스의 지연 콜백 | 이전 구현: 상시 `while read()` 루프를 없애(필요할 때만 `read()` 호출) 재현이 사라졌다. 새 구현: `Readline.dispose()`가 `term`을 비워 소스에서 막는다(6.1). 마운트 직후 읽기를 시작해도 안전하다 |

## 6.3 자동 들여쓰기 규칙(`createAutoIndent(readline)`, RD-013 완료)
- 기준은 `_pyrepl/readline.py`의 `maybe_accept`/`backspace_dedent`. `terminal/auto-indent.ts`의 순수 함수
  (`nextIndentation`·`backspaceCount`·`indentUnitWidth`, `DEFAULT_UNIT = '    '`)가
  `_get_previous_line_indent`, `_get_first_indentation`, `_should_auto_indent`를 그대로 옮겼다(줄 끝 `#`
  주석 무시, 문자열 안 `#`를 주석으로 오인하는 한계까지 같다). pyodide에 든 `_pyrepl.readline`과 29케이스
  차분 검증한다(`auto-indent-parity.test.ts`).
- `createAutoIndent(readline)`는 이 순수 함수를 **세션 소유** 상태(`lastUsedIndentation: string | null`)와
  묶어 벤더 `ReadOptions`로 바꾸는 정책 객체다. `readOptions(pending): { prefill?, onKey }`가 유일한
  진입점이다. `lastUsedIndentation`은 이 객체가 사는 동안(세션 하나) 유지된다 — 2칸으로 쓴 블록 뒤의 새
  블록도 2칸, 새 세션(`startSession()`이 다시 부르는 `createAutoIndent`)은 4칸으로 돌아간다. `reset()`
  순서에 별도 초기화 단계는 없다 — 세션이 통째로 바뀌면서 새 객체가 되기 때문이다(`08-session.md` 8.1).
- 프리필: `readOptions(pending)`이 `pending`(worker가 보낸, 아직 제출되지 않은 블록 줄들)이 있으면
  `nextIndentation(pending, pending.length, lastUsedIndentation)`으로 `lastUsedIndentation`을 갱신하고
  결과를 `prefill`로 준다(빈 문자열이면 생략). `pending`이 없으면(새 `>>> ` 줄) `prefill`을 주지 않는다.
  벤더 `read()`가 `ReadOptions.prefill`을 write 콜백 안, `new State` 직후 1회 넣는다(6.1, TRP-008 문제
  해소).
- Backspace: `onKey`가 `InputType.Backspace`를 받으면 `backspaceCount(getLine(), getCursor(),
  indentUnitWidth(lastUsedIndentation), pendingBlock !== "")`가 1보다 클 때만 `editBackspace(n)`을 부르고
  `true`(소비)를 돌려준다 — 커서 앞이 스페이스뿐이고 `... ` 입력줄이거나(`pendingBlock` 있음) 여러 줄
  버퍼의 첫 줄이 아니면 직전 단위 배수까지 지운다. `>>> ` 첫 줄·탭 혼합·글자 뒤·줄 시작은 1(미소비, 벤더가
  원본대로 처리).
- Shift+Enter/Alt+Enter: `onKey`가 두 타입 모두에서 `prefix = pendingBlock ? pendingBlock + "\n" : ""`로
  이미 제출된 줄을 앞에 붙여 `nextIndentation(prefix + getLine(), prefix.length + getCursor(),
  lastUsedIndentation)`을 계산하고 `editInsert("\n" + indentation)` 한 번으로 개행+들여쓰기를 같이 넣은
  뒤 `true`를 돌려준다(`lastUsedIndentation`도 이 호출에서 갱신). **일반 Enter와 붙여넣기는 채우지 않는다**
  (`onKey`는 그 둘을 소비하지 않고 `false`를 돌려준다). 자동 dedent는 없다. 켜고 끄는 스위치도 없다.
- `input()` 읽기(stdin 리더)에는 `prefill`도 `onKey`도 전혀 넘기지 않는다 — 프리필·Shift+Enter 들여쓰기·
  Backspace 단위 삭제 모두 없고 벤더 원본 동작(개행만 삽입, Backspace는 1글자)이다.
- 취소(`cancelable` 읽기의 Ctrl+C)는 **벤더 `Readline` 소스**가 처리한다(6.1). 순서는 Enter 분기와 같게
  `state.moveCursorToEnd()` → `state.refreshUnhighlighted()` → `term.write("\r\n")` → `activeRead`를 먼저
  비우고 `resolve(null)`. reject는 쓰지 않는다(값이 RPC로 그대로 가야 한다). `^C`를 찍지 않고(3.14 프롬프트는
  raw mode, pty 실측) history에도 넣지 않는다(벤더는 Enter에서만 `history.append`). 화면은 `KeyboardInterrupt`
  (빨강) + 새 `>>> `이고 그 줄은 worker의 `run(null)`이 낸다(`02-console-core.md` 5.2). `lastUsedIndentation`은
  세션이 그대로라 취소로 사라지지 않는다(벤더는 들여쓰기 상태를 모른다 — RD-012b G1 재현).
- `cancelSettling`은 **벤더 readline이 아니라 main 게이트의 항**이다(`03-ctrl-c.md` 2.7): 취소 응답 뒤 다음
  요청이 도착하기 전의 Ctrl+C를 에코도 전송도 하지 않는다. 이전 구현이 `activeRead`로 판단해야 했던 비동기
  창(이전 구현 TRP-008: `read()` 호출과 입력 상태 생성 사이)은 새 구조에서 `readLinePending`(요청 도착 →
  응답)이 이미 덮으므로 두 구간이 이어져 빈틈이 없다. 벤더 readline은 REPL 정책을 모른다. `input()` 취소에는
  이 항을 세우지 않는다(`04-stdin-input.md` 3.1).
- 훅 호출 지점 = 벤더 `readKey`의 `activeRead === undefined` 검사 뒤, `switch` 앞. 모든 `InputType`(CtrlC·
  Enter 포함)을 넘긴다. `readPaste`의 `Text` 토큰은 훅을 거치지 않는다(붙여넣기 프리필 없음이 자동으로
  성립한다).
- 모듈 경계: `terminal/repl-reader.ts`의 `createReplReader(readline, term, sinks, autoIndent)`가
  `readline.read(합성 프롬프트, { cancelable, ...autoIndent.readOptions(pending) })`를 부른다. 가드
  (`read-guard.ts`)·`repl-main-driver.ts`의 RPC `readLine(prompt, pending, cancelable)` 핸들러는 `pending`을 그대로
  통과시킨다. stdin 리더(`stdin-reader.ts`)는 `autoIndent`를 받지 않는다.

## 6.4 블록 히스토리 규칙(`createBlockHistory(readline)`, RD-014 완료)
- 블록(`... `) 입력의 줄들을 history 항목 하나로 묶는 **세션 소유** 정책 객체(`terminal/block-history.ts`).
  `createReplMainDriver`(`repl-main-driver.ts`)가 `createAutoIndent` 옆에서 만든다(`08-session.md` 8.1). 노출은
  `readOptions(pending): Pick<ReplReadOptions, "historyEntry" | "onKey">`와 `discard(): void` 둘뿐이다 —
  블록 시작을 알리는 별도 메서드는 없다. 매 REPL 읽기가 `readOptions(pending)` 호출 자체로 시작을 겸한다.
- 기록 방식은 **"진행형 교체"**: 블록 첫 줄이 append되기 직전의 `entries` 스냅샷(`beforeFirstLine`)을
  기준점(`blockBase`)으로 잡고, 이어지는 줄을 제출할 때마다 `history.restore(blockBase)`로 되돌린 뒤
  `(pendingBlock + '\n' + 방금 줄).trimEnd()`를 `historyEntry` 훅이 돌려줘 기록한다(항상 최신 블록 항목
  하나). "블록이 끝난 뒤 1회 기록"은 `exit()`로 끝난 블록이 유실돼 채택하지 않았다.
  - `readOptions(pending)`: `pendingBlock = pending ?? ""`. `pending`이 없으면(새 `>>> ` 줄)
    `blockBase = null`(기준점 해제) — 있으면(`... ` 줄) `blockBase ??= beforeFirstLine`(이미 있으면 유지).
  - `historyEntry(line)`: `blockBase === null`이면 `beforeFirstLine = getHistory().entries.slice()`(다음
    블록을 위한 스냅샷) 후 `line`을 그대로 반환. `blockBase`가 있으면 `getHistory().restore(blockBase)` 후
    `(pendingBlock + '\n' + line).trimEnd()`를 반환.
- 블록 텍스트는 worker가 준 `pending`에서 만든다(프로토콜 변경 없음). 종료용 공백 줄은 `skipBlankHistory`가
  걸러 훅이 안 불린다(항목 불변). 블록 안 빈 줄은 보존한다. 문법 오류·예외로 끝난 블록도 전체가 남는다.
- `discard()`: `blockBase !== null`이면 `getHistory().restore(blockBase)` 후 `blockBase = null`. 블록이
  없으면 무동작. 스냅샷 복원이므로 첫 줄 append가 밀어낸 항목(50개 제한)·중복 제거로 옮겨진 옛 항목도 함께
  복구된다. 호출 지점은 둘: **취소** = `repl-main-driver.ts`의 `readLine` continuation에서 `line === null`일 때.
  **리셋** = REPL main driver의 `terminate` 훅(core 세션 `terminate()`가 부른다)이 `readline.cancelRead()` **앞**에서 `if (reading) blockHistory.discard()`
  (`reading`은 REPL 읽기 전용 플래그라 `input()` 대기 중·실행 중·`exit()`로 끝난 블록은 자동 제외 —
  `08-session.md` 8.1).
- `... ` 입력줄의 ↑ 삼킴 판정은 **공개 API만으로** 한다: `onKey`가 `pending`이 있고(`pendingBlock !== ""`)
  `getLine()`에 `"\n"`이 없으면 ArrowUp을 삼킨다(`true`). 벤더 내부 `state.editing`(private)과의 동치 근거:
  `editing === true`인 한 줄 버퍼에서 벤더 ↑는 원래 무동작이라 삼켜도 화면이 같고, `... `의 여러 줄 버퍼는
  Shift+Enter·붙여넣기(둘 다 `editInsert` → `editing = true`)로만 생긴다 — `getLine()`에 개행이 있으면(여러
  줄 버퍼) 삼키지 않고 벤더 줄 이동에 맡긴다. ↓는 읽기 시작 시 `history.cursor === -1`이라 따로 막지 않는다.
- `skipBlankHistory`(RD-013 완료)와 합성한다: `Readline` 생성자 옵션 `ReadlineOptions.skipBlankHistory`가
  벤더 안에서 처리한다(6.1) — 코어는 `new Readline({ persist: false, skipBlankHistory: true })`로 켠다.
  블록 히스토리는 이 옵션이 이미 거른 뒤의 Enter 제출(`historyEntry` 호출)만 본다.
- `... `에서 Enter 1회로 제출된 여러 줄(붙여넣기·Shift+Enter)은 제출 텍스트 전체를 블록에 잇는다
  (`(pendingBlock + '\n' + 제출텍스트).trimEnd()`). 붙여넣은 텍스트가 블록을 끝내고 top-level 문장까지
  포함하면 그것도 같은 항목에 남는다(main은 블록 종료를 판정할 수 없다, `docs/traps/TRP-005`). 3.14도
  붙여넣기는 한 항목이라 이 규칙은 편차가 아니다(`10-parity-deviations.md`).
  - **`>>> `에서 붙여넣은 여러 줄이 블록을 "열어 둔 채" 끝나고 다음 `... ` 읽기가 그 `pending`을 이어받는
    경로는 구조적으로 불가능하다.** `worker/submission-runner.ts`의 `runMultiline`/`runChunk`이 돌려주는
    반환 경로 3곳 전부 `pending`을 절대 실어 보내지 않기 때문이다 — Python 버전과 무관한 코드 구조상의
    제약이며 재현 실패가 아니다(`10-parity-deviations.md`, DELTA-04a). 붙여넣기가 즉시 완결되지 않고
    `... `로 이어지는 유일한 경로는 애초에 `... ` 프롬프트에서 붙여넣는 경우뿐이다.
- 재호출한 블록은 Enter 1회로 실행된다(여러 줄 제출 경로). history는 중복을 제거한다(3.14는 안 한다,
  편차 9).
- 리더 합성 순서: `repl-main-driver.ts`가 `mergeReadOptions(blockHistory.readOptions(pending),
  autoIndent.readOptions(pending))`로 합성한다(blockHistory 먼저 — ↑ 삼킴은 blockHistory만 보고 겹치는
  키가 없다). `mergeReadOptions`는 `terminal/read-options.ts`의 순수 함수다(6.3·`00-architecture.md` 4.2).

## 6.5 붙여넣기
- 개행은 `\n`으로 편집 버퍼에 삽입되고 자동 제출하지 않는다. Enter 1회로 실행한다(러너의 여러 줄 분할 규칙은
  `02-console-core.md` 5.2).
- `\t`는 벤더 `readPaste`가 보존한다(6.1·6.2, RD-011). 직접 Tab 키 입력은 REPL 읽기의 `onKey`(Tab 리더)가
  소비한다(RD-015 완료, `07-tab-completion.md` 7.1). 탭은 8칸 폭으로 표시된다.
- 붙여넣기 토큰(`readPaste`)은 `onKey`를 거치지 않으므로 Tab 리더의 `lastKeyWasTab` 판정에도 반영되지
  않는다 — Tab, 붙여넣기, Tab 순서로 치면 두 번째 Tab도 "연속 두 번째"로 판정돼 목록이 열린다(RD-015 등록,
  `10-parity-deviations.md`).
- 붙여넣은 블록의 둘째 줄부터 `... ` 접두사가 없다(`State`가 첫 줄에만 prompt를 렌더링한다 — 라이브러리 제약).
- 프리필된 `... ` 줄에 들여쓴 여러 줄을 붙여넣으면 이중 들여쓰기가 된다(3.14도 같다).
- 붙여넣은 탭 뒤 커서 위치(RD-011 DELTA-04 관찰): 붙여넣기 직후 커서는 붙여넣은 텍스트의 마지막 줄 끝에
  있다(정상 — 붙여넣기는 삽입 지점에 커서를 남긴다). 화면 표시는 xterm 탭 스톱(8칸)으로 렌더링되지만 버퍼
  원문은 `\t`를 그대로 유지한다. 커서를 탭이 있는 줄 중간으로 옮긴 뒤(예: 화살표 키) Backspace로 그 탭을
  지울 때 벤더 레이아웃(`state.ts`)이 탭의 실제 폭(가변, 탭 스톱에 따라 달라짐)을 아는지는 확인하지 않았다
  (관찰만, 고치지 않음 — 확정 10).

## 6.6 선택 복사(RD-017 완료 — 선택 시 자동 복사, 선택 중 Ctrl+C는 복사)

규칙(사용자 결정 2026-09-23. Windows Terminal·VS Code 터미널의 "선택 있으면 Ctrl+C=복사, 없으면 SIGINT"
관례를 따른다):

- **선택 시 자동 복사**: 마우스 드래그·더블클릭(단어)·트리플클릭(줄)으로 선택을 만들고 버튼을 뗀 순간
  `term.getSelection()`을 `navigator.clipboard.writeText`로 복사한다. 기본 켜짐. 앱이 끌 수 있다
  (`ReplOptions.copyOnSelect`, `ReplHandle.setCopyOnSelect(on)`, `00-architecture.md` 4.1). 선택은 지우지
  않는다(강조가 남아 있어야 사용자가 무엇을 복사했는지 안다).
- **선택 중 Ctrl+C = 복사**: `ctrlKey && !altKey && !metaKey && key.toLowerCase() === "c" && term.hasSelection()`
  (Shift 유무 무관 — Ctrl+Shift+C도 같다)이면 복사하고 **`term.clearSelection()`**으로 선택을 지운 뒤 이벤트를
  끝낸다(`preventDefault`, xterm 기본 처리 생략). 실행 중이면 SIGINT를 보내지 않고 `^C`도 찍지 않으며,
  `>>> `·`... `·`input()` 읽기 중이면 취소하지 않는다. 자동 복사가 켜져 있으면 이 경로는 "재복사 + 선택 해제"
  다. 선택을 지우는 이유: 지우지 않으면 선택이 남아 있는 동안 Ctrl+C가 계속 복사만 해 무한 루프 실행을 끊을
  수 없다. `copyOnSelect`와 무관하게 항상 켜져 있다.
- **선택 없는 Ctrl+C**: 기존 그대로(RD-007 인터럽트, RD-008 취소, `03-ctrl-c.md`·6.3). Mac의 Cmd+C는 xterm이
  ETX로 바꾸지 않고 브라우저 네이티브 복사가 이미 되므로 `metaKey`는 조건에서 제외한다.
- **알림**: 복사 결과를 `ReplOptions.onCopy?: (result: CopyResult) => void`로 앱에 알린다.
  `CopyResult = { ok: true; chars: number } | { ok: false; error: unknown }`. `chars`는 **코드포인트 수**
  (`[...text].length`, `"😀"`은 1)이고 여러 줄 선택의 개행이 포함된다(`getSelection()`은 행을 `\n`으로 잇고
  행 끝 공백을 지운다). 코어는 DOM 오버레이를 그리지 않는다 — Terminal과 컨테이너는 앱 소유다. 데모는
  우측 하단 고정 `<div role="status" data-testid="copy-toast">`에 `copied N chars to clipboard` 또는
  `copy failed`를 1초 표시한다(`00-architecture.md` 4.1). 실패는 조용히 무시하지 않는다 — 사용자가 복사됐다고
  오해하는 것을 막는다.

기전(terminal 패키지 `packages/pyodide-terminal/src/selection-copy.ts`, `createRepl`이 핸들 수명으로 만든다 — 세션이 아니다):

- 키 가로채기는 **벤더 공개 훅** `ReadlineOptions.onKeyEvent?: (event: KeyboardEvent) => boolean`이다.
  `Readline.handleKeyEvent`(xterm `attachCustomKeyEventHandler`에 등록된 벤더 핸들러)가 자기 처리(Shift+Enter)
  **앞에서** 부르고 `true`(소비)면 xterm에 `false`를 돌려준다. xterm 6은 커스텀 핸들러가 `false`를 주면
  `evaluateKeyboardEvent`(ETX 변환)·`onData`·`preventDefault` 전부를 건너뛰므로 벤더 `readKey`에 `CtrlC`가
  도달하지 않는다. `keydown`·`keypress`·`keyup` 모두 이 훅을 거치므로 훅은 `event.type === "keydown"`만
  본다. 코어가 `attachCustomKeyEventHandler`를 직접 걸면 벤더 것을 덮어쓰므로 쓰지 않는다. 6.1의
  "공개 훅" 목록에 이 훅을 더한다. 이전 설계(캡처 단계 `keydown` 리스너)는 `terminal.element` 존재와 DOM
  순서에 의존해 기각했다.
- 네이티브 `copy` 경로(xterm이 `element`의 `copy` 이벤트에서 `hasSelection()`이면 선택 텍스트를
  `clipboardData`에 넣는다)는 쓰지 않는다 — 성공·실패를 알 수 없어 `onCopy`를 채울 수 없고, 자동 복사 경로와
  기전이 둘로 갈린다. 훅이 `preventDefault()`를 불러 네이티브 복사가 중복으로 일어나지 않게 한다.
- 자동 복사는 `terminal.element`에 `mousedown`(`button === 0`이면 `dragging = true`)을, **`element.ownerDocument`
  에 `mouseup`**을 건다 — xterm 자신도 드래그 중 `mouseup`을 `document`에서 듣고, 터미널 밖에서 버튼을 떼는
  드래그가 흔하다. `mouseup`에서 `dragging`이었고 `hasSelection()`이면 복사한다(단순 클릭은 xterm이 `mousedown`
  에서 선택을 지우므로 복사하지 않는다). `mouseup`에서 `getSelection()`을 **동기로** 읽는다 — xterm이 드래그 중
  `mousemove`마다 선택 모델을 갱신하므로 `mouseup` 시점에 이미 최종값이다. 브라우저 실측(DELTA-05, dev 14/14 +
  preview 4/4 반복)에서 낡은 값이 관찰된 적이 없어 `setTimeout(0)` 우회는 필요하지 않았다(설계 단계에 남겨 둔
  대비책이었을 뿐, 실장에는 없다). `onSelectionChange`는 드래그 중 이동마다 발화해 복사 트리거로 쓰지
  않는다. `createRepl` 시점에 `terminal.element`가 없으면(`open()` 전) 자동 복사를 걸지 않는다 — 데모는
  `open()` 뒤에 부른다(`ReplView.tsx`). 터치·키보드 선택(`selectAll` API)은 범위 밖.
- 정책 객체 `createSelectionCopy(terminal, { copyOnSelect, onCopy, writeText })`는 `onKeyEvent(event)`·
  `setCopyOnSelect(on)`·`dispose()`를 노출한다. `writeText`는 시험용 주입(기본 `navigator.clipboard.writeText`).
  판정은 순수 함수(`decideKey({ ctrlKey, altKey, metaKey, key, type }, hasSelection) → "copy" | "pass"`)로 분리해
  node 시험한다. `dispose()`가 리스너 둘을 떼고 이후 `onKeyEvent`는 항상 `false`다. `createRepl.dispose()`
  순서: `session.endSession()` → `session.terminate()` → **`selectionCopy.dispose()`** → `readline.dispose()`.
  `reset()`은 건드리지 않는다(핸들 수명).
- Ctrl+L(화면 지우기)과 세션 리셋은 별개 기능으로 유지한다. Ctrl+D(빈 줄 EOF)는 구현하지 않았다.

편차: 3.14 pty에는 선택 개념이 없어 Ctrl+C는 항상 SIGINT이고 자동 복사도 없다 → `10-parity-deviations.md`
편차 43으로 등록했다.

참고: `/work/cp949/pyodide-samples/apps/repl/docs/design/03-selection-copy.md`,
이전 구현 설계 문서 `09-auto-indent.md`, `10-block-history.md`,
`/work/cp949/pyodide-samples/docs/repl/traps/`(TRP-001·004·006·008·016·017·030)

## 6.7 읽기가 없는 구간의 키 버퍼링(type-ahead, RD-019 완료)

3.14는 실행 중 tty가 입력을 큐에 쌓고 다음 프롬프트가 그 큐를 읽는다. 벤더 `Readline`이 같은 일을 한다(코어 래퍼가 아니다 — 재생이 `read()` write 콜백 안,
`new State`·`prefill` 직후여야 하고 코어는 그 타이밍을 볼 수 없다). 공개 API 추가 없음.

- **쌓는 구간**: `activeRead`가 없는 모든 때. 실행 중, Enter 직후 `read()` write 콜백 대기 중(약 20ms, `10-parity-deviations.md` 32의 옛 측정), `cancelSettling`, 부팅·로딩 중.
  부팅 중 친 키는 쌓였다가 첫 프롬프트에서 재생한다(별도 코드 없음).
- **쌓는 대상**: `onData` 덩어리 중 아래 둘을 뺀 전부(글자·Enter·Tab·방향키·Backspace·Ctrl+D·U·K·붙여넣기). 원본 문자열째 쌓는다. **Shift+Enter**도 쌓는다: `handleKeyEvent`가 `keydown`에서
  `readData`와 같은 분기(`dispatch`)로 보내 `Input` 항목(`InputType.ShiftEnter`, 길이 1)으로 쌓는다(버퍼 항목 타입은 `string | Input`). `parseInput` 결과가 토큰 1개이고 `CtrlC`·`CtrlL`일
  때만 "즉시 처리"로 본다. `ab\x03cd` 같은 다중 토큰 덩어리는 덩어리째 쌓이고 재생 때 활성 읽기의 Ctrl+C로 처리된다(xterm은 키마다 `onData`를 따로 부르고 덩어리는 붙여넣기에서만 오므로 드문 경우).
- **쌓지 않는 것**:
  - **Ctrl+L**은 지금처럼 즉시 화면을 지운다(쌓지 않는다). 실행 중 Ctrl+L의 꼬리 규칙은 편차 40.
  - **Ctrl+C**는 쌓지 않고 버퍼를 **무조건** 비운 뒤 `ctrlCHandler`를 부른다(게이트 결과와 무관, tty `ISIG`의 입력 큐 비움과 같다). 창 안의 Ctrl+C 자체는 여전히 에코·전송이
    없다(`03-ctrl-c.md` 2.7). 그래서 Ctrl+C는 새 프롬프트가 보인 뒤에 보내야 한다(`docs/traps/TRP-005`).
- **상한**: 합계 4096 UTF-16 코드 유닛(`TYPE_AHEAD_LIMIT`). 넘치는 덩어리는 **통째로** 버리고(앞에 쌓인 것은 유지, 이후의 작은 덩어리는 여전히 받는다) 알림이 없다. 앞에서부터
  잘라 채우지 않는다(서로게이트 쌍·이스케이프 시퀀스 중간 절단 방지). 3.14 tty는 한 줄 4095자까지 남기고 나머지를 버린다(편차 49).
- **수명 주기**: `cancelRead()`(세션 리셋의 `terminate()`가 유일한 호출처)가 버퍼를 비운다 — 리셋은 새 프로세스라 옛 맥락의 키를 넘기지 않는다. 이후 새 세션 부팅 중 친 키는 다시 쌓인다. `cancelRead()` 이전에 `queued`에 쌓인 키는 폐기하고(`redrawing`도 함께 푼다), 이후 `printAbove` 콜백 전에 도착한 키는 `typeAhead`에 쌓는다.
  `cancelRead()`는 열린 읽기가 없어도 비운다(`takeRead()` 직후 호출도 마찬가지이므로 `runSource` 진행 중에는 리셋 외에 부르지 않는다, 5.6.5). `takeRead()`는 이미 쌓인 type-ahead를 비우지 않고 재그리기 중 쌓인 `queued`를 type-ahead로 옮긴다. `dispose()`는 비우고 재생하지 않는다. `Readline`은 핸들이 하나만 만들어 세션 리셋 사이에도 공유하므로 이 두 곳이 버퍼의 유일한 폐기 지점이다(Ctrl+C 제외).
- **재생**: `read()`의 write 콜백에서 `activeRead` 설정·`new State`·`prefill` 뒤 동기로 한다. 스냅샷을 먼저 꺼내 비운 뒤 덩어리마다 `readData`로 다시 넣으므로 `onKey` 훅(Tab 리더·자동 들여쓰기)과
  `readPaste` 경로를 그대로 탄다. `Input` 항목(Shift+Enter)은 `readKey`로 가서 `onKey` 훅(자동 들여쓰기, 6.3)을 거친다 — 실행 중 `if 1:` Shift+Enter `pass`는 다음 프롬프트에
  `>>> if 1:` / `    pass`(4칸 들여쓰기)로 재생된다. 낡은 `State`에는 그리지 않는다(붙여넣기 포함).
- **읽기당 소비**: 재생 중 Enter로 읽기가 끝나면 남은 덩어리는 `activeRead`가 없어 다시 버퍼로 들어가 순서가 보존되고 다음 읽기가 받는다. 실행 중 `ab⏎cd`는 첫 줄 `ab`가 제출되고 `cd`가
  다음 프롬프트 `>>> cd`에 남는다. 다음 읽기가 `input()`이면 첫 줄이 그 값이다(read-guard는 stdin 읽기 시작을 활성 REPL 읽기가 끝난 뒤로 미룰 뿐 버퍼와 무관하다, `04-stdin-input.md`).
- **`printAbove`의 `queued`와의 관계**: 별개로 둔다(통합하지 않는다). `queued`는 재그리기(`redrawing`) 중 도착한 키를 재그리기 콜백에서 재생하고, type-ahead는 `activeRead`가 없을 때를 맡는다.
  재생 키가 `printAbove`(Tab 완성 목록 등)로 재그리기를 시작하면 남은 덩어리는 `readData`의 `redrawing` 분기로 `queued`에 들어가 순서가 보존된다(벤더 시험 "재생 키가 printAbove로 …").
  Shift+Enter도 같은 분기를 타므로 재그리기 중 친 Shift+Enter가 먼저 친 키보다 앞서 적용되지 않고 `queued`를 거쳐 순서를 지킨다.
- **알려진 경계**: Tab 뒤에 키가 이어진 입력(`os.getc`+Tab+`()`)은 재생이 한 틱에 끝나 Tab의 worker 왕복 응답 전에 뒤 키가 들어가 완성이 버려진다(편차 48).
- **`typeAhead: false`**(RD-022, 실행창): 위 "쌓는 구간"의 입력을 쌓지 않고 버린다. 차단 기준은 벤더의 `activeRead === undefined`라서 `read()`를 부른 직후 write 콜백이 오기 전에 친 키도 버려진다. 기본값(`true`)은 그 창의 키를 콜백에서 재생한다(`14-runner.md` 14.5.2, 편차 52).
- **에코**: 실행 중에는 아무것도 그리지 않고 다음 읽기에서 입력줄로만 그린다. 3.14의 tty 에코는 따르지 않는다(편차 45). 실행 중 `←`·Ctrl+D·Tab 뒤 키는 편차 46~48이다.
- **시험**: 벤더 `type-ahead.test.ts`(재생·순서·Ctrl+C·Ctrl+L·`cancelRead`·`dispose`·붙여넣기·상한·`onKey`·`printAbove` 순서·pty 대조 값), 브라우저
  `apps/demo/e2e/checks/type-ahead-check.mjs`(`e2e:type-ahead`, Shift+Enter는 T12), 3.14.4 pty 기준 `apps/demo/e2e/pty/rd-019/`.
