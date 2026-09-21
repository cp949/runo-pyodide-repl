# 콘솔 코어: PyodideConsole·제출 실행·top-level await·종료

> 이 문서의 규칙·상수는 이전 구현(`/work/cp949/pyodide-samples/apps/repl`, 읽기 전용 참고)이 CPython 3.14.4 pty 실측과 브라우저 회귀로 확정한 것이다. 새 구현은 통신 계층만 바꾸고(`docs/design/00-architecture.md`, `01-protocols.md`) 이 규칙은 그대로 지킨다. 절 끝의 "참고:" 경로는 이전 구현의 근거 위치다.

worker 안에서 도는 REPL 코어의 규칙이다. main과의 통신은 `01-protocols.md`의 RPC(`readLine` 요청, 출력 알림)와 무관하게 이 규칙만으로 결정된다.

## 5.1 PyodideConsole 사용법
- 콘솔은 `pyodide.console.PyodideConsole`. `stdin_callback`은 넘기지 않고, `stdout_callback`/
  `stderr_callback`만 sink에 연결한다(`write`/`writeErrorRaw`).
- `push(line) -> ConsoleFuture`. `syntax_check`는 `'incomplete' | 'syntax-error' | 'complete'`,
  오류 문자열은 `formatted_error`. 미완성 블록의 줄은 `console.buffer`(접근할 때마다 새 proxy이므로
  쓴 뒤 `destroy()`), 비우기는 `buffer.clear()`.
- **`ConsoleFuture`를 JS에서 직접 `await`하면 안 된다**(TRP-003): 내부 프레임이 트레이스백에 남고 예외 뒤
  `formatted_error`를 읽으면 이미 파괴된 프록시다. Python 쪽 `await_fut(fut)` 헬퍼 하나를 별도 namespace에
  두고 그것으로만 await한다. 헬퍼는 `SystemExit`만 따로 잡아 `[None, True]`로 돌려준다(문자열 파싱 대신
  `isinstance` 판별). 값이 `None`이 아니면 `builtins._`를 갱신한다. 표시는 `repr_shorten`.

## 5.2 `createSubmissionRunner(pyodide, pyconsole, io)` — `run(line: string | null)`
- 반환은 `{ prompt, exit, pending? }`. `PS1 = '>>> '`, `PS2 = '... '`. `pending`은 블록 입력 중일 때만
  있고 콘솔 buffer의 줄들을 `\n`으로 이은 텍스트다(main의 자동 들여쓰기·Tab 완성이 쓴다).
- **`null`(취소) 분기를 맨 앞에서 한다**: `buffer.clear()` → `writeError('KeyboardInterrupt')`(개행 없음,
  빨강) → `{ prompt: '>>> ' }`. 순서가 중요하다 — `/[\r\n]/.test(null)`은 `"null"`을 검사하고
  `push(null)`은 콘솔 buffer를 `JsNull`로 오염시킨다. worker 루프는 분기 없이 `run(await readLine(...))`이다.
- **한 줄 제출**: 그대로 `push()`. `incomplete`면 `... `로, `syntax-error`면 `formatted_error`를
  `writeError`로.
- **여러 줄 제출(개행 포함)**: `split_paste(source)`로 문장별 chunk를 얻어 순서대로 `push()`한다
  (복합문이면 끝에 `""`를 한 번 더 push). 붙여넣기·Shift+Enter·히스토리 재호출은 구분하지 않는다.
- `split_paste`(Python): `ast.parse`로 top-level 문장 경계를 구한다. 블록 안 빈 줄은 빼고 여러 줄 문자열
  안의 줄은 보존한다. `\r\n`/`\r`은 `\n`으로 정규화하고, **비어 있지 않은 모든 줄이 공통 들여쓰기를 가질
  때만** dedent한다(`textwrap.dedent`는 공백 줄을 항상 바꿔서 쓰지 않는다). 통째 `push`는 `syntax-error`
  이고 줄 단위 재생은 클래스 메서드 사이 빈 줄에서 조용히 틀린다(27개 코퍼스 중 13개만 일치, 파싱 방식은 27/27).
- 실행 규칙: 파싱 단계 SyntaxError가 하나라도 있으면 **아무 문장도 실행하지 않고** 오류만 낸다.
  값 에코는 **마지막 문장만**. 런타임 예외(`KeyboardInterrupt` 포함)나 `exit()`가 나면 나머지 문장을
  중단한다. 공백·빈 줄·주석만 있는 제출은 무동작. 붙여넣은 뒤 Enter 1회로 실행한다(3.14는 한 번 더 요구).
- 블록 입력 중(`... `)에 붙여넣은 여러 줄은 분할하지 않고 한 줄씩 흘려 넣는다(이미 열린 블록과 어긋나
  `IndentationError`).
- **안전망**: `run()` 전체를 `try`로 감싸 사용자 코드 밖(`push` 컴파일, `cancel`, `hasPendingBlock`,
  `pendingSource`)에서 새는 `KeyboardInterrupt`를 취소와 같은 출력으로 처리한다. `cancel()` 안에서 끊기면
  예외가 `pyodide.ffi.ConversionError`로 감싸이므로 `err.type`과 메시지의 `/^KeyboardInterrupt\s*$/m`으로
  판별한다. 취소 처리가 다시 끊기면 `cancel()`을 한 번 더 시도하고 그래도 끊기면 출력만 낸다.
  `KeyboardInterrupt`가 아닌 오류는 그대로 던진다.

## 5.3 multiline 판정
- 여러 줄 블록 판정은 하드코딩된 키워드가 아니라 `ConsoleFuture.syntax_check === 'incomplete'`다
  (괄호 미닫힘 포함). 공백뿐인 줄에서 Enter를 누르면 블록이 끝난다(본문이 없으면 `incomplete`가 유지된다).

## 5.4 top-level await
- **기본 OFF**. 콘솔은 부모 `Console.__init__`이 `PyCF_ALLOW_TOP_LEVEL_AWAIT`를 항상 켜므로 기본이 ON이고
  생성자로 끌 수 없다(TRP-007). 생성 직후 `pyconsole._compile.compiler.flags == 0x6200`
  (0x2000 TLA | 0x4000 ALLOW_INCOMPLETE_INPUT | 0x200 DONT_IMPLY_DEDENT).
- `setTopLevelAwait(pyodide, pyconsole, enabled)`가 **TLA 비트만** 켜고 끈다. 다른 비트는 여러 줄 입력
  판정에 쓰이므로 건드리지 않는다. `_Compile.__call__`이 매 호출 flags를 읽으므로 다음 `push`부터 반영된다.
- **적용 시점**: worker가 시작할 때 main에 설정을 묻고 **콘솔 생성 직후 한 번만** 적용한다. 값을 바꾸려면
  worker를 새로 만든다(실행 중 콘솔의 플래그를 바꾸면 다음 `push`가 buffer 전체를 새 플래그로 재컴파일해
  `_IncompleteInputError`가 나고 buffer가 비워진다). `=== true`일 때만 ON으로 취급한다.
- ON은 컴파일 플래그만 켠다. `asyncio` 선주입·배너 변경 등 `python -m asyncio`의 나머지는 흉내내지 않는다.
  설정은 저장하지 않아 페이지를 다시 열면 OFF다.

## 5.5 `exit()`/`quit()` 감지
- `await_fut`가 `SystemExit`을 잡아 구분값으로 돌려주고 `run()`이 `{ exit: true }`로 전한다.
- worker 루프는 `result.exit`이면 세션 종료를 main에 알리고(`onSessionTerminated`) 루프를 `break`한다.
  이후 `readLine`을 더 요청하지 않아 실제 인터프리터 종료와 동등해진다. 감시 타이머를 끄고
  `interruptIdle`을 destroy한다.
- 여러 줄 제출 중 `exit()`가 나면 나머지 문장은 실행하지 않는다.

참고: `/work/cp949/pyodide-samples/apps/repl/docs/design/01-console-core.md`,
이전 구현 설계 문서 `07-multiline-submit.md`, `08-top-level-await.md`,
`/work/cp949/pyodide-samples/apps/repl/src/repl/{submission-runner,multiline,top-level-await}.ts`,
`/work/cp949/pyodide-samples/apps/repl/src/repl/multiline.py`

