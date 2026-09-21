# EOF에서 끊긴 문법 오류가 `_IncompleteInputError`로 표시되는 편차

Status: done
Origin: RD-004(`worker/console.test.ts`의 문법 오류 시험 입력을 고르다 발견). `docs/design/10-parity-deviations.md` 13의 확장.

## 현상

pyodide 314.0.7 콘솔은 컴파일 플래그 `PyCF_ALLOW_INCOMPLETE_INPUT`(0x4000)를 켠 채 컴파일한다. 이때 EOF에서 끊긴 것으로 보이는 문법 오류가 `SyntaxError: invalid syntax`가 아니라 `_IncompleteInputError: incomplete input`으로 `formatted_error`에 담긴다. `syntax_check`는 `"syntax-error"`다.

| 입력      | pyodide `formatted_error` 마지막 줄       | 표준 `codeop.CommandCompiler`(CPython 3.14.4) |
| --------- | ----------------------------------------- | --------------------------------------------- |
| `1 +`     | `_IncompleteInputError: incomplete input` | `SyntaxError: invalid syntax`                 |
| `foo bar` | `_IncompleteInputError: incomplete input` | `SyntaxError: invalid syntax`                 |
| `$`       | `_IncompleteInputError: incomplete input` | `SyntaxError: invalid syntax`                 |
| `def f(:` | `_IncompleteInputError: incomplete input` | `SyntaxError: invalid syntax`                 |
| `x = = 1` | `SyntaxError: invalid syntax`             | `SyntaxError: invalid syntax`                 |
| `)`       | `SyntaxError: unmatched ')'`              | 같음                                          |

CPython 3.14.4에서 `compile(src, "<console>", "single", flags=0x4000 | 0x200)`도 같은 표의 앞 네 입력에 `_IncompleteInputError`를 낸다. 플래그의 CPython 동작이지 pyodide만의 문제가 아니다. 3.14 `_pyrepl`은 표준 경로로 `SyntaxError: invalid syntax`를 낸다(로컬 3.14.4 `codeop`로만 확인, pty 화면 비교는 안 함).

## 후보

- RD-005의 `writeError` 표시 단계에서 `_IncompleteInputError: incomplete input`을 `SyntaxError: invalid syntax`로 다시 쓴다(끝 줄 치환). 어떤 입력이 어느 메시지가 되는지는 3.14.4 pty로 확인해야 한다.
- 또는 편차로 등록하고 유지한다(`10-parity-deviations.md`에 항목 추가, 건수 갱신).

## 완료 기준(관찰 가능)

- `1 +`·`foo bar` 제출의 화면 마지막 줄이 3.14.4 pty와 같거나, 다르면 편차로 등록돼 있다.
- 본문 없는 중첩 블록(편차 13)과 같은 원인인지 대조해 한 항목으로 묶을지 정한다.

## 등록 시점

RD-005 착수 시 syntax-error 표시를 처음 구현하는 자리에서 함께 정한다. RD-004는 `runLine`이 `formatted_error`를 그대로 돌려주므로 영향이 없다.

## Comments

- 해결(RD-005): 끝 줄 치환이 아니라 재컴파일로 정규화한다. `runLine`이 push 직전에 pending을 읽어 두고, 결과가 `syntax-error`이며 `formatted_error`의 마지막 줄이 `_IncompleteInputError: incomplete input`이면 Python 헬퍼 `format_syntax_error(source, flags)`가 `compile(source + "\n", "<console>", "single", flags & ~0x4200, True)`를 다시 시도해 `traceback.format_exception_only` 문자열로 바꾼다(`source`는 pending이 있으면 `pending + "\n" + line`). 재컴파일이 예외 없이 끝나거나 `SyntaxError`가 아닌 예외를 내면 pyodide 원문을 쓴다. `flags`는 호출 시점의 `pyconsole._compile.compiler.flags`라 top-level await 비트를 유지한다. 끝 개행이 없으면 `1 +`의 캐럿 줄이 사라져(`offset=0`) `+ "\n"`이 필수다.
- 결과: `1 +`·`foo bar`·블록 안 `1 +`가 3.14.4 pty와 문구와 캐럿까지 일치한다. 브라우저에서 `1 +` Enter는 `  File "<console>", line 1` / `    1 +` / `       ^` / `SyntaxError: invalid syntax`(빨강)를 낸다. `x = = 1`·`)`는 원문 그대로다. 본문 없는 중첩 블록은 `IndentationError: expected an indented block after 'if' statement on line 2`로 3.14와 문구가 같다.
- 편차 13은 "본문 없는 중첩 블록의 문구는 3.14와 같고 즉시 표시(편차 11)만 남는다"로 갱신했다. 별도 편차를 새로 등록하지 않았다.
- 시험: `packages/pyodide-repl/src/worker/console.test.ts`의 "문법 오류 정규화 — `_IncompleteInputError`를 3.14 표준 문구로"(`test.each` 4건, 본문 없는 중첩 블록, `)` 원문, top-level await 켜짐, 정규화 뒤 새 블록 시작). 브라우저: RD-005 `repl-check normal` ④, `trailing-newline-check` S06.
