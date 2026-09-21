# EOF에서 끊긴 문법 오류가 `_IncompleteInputError`로 표시되는 편차

Status: open
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
