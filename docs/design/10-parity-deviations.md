# CPython 3.14 기본 REPL 대비 편차와 범위 밖

동등성 기준은 CPython 3.14.4를 pty(24×80, `TERM=xterm`)로 띄운 실측이다. 아래는 이전 구현이 확정한 편차·범위 밖 목록이고, 새 구현도 같은 정책을 따른다(변경하려면 ROADMAP 항목으로 등록). 새 항목 등록 규칙은 `ROADMAP.md` 상단에 있다.

## 1. 문서화된 편차

비동기 채널·구조 선택에서 온 것:

1. **프롬프트 대기 중 asyncio 콜백이 돈다**(RD-021). 3.14 기본 REPL은 돌 루프가 없고 `python -m asyncio`는 돈다 → `python -m asyncio` 쪽으로 정렬한 의도적 선택.
2. **배경 콜백이 CPU를 잡으면 프롬프트에서 Ctrl+C가 2회 필요**하다. 첫 번째는 읽기 취소, 두 번째가 SIGINT.
3. **배경 콜백의 `input()`은 REPL 줄을 Enter한 뒤에야 시작**한다(REPL 읽기 활성 중 stdin 읽기를 미루는 가드).
4. 배경 콜백의 출력은 프롬프트 행(`>>> `) 뒤에 이어 붙어 나온다(입력 중이던 줄과의 표시 어긋남은 범위 밖).

버퍼링:

5. **stdout 버퍼링 미모사**: flush 없는 `print("t", end="")` 뒤 `input()`을 읽으면 웹은 `t`를 즉시 내고 3.14는 입력이 끝난 뒤에 낸다. (`input("x: ")`는 3.14처럼 `x: abc` 한 줄.)
6. **stderr line buffering 미모사**: 개행 없는 `sys.stderr.write("raw-err")`를 웹은 즉시 내 `raw-err7`이 되고, 3.14는 다음 flush에 낸다.

history·입력:

7. **붙여넣기·Shift+Enter·재호출한 블록의 실행이 Enter 1회**(3.14는 한 번 더).
8. **블록 안에서 history에 닿을 수 없다**(3.14는 ↑ 두 번). Ctrl+C로 취소한 뒤 ↑를 쓴다.
9. **history가 중복을 제거한다**(3.14는 안 한다). 다중 줄 항목에서 편집 전 ↑는 바로 이전 항목으로 넘어간다(3.14는 줄 단위 이동).
10. **붙여넣은/Shift+Enter로 만든/재호출한 블록의 둘째 줄부터 `... ` 접두사가 없다**.
11. **문법 오류가 즉시 표시된다**(3.14는 다중 줄 입력에서 빈 줄 뒤).
12. **Backspace dedent 단위 차이**: 웹은 단위 배수까지, 3.14는 이전 줄들의 더 얕은 수준까지. 2칸·4칸 혼용 블록에서 다르다. 탭 들여쓰기는 1글자씩.
13. **본문 없는 중첩 블록**(`if True:` / `    if True:` / `    pass`)의 문구는 3.14와 같은 `IndentationError`이고 즉시 표시(편차 11)만 남는다. pyodide 콘솔이 내는 `_IncompleteInputError: incomplete input`은 재컴파일로 표준 문구로 바꾼다(`02-console-core.md` 5.1). `1 +`·`foo bar`·블록 안 `1 +`는 3.14.4 pty와 캐럿 위치까지 같다.
14. **프리필이 있는 동안 ↑가 history를 탐색하지 않는다**. `... ` 입력줄의 ↑는 무동작(3.14는 이전 줄로 커서 이동).
15. `input()` 대기 중 붙여넣은 여러 줄은 첫 줄만 값으로 쓰인다. 탭은 8칸 폭으로 표시된다.

Tab 완성:

16. **`[ not unique ]`·`[ complete but not unique ]` 계열 메시지가 없다.** 목록이 스크롤백에 남고 입력줄이 목록 위아래로 중복된다. 메뉴 필터·쪽 넘김·선택 UI 없음.
17. **`input()` 안 Tab 무동작**(3.14는 완성한다).
18. **환경 모듈 집합 차이**: 빈 cwd 기준 3.14 pty `import ` 후보 192개(3.14.4), pyodide 178개(314.0.7). 네이티브에만 있는 밑줄 없는 15개(`curses`, `dbm`, `ensurepip`, `grp`, `idlelib`, `pip`, `pwd`, `pydoc_data`, `readline`, `resource`, `syslog`, `tkinter`, `turtle`, `turtledemo`, `venv`)와 밑줄 17개가 없고, pyodide에만 있는 8개 중 `pyodide`와 `_test*`는 후보에 남는다(`INTERNAL_PREFIXES`가 `_pyodide*`만 거른다).
19. **번들 pyodide는 Python 3.14.2, 기준 pty는 3.14.4**. 95케이스 대조에서 zip 보정 뒤 파서 결과 차이는 없었으나 소스 차이 자체를 배제하지는 않았다.
20. **미로드 배포 패키지는 후보에 없다**(numpy 등).
21. **열 정렬은 문자열 길이 근사**(전각 문자 2칸 미반영).
22. **새 세션에서 `sys`가 REPL 전역에 있어 `s` 후보에 섞인다.**
23. (동등) 3.14의 삽입 quirk는 그대로 따른다: `import os.pa  # c` Tab → `import os.pa  # cs.path`.

Ctrl+C·sleep:

24. **사용자 코드가 스스로 일으킨 SIGINT 무시**: `signal.raise_signal(SIGINT)`·`_thread.interrupt_main()`. 사용자가 자기 SIGINT 핸들러를 걸면 연타 보호가 사라진다.
25. **동기 XHR 대기 중 Ctrl+C 미반영**(3.1 참고).
26. **sleep 중 이벤트 루프 정지의 부작용**: `Future`·`js.setTimeout` 콜백·`pyodide.http` 요청도 진행하지 않아 `while not task.done(): time.sleep(0.01)` 같은 루프는 CPython처럼 끝나지 않는다.
27. **`time.sleep` 대기 중 워커 스레드 한 코어 100% 점유**(JSPI 환경).
28. **코루틴 프레임 안의 동기 `time.sleep`을 중단하면 트레이스백이 두 번 나오고 첫째에 우리 내부 파일명이 보인다**(해소, RD-009a). 증상(RD-009 실측 40/40): `async def main(): time.sleep(...)`처럼 코루틴 안에서 동기 `time.sleep`(조각 래퍼)을 직접 부르고 그 코루틴을 `asyncio.run(main())`·`run_sync(main())`으로 돌리면 트레이스백이 두 번 찍히고 첫째에 `<sigint-handler>`·`<sleep-slice>` 프레임이 남았다. 기전: pyodide C `wrap_exception_inner()`의 `PyErr_Print()`가 `sys.excepthook`(`traceback.print_exception`)을 부르는데, 콘솔 실행 중에는 `sys.stderr`가 `_WriteStream` 콜백이라 pyodide `capture_stderr()`(fd 2만 리다이렉트)를 우회해 화면으로 샌다 — `run_sync` 계열로 들어간 awaitable이 **어떤 예외로든** 끝나면 발생했다(KeyboardInterrupt 한정이 아니라 ValueError·SystemExit도 같았다). 같은 코루틴이 `await`로만 기다리면(`arun-loop`) 우리 프레임이 없었다(콜백 경계를 넘지 않으므로). 해소: `guard`가 `BaseException`을 홀더 `Raised(exc)`로 담아 정상 값으로 Task를 끝내 예외가 JS 경계를 넘지 않게 했고(excepthook은 건드리지 않음), `run_sync` 래퍼가 `raise result.exc`로 사용자 스택에서 그 객체를 올린다. 나르기 전 우리 프레임만 다듬고 `formattraceback` 절단 규칙을 바꿔 코루틴 안 사용자 프레임(`main` 등)은 남긴다. 브라우저 실측(DELTA-03) `arun-sleep`·`runsync-sleep` 40/40, `pageErrors` 0. 남는 것: 설치 가드에 걸려 래퍼가 없으면 pyodide 원본 동작(중복 인쇄)으로 돌아간다. 사용자가 직접 `traceback.print_exc()`를 부르면 `run_sync` 래퍼·`webloop.py` 프레임이 남는다(실제 호출 경로라 다듬지 않는다).
29. **`<console>` 프레임 없는 콜백 안의 `time.sleep`**(예: `exec("async def …")`로 정의한 코루틴을 `asyncio.run`으로 실행)은 Ctrl+C가 sleep이 끝난 뒤에야 반영된다.
30. **`warnings` 출력의 파일명**이 `<console>`이다(3.14는 `<python-input-N>`) — 범위 밖.
31. **확인 범위**: 위 측정은 모두 Chromium(대개 headless, 개발 서버) 한 대 기준이다. Firefox·Safari·`sync=false` 폴백은 미확인.

읽기 없는 구간:

32. **읽기가 활성이 아닌 동안 친 키는 버려진다**(3.14는 tty가 버퍼링했다가 다음 프롬프트에 보여준다). 벤더 `Readline`은 활성 읽기가 없으면 Ctrl+C·Ctrl+L 외 단일 키를 버리고, Enter로 읽기가 끝난 뒤 다음 읽기의 입력 상태가 만들어지기까지(`term.write("", cb)`의 flush 대기)도 같다. Enter 뒤 `z`를 치기까지의 지연별 측정(N=10, `z`가 다음 프롬프트에 들어온 횟수). worker 없는 읽기 루프(Chromium 148 headless, preview 빌드, RD-003 데모): 0ms 0/10, 5ms 2/10, 10ms 2/10, 20ms 이상 10/10. worker 왕복(`readLine` 요청 → `run("")` → 다음 `readLine` 요청)이 더해진 REPL 루프(Chromium 148 headless, Playwright 1.60.0, 빈 줄 Enter): dev 0ms 1/10, 5ms 5/10, 10ms 1/10, 20·50·100·200ms 10/10, preview 0ms 1/10, 5ms 2/10, 10ms 1/10, 20·50·100·200ms 10/10. 창은 여전히 약 20ms 안쪽이라 worker 왕복이 창을 늘리지 않았고, 5·10ms 사이 요동은 N=10 잡음이다. 실행 중에는 활성 읽기가 없으므로 실행 시간만큼 창이 길어진다(`time.sleep(2)` 중 입력, 미측정). 창 안의 붙여넣기는 낡은 `State`에 그려질 수 있으나 화면 결과는 미확인. 브라우저 하니스는 새 프롬프트가 보인 뒤에 입력한다(`docs/traps/TRP-005`). 이 창의 Ctrl+C도 같다: main 게이트(`pythonRunning`의 `!readLinePending`)가 `readLine` 요청 도착부터 응답까지 닫혀 있어 에코도 전송도 하지 않는다(RD-007, `03-ctrl-c.md` 2.7). 입력 버퍼링은 후속 후보로 `.scratch/type-ahead/`에 있다.

값 에코:

33. **값 에코가 `sys.displayhook`을 거치지 않는다.** worker가 값의 `repr()` 전체를 만들어 `writeOutput`으로 낸다(`builtins._`는 `repr` 성공 뒤 갱신, 절단 없음). 사용자가 `sys.displayhook`을 바꿔도 반영되지 않는다. `repr()`가 예외를 내면 트레이스백은 `__repr__` 프레임부터 나오고 3.14의 첫 프레임(`File "<console>", line 1, in <module>`)이 없다(값이 이미 반환된 뒤 `repr`를 부르기 때문이다).

stdin 읽기의 끝:

34. **`sys.stdin.read()`·`readlines()`·`for line in sys.stdin`은 EOF(Ctrl+D)가 없어 줄마다 다시 읽고 끝나지 않는다**(RD-006). 벤더 `Readline`의 Ctrl+D는 글자 삭제이고 메일박스에 EOF 표식이 없다. 끊는 방법은 Ctrl+C뿐이고 그 경로는 RD-008이 넣었다(취소가 `input()` 호출 지점의 `KeyboardInterrupt`가 되어 `read()`·`readlines()`·`for line in sys.stdin` 모두 끊긴다). `input()`·`readline()`은 3.14와 같다(pyodide 314.0.7 `LegacyReader`가 콜백이 돌려준 문자열 끝에 `\n`을 붙이고 마지막 바이트가 `\n`이면 EOF를 넣지 않는다). `read(n)`·`readlines(hint)`처럼 상한이 있는 읽기는 한 줄 뒤 돌아온다(`read(n)`이 남긴 `\n`이 다음 읽기를 콜백 없이 채우는 것은 CPython 표준 동작이다, `docs/traps/TRP-010`). Ctrl+D EOF 표식은 프로토콜 확장이라 ROADMAP 항목으로 등록해야 한다.

`input()` 취소:

35. **`input()` 취소의 트레이스백이 입력 줄 아래에서 시작하고 `_pyrepl` 프레임·소스 줄이 없다.** 3.14.4 pty 실측(RD-008 재측정 ⑤): Ctrl+C 응답이 개행 없이 `Traceback (most recent call last):\r\n`부터 시작해 화면에서는 `x: abcTraceback (most recent call last):`처럼 입력 줄에 붙고, 프레임은 `File "<python-input-0>", line 1, in <module>` + 소스 줄 + `_pyrepl/readline.py`(`input`) → `reader.py`(`readline`) → `reader.py`(`handle1`) → `unix_console.py`(`wait`) 4개다. 우리는 `\r\n` 뒤 다음 줄에서 시작하고 `Traceback (most recent call last):` / `  File "<console>", line 1, in <module>` / `KeyboardInterrupt` 3줄뿐이다(소스 줄·`_pyrepl` 프레임 없음). 함수 안 취소는 그 프레임(`File "<string>", line 2, in f`)이 더해진다. 프레임 흉내는 범위 밖이고, 개행은 sink의 println 계약(끝 개행을 sink가 붙인다)과 얽혀 있다.
36. **`input()` 취소 직후 연타의 두 번째 눌림부터 `^C`가 에코되어 트레이스백 앞에 붙는다.** 취소에는 게이트 항 `cancelSettling`을 세우지 않으므로(`04-stdin-input.md` 3.1) 두 번째 눌림은 `setCtrlCHandler` 경로로 가 `^C`를 꼬리에 남긴다(`^CTraceback (most recent call last):` 형태). RD-008 브라우저 실측(N=20, 중앙값·범위): 0ms 2회 → 1 (1~1), 0ms 5회 → 4 (2~4), 키 반복 20회 → 19 (5~19), 긴 프롬프트 + 5회 → 4 (3~4), 짧은 프롬프트 + 5회 → 4 (1~4). 트레이스백은 모든 셀·모든 시행에서 정확히 1개였다. 3.14도 cooked mode에서 실행 중 `^C`를 에코하므로 "Python이 도는 중" 표시로는 옳다. 방어를 걸면 `except KeyboardInterrupt` 뒤 계산 중 Ctrl+C가 무시되므로(이전 구현 3.0초) 걸지 않는 쪽을 골랐다.
37. **`... ` 프롬프트 취소 연타는 여러 눌림이 `KeyboardInterrupt` 한 줄로 합쳐진다.** `cancelSettling`이 취소 응답 뒤 구간을 덮어 `^C`도 찍히지 않는다. RD-008 실측(N=20): 0ms 2회·5회·키 반복 20회 모두 `^C` 0, `KeyboardInterrupt` 줄 수 중앙값 1(5회·키 반복에서 드물게 2 — 두 번째 취소가 새 읽기가 열린 뒤에 떨어진 경우). 이전 구현은 1~5ms 간격에서 평균 2·9.65줄이었으므로 합쳐짐이 더 강하다. 3.14는 눌림마다 한 줄을 내므로 줄 수 차이가 남는다.

정지한 실행 중 Ctrl+C:

38. **Task 밖 콜백(`call_later` 등)에서 난 `KeyboardInterrupt`·`SystemExit`은 조용히 버려진다**(RD-009). webloop 재보고 억제(`03-ctrl-c.md` 2.8)가 WebLoop의 `_keyboard_interrupt_handler`·`_system_exit_handler`를 no-op으로 바꾸기 때문이다. 3.14에서는 배경 콜백의 `KeyboardInterrupt`가 프로세스로 올라가 보이지만, 웹에서는 콜백 경계에서 사라진다(콘솔 실행 안에서 난 것은 그대로 화면에 나온다). 이 억제는 정상 중단·`input()` 취소·`exit()`마다 남던 브라우저 `pageerror`(시행당 2·2·1건)를 0으로 만드는 대가이고, 그 재보고에는 화면에 이미 나간 것 말고 새 정보가 없다.
39. **콘솔 실행 중 JS→Python 콜백이 낸 예외는 트레이스백이 두 번 찍힌다**. `js.Array.of(1).map(lambda *a: 1/0)`처럼 JS가 부른 Python 콜백의 예외를 pyodide가 JS Error로 바꾸며 `PyErr_Print()`로 한 번 찍고(28번과 같은 기전), 콘솔이 다시 찍는다. 우리 프레임은 없다. `run_sync` 래퍼 밖이라 RD-009a가 다루지 않고, `sys.excepthook`을 콘솔 실행 전체에 바꾸는 안은 사용자가 바꾼 훅과 충돌해 쓰지 않는다. 3.14에는 대응 경로가 없다.

세션 리셋:

40. **실행 중 Ctrl+L 뒤 꼬리는 다음 프롬프트에 합성된다**(pty는 리셋 대응이 없어 기준 없음). Ctrl+L(화면 지우기)은
    벤더 `Readline` 동작 그대로이고 코어는 손대지 않는다(RD-010 확정 15) — 세션 리셋(Python 상태 초기화)과는
    별개 기능이다(`08-session.md` 8.1).

여러 줄 제출:

41. **분할 재생의 런타임 트레이스백 줄 번호는 청크 기준**(3.14는 붙여넣은 전체 기준). `split_paste`가
    top-level 문장 단위 청크마다 `push`하므로 `File "<console>", line N`의 N은 그 청크 안 상대 번호다
    (RD-011). 파싱·컴파일 단계 오류의 줄 번호는 전체 기준이다(`split_paste`가 청크로 나누기 전에 전체
    소스를 검사한다, `02-console-core.md` 5.2).

top-level await 대기 중 Ctrl+C가 트레이스백 없이 `KeyboardInterrupt` 한 줄로 끝나고 `except KeyboardInterrupt`로는 잡히지 않는 것(우리 구현은 콘솔 task를 취소하고 표지 예외 `IdleInterrupt`를 한 줄로 표시한다. `except asyncio.CancelledError`는 잡고 `finally`는 돈다)은 **편차로 등록하지 않는다**. 대기 중 Ctrl+C를 task 취소로 처리하고 한 줄만 내는 것은 3.14의 `python -m asyncio`와 같은 동작이고, 우리 TLA 옵션의 기준이 기본 REPL이 아니라 `python -m asyncio`이기 때문이다(편차 1과 같은 정렬). 2절 "범위 밖"에도 넣지 않는다 — 재현하지 않기로 한 차이가 아니라 차이가 아니다.

참고: `/work/cp949/pyodide-samples/apps/repl/docs/design/02-ctrl-c.md`, `05-output-streaming.md`, `06-tab-completion.md`, `07-multiline-submit.md`, `09-auto-indent.md`, `10-block-history.md`, `/work/cp949/pyodide-samples/apps/repl/README.md`("알려진 제약"), RD-008 pty 재측정 `_works/_completed/20260922-08-rd-008-prompt-and-input-cancel/verify/pty/results.md`


## 2. 범위 밖 확정 (2026-09-21)

3.14 pty와의 차이 중 웹에서 원리적으로 재현하기 어렵거나 사용자 시나리오에 닿지 않는 것.

- **stdout 버퍼링 모사**: flush 없는 `print(end="")`를 입력 뒤에 내는 3.14 동작. 웹은 즉시 출력(RD-015 정책).
- **`sys.stdin.readline()`의 `^C` 에코**. 3.14.4 pty 실측(RD-008 재측정 ⑦): `abc` 입력 뒤 Ctrl+C가 `^CTraceback (most recent call last):\r\n  File "<python-input-5>", line 1, in <module>\r\n    y = sys.stdin.readline()\r\nKeyboardInterrupt\r\n`이다(tty 드라이버의 cooked mode 에코, `_pyrepl` 프레임 없음). 우리는 `^C` 없이 같은 3줄 트레이스백을 낸다.
- **꼬리 뒤 블록의 `... `가 꼬리 폭만큼 밀리는 3.14 quirk**.
- **RD-012g 동기 XHR 대기 중 Ctrl+C**: `pyodide.http.open_url`·`pyxhr.get`은 `req.open(…, False)`인 동기 XHR이라 워커 스레드를 통째로 막아 폴링 지점도 감시 타이머도 없다. 3초 지연 서버 N=5 실측에서 `pyxhr.get`은 응답 뒤 `KeyboardInterrupt`, `open_url`은 눌림 무시. 동기 API 의미를 바꾸지 않는 설계가 필요한데 시나리오가 드물다.
- **RD-016e 미로드 pyodide 배포 패키지의 import 후보**: 3.14 동등 범위 밖의 pyodide 확장. lockfile 패키지명을 후보에 넣으면 후보 집합이 로드 상태에 의존하고 `from numpy import <Tab>`은 로드 전 속성을 볼 수 없어 일관성이 깨진다.

