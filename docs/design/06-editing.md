# 편집: 벤더링한 xterm-readline·자동 들여쓰기·블록 히스토리·붙여넣기·선택 복사

> 이 문서의 규칙·상수는 이전 구현(`/work/cp949/pyodide-samples/apps/repl`, 읽기 전용 참고)이 CPython 3.14.4 pty 실측과 브라우저 회귀로 확정한 것이다. 새 구현은 통신 계층만 바꾸고(`docs/design/00-architecture.md`, `01-protocols.md`) 이 규칙은 그대로 지킨다. 절 끝의 "참고:" 경로는 이전 구현의 근거 위치다.

## 6.1 xterm-readline 사용 방식 (새 구현)

- 이전 구현은 npm `xterm-readline@1.2.2`를 그대로 설치하고 모든 수정을 **런타임 래핑**(타입상 private인 `readKey`/`state`/`activeRead`/`history`/`readPaste`를 감쌈)으로 넣었다. 우회 7건 중 4건(TRP-006·008·016·030)이 비공개 내부에 의존했다.
- 새 구현은 소스를 **`packages/xterm-readline`(`@cp949/runo-xterm-readline`)으로 벤더링**한다([ADR-0003](../adr/0003-vendor-xterm-readline.md)). 원본은 `/work/thrd/xterm-readline`(strtok/xterm-readline 1.2.2, MIT, `src/*.ts` 2,832행 중 테스트 제외 약 1,470행). `LICENSE-MIT`와 저작권 고지를 패키지에 유지한다.
- 벤더링 뒤 수정 방침: 아래 6.2 표의 우회 중 **TRP-006(`readPaste` 탭 보존)·TRP-016/TRP-004(재그리기 전제)·TRP-030(`moveCursorBack` 단위)은 소스에서 직접 고치고**, `read()`의 write 콜백 타이밍(TRP-008)은 공개 훅(`onInputReady` 콜백 또는 `read()`가 입력 상태 생성 뒤 resolve되는 `ready` Promise)으로 계약을 명시한다. `InputType`은 export해 상수 복제를 없앤다. `History`에 `replaceFrom(snapshot)`/`truncate(n)` 같은 삭제 API를 추가해 블록 히스토리의 "진행형 교체" 스냅샷 우회를 단순화할 수 있다(선택, RD 항목에서 결정).
- `History`의 `localStorage` 자동 저장/복원은 옵션으로 끈다(벤더링했으므로 no-op 덮어쓰기 대신 생성자 옵션 `persist: false`).
- `Readline.dispose()`는 리스너를 해제하고 `term`을 비우며 대기 중인 읽기(write 콜백 대기 중이라 `activeRead`가 없는 것 포함)를 `Error("readline disposed")`로 reject한다. 두 번째 호출은 무동작이다(RD-003). `term.dispose()`가 로드된 addon을 다시 dispose하므로 멱등이 필수다. dispose 뒤 `read()`는 reject하고 `println`·`print`는 터미널에 쓰지 않는다. 실제 xterm 6은 `term.dispose()` 뒤에도 write 콜백을 돌리고 그 안의 `term.buffer` 읽기는 `DisposableStore` 경고를 낸다.
- `Tty`·`State`·`InputType`·`History`를 패키지에서 export한다. 코어(`packages/pyodide-repl`)는 이 export만 쓰고 private 멤버에 손대지 않는다. 코어가 필요로 하는 진입점은 벤더에 **공개 훅**으로 추가한다: 입력 준비 알림(프리필, 6.3 — RD-013), 키 가로채기(Tab, `07-tab-completion.md` 7.1 — RD-015). 붙여넣기 탭 보존(TRP-006)은 훅이 아니라 `readPaste` 소스 수정이다(RD-011).
- RD-008이 소스에 더한 공개 API: `read(prompt: string): Promise<string>` / `read(prompt: string, options: ReadOptions): Promise<string | null>` 오버로드와 `ReadOptions = { cancelable?: boolean }`(기본 `false` = 원본 `^C` + 같은 프롬프트 재그리기). `cancelable`이면 활성 읽기 중 Ctrl+C가 읽기를 `null`로 끝낸다(6.3). 오버로드라 기존 `read(prompt)` 호출부의 반환형은 `Promise<string>`으로 남는다. `ReadOptions`도 export한다.
- 업스트림 추적: 원격을 연결하지 않는다(runo-coincident와 같은 방식). 업스트림 변경을 가져올 때는 `CHANGELOG.md`의 버전 기준으로 수동 diff한다.

## 6.2 이전 구현이 적용한 수정(무엇을 / 어떤 방법으로) — 새 구현은 6.1 방침대로 소스에서 처리
| 항목 | 증상 | 들어간 방법 |
| --- | --- | --- |
| TRP-004 | `read(prompt)`가 커서 행을 열 0부터 다시 그려(`\r\x1b[J`) 개행 없는 출력이 지워짐 | 라이브러리를 고치지 않고 **브리지에서 꼬리를 프롬프트로 넘겨** 그 자리에 다시 그린다(`repl-reader.ts`, `stdin-reader.ts`). 옛 `cursorX !== 0` 개행 가드는 제거했다(`cursorX`는 비동기 파싱 값이라 낡는다) |
| TRP-008 | `read()`가 입력 상태를 **비동기로** 만들어 직후의 버퍼 조작이 사라짐 | `term.write('', cb)` 콜백 안에서 `updateLine`/커서 복원/`editing` 복원을 한다. 취소 방어 해제도 `read()` 호출이 아니라 `activeRead`로 판단한다 |
| TRP-016 | 여러 행으로 감기는 프롬프트의 첫 재그리기가 앞 행을 남김 | `read()` 앞에 `rewindTail`이 `\x1b[nA`로 첫 행까지 올린다(flush 후 `isWrapped` 카운트) |
| TRP-017 | 뷰포트를 채운 레이아웃에서 행이 늘 때 스크롤백 맨 윗행이 사라짐 | **미해결**. 보이는 화면은 정상이라 관찰로만 남겼다(꼬리 상한을 두려던 계획은 근거가 없어 폐기) |
| TRP-030 | `moveCursorBack(0)`은 줄 맨 앞으로 가고 `n`은 코드포인트 수 | 목록 재그리기 뒤 커서 복원에서 **0이면 호출을 생략**하고 개수는 `[...text]` 코드포인트로 센다 |
| TRP-006 | `readPaste`가 붙여넣은 `\t`를 버림 | `preservePastedTabs(readline)`가 `readPaste`를 감싼다(붙여넣기 경로에서만) |
| TRP-001 | StrictMode 이중 마운트에서 dispose된 인스턴스의 지연 콜백 | 이전 구현: 상시 `while read()` 루프를 없애(필요할 때만 `read()` 호출) 재현이 사라졌다. 새 구현: `Readline.dispose()`가 `term`을 비워 소스에서 막는다(6.1). 마운트 직후 읽기를 시작해도 안전하다 |

## 6.3 자동 들여쓰기 규칙(`createAutoIndentReader(readline, term)`)
- 기준은 `_pyrepl/readline.py`의 `maybe_accept`/`backspace_dedent`. `auto-indent.ts`가
  `_get_previous_line_indent`, `_get_first_indentation`, `_should_auto_indent`를 그대로 옮긴 순수 함수다
  (줄 끝 `#` 주석 무시, 문자열 안 `#`를 주석으로 오인하는 한계까지 같다).
- 단위는 `lastUsedIndentation`(= `_pyrepl`의 `last_used_indentation`)이고 **세션 동안 유지**된다.
  2칸으로 쓴 블록 뒤의 새 블록도 2칸, 새 세션은 4칸(`DEFAULT_UNIT = '    '`). 이 상태는 main 한 곳에 둔다
  (`... ` 경로와 Shift+Enter가 같은 상태를 써야 3.14의 단일 reader와 같다). `reset()`은 worker를 새로
  만들 때만 비운다.
- 프리필: 블록 입력 중(`pending`이 있음) 다음 입력줄에 직전 줄 들여쓰기 + (`:` 뒤면) 단위를 채운다.
  `read()` 직후가 아니라 write 콜백 안에서 넣는다(TRP-008).
- Backspace: 커서 앞이 스페이스뿐이고 `... ` 입력줄이거나 여러 줄 버퍼의 첫 줄이 아닌 줄이면 직전 단위
  배수까지 지운다(최소 1글자). `>>> ` 첫 줄·탭 혼합·글자 뒤·줄 시작은 1글자.
- Shift+Enter/Alt+Enter: 개행을 넣은 뒤 같은 규칙으로 채운다(`... `에서는 이미 제출된 줄을 앞에 붙여 계산).
  **일반 Enter와 붙여넣기는 채우지 않는다.** 자동 dedent는 없다. 켜고 끄는 스위치도 없다.
- 취소(`cancelable` 읽기의 Ctrl+C)는 **벤더 `Readline` 소스**가 처리한다(6.1). 순서는 Enter 분기와 같게
  `state.moveCursorToEnd()` → `state.refreshUnhighlighted()` → `term.write("\r\n")` → `activeRead`를 먼저
  비우고 `resolve(null)`. reject는 쓰지 않는다(값이 RPC로 그대로 가야 한다). `^C`를 찍지 않고(3.14 프롬프트는
  raw mode, pty 실측) history에도 넣지 않는다(벤더는 Enter에서만 `history.append`). 화면은 `KeyboardInterrupt`
  (빨강) + 새 `>>> `이고 그 줄은 worker의 `run(null)`이 낸다(`02-console-core.md` 5.2). `lastUsedIndentation`은
  RD-013이 유지한다(벤더는 들여쓰기 상태를 모른다).
- `cancelSettling`은 **벤더 readline이 아니라 main 게이트의 항**이다(`03-ctrl-c.md` 2.7): 취소 응답 뒤 다음
  요청이 도착하기 전의 Ctrl+C를 에코도 전송도 하지 않는다. 이전 구현이 `activeRead`로 판단해야 했던 비동기
  창(TRP-008: `read()` 호출과 입력 상태 생성 사이)은 새 구조에서 `readLinePending`(요청 도착 → 응답)이 이미
  덮으므로 두 구간이 이어져 빈틈이 없다. 벤더 readline은 REPL 정책을 모른다. `input()` 취소에는 이 항을
  세우지 않는다(`04-stdin-input.md` 3.1).
- 벤더 시그니처는 `read(prompt, options?: { cancelable?: boolean })`이다. RD-013의 auto-indent 래퍼가 그
  `read()`를 감싸고 `pending`을 받아 프리필을 넣는다(래퍼가 취소 분기를 바꾸지는 않는다).

## 6.4 블록 히스토리 규칙(`groupBlockHistory(readline)`)
- `history.append`를 감싼다. 기록 방식은 **"진행형 교체"**: 블록 첫 줄이 append되기 직전의 `entries`
  스냅샷을 기준점으로 잡고, 이어지는 줄을 제출할 때마다 `entries`를 기준점으로 되돌린 뒤
  `(pending + '\n' + 방금 줄).trimEnd()`를 원래 `append`로 넣는다(항상 최신 블록 항목 하나).
  "블록이 끝난 뒤 1회 기록"은 `exit()`로 끝난 블록이 유실돼 채택하지 않았다.
- 블록 텍스트는 worker가 준 `pending`에서 만든다(프로토콜 변경 없음). 종료용 공백 줄은 `trimEnd()`로
  직전 항목과 같아져 따로 거르지 않는다. 블록 안 빈 줄은 보존한다. 문법 오류·예외로 끝난 블록도 전체가 남는다.
- `beginRead(pending)`이 시작/이어짐/끝(`pending` 없음 = 기준점 해제)을 알리고, 취소와 `reset()`이
  `discard()`로 기준점까지 되돌린다. 스냅샷 복원이므로 첫 줄 append가 밀어낸 항목도 복구된다.
  `reset()`은 **입력을 기다리는 블록(`activeRead` 있음)만** 버린다.
- `... ` 입력줄의 ↑는 `pendingBlock !== ''`이고 `state.editing === false`이면 삼킨다(진행형 항목이 작성 중인
  블록 자신이라 자기 자신이 들어온다). ↓는 `history.cursor`가 -1이라 따로 막지 않는다.
- `skipBlankHistory`와 합성한다: `ReplTerminal`이 `skipBlankHistory` → reader 순으로 감싼다.
- 재호출한 블록은 Enter 1회로 실행된다(여러 줄 제출 경로). history는 중복을 제거한다(3.14는 안 한다).

## 6.5 붙여넣기
- 개행은 `\n`으로 편집 버퍼에 삽입되고 자동 제출하지 않는다. Enter 1회로 실행한다.
- `\t`는 `preservePastedTabs`가 보존한다. 탭은 8칸 폭으로 표시된다.
- 붙여넣은 블록의 둘째 줄부터 `... ` 접두사가 없다(`State`가 첫 줄에만 prompt를 렌더링한다 — 라이브러리 제약).
- 프리필된 `... ` 줄에 들여쓴 여러 줄을 붙여넣으면 이중 들여쓰기가 된다(3.14도 같다).

## 6.6 선택 복사
- 단축키는 **Ctrl+Shift+C**. Ctrl+C는 취소/중단으로 이미 점유돼 있다(`@xterm/xterm` v6의
  `evaluateKeyboardEvent`는 선택 여부와 무관하게 ETX(0x03)로 바꿔 흘린다).
- `xterm-readline`이 `term.attachCustomKeyEventHandler`를 이미 점유하므로 앱이 또 걸면 덮어쓴다. 대신
  **터미널 컨테이너에 캡처 단계 `keydown` 리스너**를 달아 readline에 도달하기 전에 가로챈다.
- 조건: `ctrlKey && shiftKey && key.toLowerCase() === 'c' && term.hasSelection()`.
  `preventDefault()` + `stopPropagation()` 뒤 `navigator.clipboard.writeText(term.getSelection())`.
  실패(권한 거부 등)는 조용히 무시. cleanup에서 리스너를 뗀다.
- Ctrl+L(화면 지우기)과 세션 리셋은 별개 기능으로 유지한다. Ctrl+D(빈 줄 EOF)는 구현하지 않았다.

참고: `/work/cp949/pyodide-samples/apps/repl/docs/design/03-selection-copy.md`,
이전 구현 설계 문서 `09-auto-indent.md`, `10-block-history.md`,
`/work/cp949/pyodide-samples/docs/repl/traps/`(TRP-001·004·006·008·016·017·030)

