# Tab 완성

> 이 문서의 규칙·상수는 이전 구현(`/work/cp949/pyodide-samples/apps/repl`, 읽기 전용 참고)이 CPython 3.14.4 pty 실측과 브라우저 회귀로 확정한 것이다. 새 구현은 통신 계층만 바꾸고(`docs/design/00-architecture.md`, `01-protocols.md`) 이 규칙은 그대로 지킨다. 절 끝의 "참고:" 경로는 이전 구현의 근거 위치다.

`complete(source, pending)` 요청은 main→worker RPC 요청이다(`01-protocols.md` 1절). worker가 프롬프트 대기 중(`readLine` 요청을 보내고 응답을 기다리는 동안)에만 답하고, `input()` 메일박스 대기 중에는 worker가 멈춰 있어 답하지 못한다(그 구간의 Tab은 main이 무동작 처리).

## 7.1 요청 프로토콜
- 요청: `complete(source, pending)` → 응답 `{ completions: string[], start: number }`.
  `source`는 커서 앞 텍스트(`buf.slice(0, pos)`), `pending`은 `... ` 블록의 이전 줄들(`\n`으로 이음).
- worker 핸들러는 **프롬프트를 기다리는 동안(`atPrompt`)에만** 실제로 계산하고, 실행 중에 늦게 도착한
  요청은 `{ completions: [], start: 0 }`로 돌려 사용자 코드와 겹쳐 돌지 않게 한다.
- main(`createTabReader`)이 `readKey` 래퍼로 Tab(`UNSUPPORTED_CONTROL_CHAR = 21`, `data: ['\t']`)을
  가로챈다. 응답은 **읽기가 살아 있고 버퍼·커서가 요청 때와 같을 때만** 적용한다. 읽기가 그 사이 끝났으면
  (Enter, Ctrl+C) 완성을 버린다. 요청이 reject되면 무동작이고 입력은 그대로다.
- 왕복 중 들어온 Tab은 **버리지 않고 큐에 두었다가** 끝난 뒤 그 읽기에 이어 처리한다(`requesting`,
  `queuedTabs`). 목록 재그리기 중 들어온 키도 큐에 두고 순서대로 처리한다(`redrawing`, `queuedKeys`,
  TRP-008).
- `input()` 읽기, 실행 중, 읽기 시작 전의 Tab은 무동작이고 `\t`도 넣지 않는다.
- 완성 요청 중 읽기가 Ctrl+C로 취소되면 `interruptCompletion`(= `interruptSender.send()`)이 worker의 후보
  계산(무한 루프인 `__getattr__` 등)을 끊는다. 사용자 프레임이 `<console>`이라 핸들러가 `KeyboardInterrupt`를
  올리고, `complete_source`의 `except Exception`은 `BaseException`을 잡지 않아 요청이 reject된다.
  요청이 없을 때·이미 끝난 뒤·Enter로 끝난 읽기에는 보내지 않는다.

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
- 그리는 순서: `moveCursorToEnd` → `\r\n` + 행들 + `\r\n` → 입력줄 재그리기. 재그리기는 `autoIndent.read`가
  아니라 `readline.read`를 직접 쓰고 프롬프트는 브리지가 합성한 것(꼬리 포함)을 그대로 쓴다(TRP-004).
  새 읽기의 입력 상태는 write 콜백에서 만들어지므로 그 콜백 안에서 `updateLine(buf)` → 커서 복원
  (코드포인트 수, **0이면 생략**, TRP-030) → `editing` 복원을 한다. 사이에 다른 키가 끼면 첫 Tab 규칙으로 돌아간다.

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

참고: `/work/cp949/pyodide-samples/apps/repl/docs/design/06-tab-completion.md`,
`/work/cp949/pyodide-samples/apps/repl/src/repl/{tab-completion,tab-reader,complete-source}.ts`,
`/work/cp949/pyodide-samples/apps/repl/src/repl/complete-source.py`

