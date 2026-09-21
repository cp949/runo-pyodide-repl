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
  두고 그것으로만 await한다. 헬퍼는 `[echo | None, exited, error | None]` 세 값을 돌려준다(JS에서 `None`은
  `undefined`). `SystemExit`은 따로 잡아 `[None, True, None]`(문자열 파싱 대신 `isinstance` 판별), 값이 `None`이면
  `[None, False, None]`이다. 그 밖의 값은 `repr(값)` **전체**가 `echo`다(절단 없음, `repr_shorten`은 쓰지 않는다).
  `builtins._`는 `repr`가 성공한 뒤에만 갱신한다. `repr`가 예외를 내면 `error`에 트레이스백을 담고
  (`__traceback__.tb_next`로 `await_fut` 프레임 한 칸을 뗀다) `_`는 건드리지 않는다. JS에는 `PyProxy` 값이 오지 않는다.
- **`runLine(source)`**(`worker/console.ts`의 `createConsole(pyodide, sinks, { topLevelAwait })`가 돌려주는
  `ReplConsole`, RD-004): `push`와 `await_fut`를 묶은 한 줄 실행이다. 결과 `RunLineResult`는
  `{ kind: 'incomplete' }`, `{ kind: 'syntax-error', formattedError }`, `{ kind: 'complete', echo, exited }`,
  `{ kind: 'error', formattedError }` 넷이다. `echo`는 값의 `repr()` 전체이고 값이 `None`이거나 `exited`이면 `null`이다.
  `formattedError`는 `fut.formatted_error`(내부 프레임이 잘린 것, `e.message`가 아니다)를 아래 정규화만 거친 값이라
  끝 개행을 포함하고(`repr` 예외는 `await_fut`가 만든 트레이스백), 제거는 호출부가 한다. `fut.destroy()`는 `finally`에서
  부른다. `await_fut`·`format_syntax_error`·`retrieve_exception` 소스는 `worker/console.ts`에 TS 템플릿 문자열로
  인라인돼 있고 별도 namespace에 정의한다(사용자 globals를 오염시키지 않는다). `createConsole`의 순서는 전역
  stdout/stderr Writer 등록 → `sys.ps1/ps2` → `PyodideConsole(pyodide.globals)` + 콜백 → TLA 비트 → 헬퍼 namespace다.
  취소·안전망·값 에코 표시(5.2)는 이 위에 `createSubmissionRunner`가 얹고, 여러 줄 분할은 RD-011이 더한다.
- **`pending()`/`clearPending()`**: `pending()`은 블록 입력 중이면 콘솔 `buffer`의 줄들을 `\n`으로 이은 텍스트, 아니면
  `undefined`다. `clearPending()`은 `buffer.clear()`로 미완성 블록을 버리며 블록이 없어도 안전하다. `buffer`는 접근할
  때마다 새 proxy라 둘 다 쓴 뒤 `destroy()`한다. 러너와 루프는 `pyconsole.buffer`를 직접 만지지 않고 이 둘을 쓴다.
- **문법 오류 정규화**: pyodide 314.0.7 콘솔은 EOF에서 끊긴 문법 오류(`1 +`, `foo bar`)와 본문 없는 중첩 블록을
  `_IncompleteInputError: incomplete input`으로 표시한다(3.14 REPL은 `SyntaxError: invalid syntax`, 중첩 블록은
  `IndentationError`). `runLine`이 `push` 직전에 `pending`을 읽어 두고(`push`가 끝나면 buffer는 비워진다), 결과가
  `syntax-error`이며 `formatted_error`의 마지막 줄이 `_IncompleteInputError: incomplete input`이면 Python 헬퍼
  `format_syntax_error(source, flags)`로 바꾼다. 헬퍼는 `compile(source + "\n", "<console>", "single", flags & ~0x4200, True)`를
  다시 시도해 `SyntaxError`의 `traceback.format_exception_only` 문자열을 돌려준다. `source`는 `pending`이 있으면
  `pending + "\n" + line`, 없으면 `line`이고 `flags`는 호출 시점의 `pyconsole._compile.compiler.flags`(TLA 비트 유지)다.
  `0x4200`은 codeop이 최종 컴파일에서 끄는 `ALLOW_INCOMPLETE_INPUT`(0x4000)와 `DONT_IMPLY_DEDENT`(0x200)다.
  **`source`에 끝 개행을 붙여야 한다**: 없으면 `offset=0`이 되어 캐럿 줄이 사라진다(3.14 pyrepl도 끝 개행이 있는 소스를
  쓴다). 재컴파일이 예외 없이 끝나거나 `SyntaxError`가 아닌 예외를 내면 pyodide 원문을 그대로 쓴다. 마지막 줄이 마커가
  아닌 오류(`x = = 1`은 `SyntaxError: invalid syntax`, `)`는 `SyntaxError: unmatched ')'`)도 원문 그대로다. 결과: `1 +`는
  `    1 +` 아래 `       ^`(7칸)와 `SyntaxError: invalid syntax`, `foo bar`와 블록 안 `1 +`도 3.14.4 pty와 캐럿 위치까지
  같고, 본문 없는 중첩 블록은 `IndentationError: expected an indented block after 'if' statement on line 2`다.
- **문법 오류 future 회수**: `syntax-error` future는 await하지 않으므로 `runLine`이 Python 헬퍼 `retrieve_exception(fut)`
  (`fut.exception()`)로 예외를 회수한다. 회수하지 않으면 사이클 GC 때 asyncio가 `ConsoleFuture exception was never
  retrieved`와 트레이스백(브라우저에서 24행을 넘었다)을 `sys.stderr`로 내 터미널에 끼어든다(브라우저 콘솔 로그가
  아니라 터미널 stderr로 온다). JS에서 `fut.exception()`을 부르면 예외 proxy를 `destroy()`해야 해서 Python에 둔다.

## 5.2 `createSubmissionRunner(pyodide, repl, io)` — `run(line: string | null)`
- 반환은 `{ prompt, exit, pending? }`. `PS1 = '>>> '`, `PS2 = '... '`. `pending`은 블록 입력 중일 때만
  있고 `repl.pending()` 그대로(콘솔 buffer의 줄들을 `\n`으로 이은 텍스트)다(main의 자동 들여쓰기·Tab 완성이 쓴다).
  `repl`은 `ReplConsole`의 `runLine`·`pending`·`clearPending`만 쓴다. 러너는 콘솔 buffer proxy를 직접 만지지 않는다.
- **`null`(취소) 분기를 맨 앞에서 한다**: `repl.clearPending()`(`buffer.clear()`) → `writeError('KeyboardInterrupt')`(개행 없음,
  빨강) → `{ prompt: '>>> ' }`. 순서가 중요하다 — `/[\r\n]/.test(null)`은 `"null"`을 검사하고
  `push(null)`은 콘솔 buffer를 `JsNull`로 오염시킨다. worker 루프는 분기 없이 `run(await readLine(...))`이다.
- **한 줄 제출**: 그대로 `repl.runLine(line)`. `incomplete`면 `{ prompt: '... ', pending }`, `syntax-error`·`error`면
  `formattedError`의 끝 개행 **하나만** 떼어 `writeError`(메시지 안의 개행은 CPython처럼 남긴다. sink가 `\r\n`을
  붙이므로 그대로 넘기면 프롬프트 앞에 빈 줄이 하나 더 생긴다, `05-output.md` 4.1), `complete`면 `echo`가 `null`이
  아닐 때 `writeOutput(echo)`(값 에코)이고 `exited`이면 `exit: true`다. 다음 프롬프트는 `incomplete` 외에는 `>>> `다.
- **여러 줄 제출(개행 포함, RD-011)**: RD-005의 러너에는 개행 분기가 없어 개행이 든 제출(붙여넣기·Shift+Enter·히스토리
  재호출)을 통째로 `push()`하고 대개 `SyntaxError`가 난다. RD-011이 아래 분기를 더한다.
  `split_paste(source)`로 문장별 chunk를 얻어 순서대로 `push()`한다
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
- **안전망**: `run()` 전체를 `try`로 감싸 사용자 코드 밖(`runLine` 안의 `push` 컴파일, `pending()`,
  `clearPending()`)에서 새는 `KeyboardInterrupt`를 취소와 같은 출력으로 처리한다. `cancel()` 안에서 끊기면
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
- `setTopLevelAwait(pyconsole, enabled)`(`worker/top-level-await.ts`)가 **TLA 비트만** 켜고 끈다. 다른 비트는 여러 줄 입력
  판정에 쓰이므로 건드리지 않는다. `_Compile.__call__`이 매 호출 flags를 읽으므로 다음 `push`부터 반영된다.
- **적용 시점**: worker가 시작할 때 초기화 프레임의 `topLevelAwait`를 **콘솔 생성 직후 한 번만** 적용한다
  (main에 되묻지 않는다, `01-protocols.md` 4절). 값을 바꾸려면
  worker를 새로 만든다(실행 중 콘솔의 플래그를 바꾸면 다음 `push`가 buffer 전체를 새 플래그로 재컴파일해
  `_IncompleteInputError`가 나고 buffer가 비워진다). `=== true`일 때만 ON으로 취급한다.
- ON은 컴파일 플래그만 켠다. `asyncio` 선주입·배너 변경 등 `python -m asyncio`의 나머지는 흉내내지 않는다.
  설정은 저장하지 않아 페이지를 다시 열면 OFF다.

## 5.5 `exit()`/`quit()` 감지
- `await_fut`가 `SystemExit`을 잡아 구분값으로 돌려주고 `run()`이 `{ exit: true }`로 전한다.
- worker 루프는 `result.exit`이면 `sessionTerminated` 알림으로 세션 종료를 main에 알리고(`onTerminated`) 루프를
  `break`한다. 이후 `readLine`을 더 요청하지 않아 실제 인터프리터 종료와 동등해진다. 터미널에는 아무것도 쓰지 않고
  (3.14도 종료 메시지가 없다) worker는 살려 둔다(복구는 세션 리셋). main은 `onStatus('terminated')`만 부르고, 종료 뒤
  활성 읽기가 없어 키는 버려진다(Ctrl+L만 동작). 감시 타이머를 끄고 `interruptIdle`을 destroy하는 정리는 그것을
  만드는 RD-009부터 이 분기에 들어간다.
- 여러 줄 제출 중 `exit()`가 나면 나머지 문장은 실행하지 않는다.

참고: `/work/cp949/pyodide-samples/apps/repl/docs/design/01-console-core.md`,
이전 구현 설계 문서 `07-multiline-submit.md`, `08-top-level-await.md`,
`/work/cp949/pyodide-samples/apps/repl/src/repl/{submission-runner,multiline,top-level-await}.ts`,
`/work/cp949/pyodide-samples/apps/repl/src/repl/multiline.py`

