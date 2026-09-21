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

7. **재호출한 블록의 재실행이 Enter 1회**(3.14는 2회).
8. **블록 안에서 history에 닿을 수 없다**(3.14는 ↑ 두 번). Ctrl+C로 취소한 뒤 ↑를 쓴다.
9. **history가 중복을 제거한다**(3.14는 안 한다). 다중 줄 항목에서 편집 전 ↑는 바로 이전 항목으로 넘어간다(3.14는 줄 단위 이동).
10. **붙여넣은/Shift+Enter로 만든/재호출한 블록의 둘째 줄부터 `... ` 접두사가 없다**.
11. **문법 오류가 즉시 표시된다**(3.14는 다중 줄 입력에서 빈 줄 뒤).
12. **Backspace dedent 단위 차이**: 웹은 단위 배수까지, 3.14는 이전 줄들의 더 얕은 수준까지. 2칸·4칸 혼용 블록에서 다르다. 탭 들여쓰기는 1글자씩.
13. **본문 없는 중첩 블록**(`if True:` / `    if True:` / `    pass`)에서 `_IncompleteInputError: incomplete input`(3.14는 `IndentationError`).
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
28. **`asyncio.run` 코루틴 안 `KeyboardInterrupt`의 트레이스백 중복**(RD-012i).
29. **`<console>` 프레임 없는 콜백 안의 `time.sleep`**(예: `exec("async def …")`로 정의한 코루틴을 `asyncio.run`으로 실행)은 Ctrl+C가 sleep이 끝난 뒤에야 반영된다.
30. **`warnings` 출력의 파일명**이 `<console>`이다(3.14는 `<python-input-N>`) — 범위 밖.
31. **확인 범위**: 위 측정은 모두 Chromium(대개 headless, 개발 서버) 한 대 기준이다. Firefox·Safari·`sync=false` 폴백은 미확인.

읽기 없는 구간:

32. **읽기가 활성이 아닌 동안 친 키는 버려진다**(3.14는 tty가 버퍼링했다가 다음 프롬프트에 보여준다). 벤더 `Readline`은 활성 읽기가 없으면 Ctrl+C·Ctrl+L 외 단일 키를 버리고, Enter로 읽기가 끝난 뒤 다음 읽기의 입력 상태가 만들어지기까지(`term.write("", cb)`의 flush 대기)도 같다. Enter 뒤 `z`를 치기까지의 지연별 측정(Chromium 148 headless, preview 빌드, RD-003 데모의 worker 없는 읽기 루프, N=10): 0ms 0/10, 5ms 2/10, 10ms 2/10, 20ms 이상 10/10 들어옴. worker 왕복(RD-005)과 실행 시간이 더해지면 창이 길어진다. 창 안의 붙여넣기는 낡은 `State`에 그려질 수 있으나 화면 결과는 미확인. 브라우저 하니스는 새 프롬프트가 보인 뒤에 입력한다(`docs/traps/TRP-005`). 입력 버퍼링은 후속 후보로 `.scratch/type-ahead/`에 있다.

참고: `/work/cp949/pyodide-samples/apps/repl/docs/design/02-ctrl-c.md`, `05-output-streaming.md`, `06-tab-completion.md`, `07-multiline-submit.md`, `09-auto-indent.md`, `10-block-history.md`, `/work/cp949/pyodide-samples/apps/repl/README.md`("알려진 제약")


## 2. 범위 밖 확정 (2026-09-21)

3.14 pty와의 차이 중 웹에서 원리적으로 재현하기 어렵거나 사용자 시나리오에 닿지 않는 것.

- **stdout 버퍼링 모사**: flush 없는 `print(end="")`를 입력 뒤에 내는 3.14 동작. 웹은 즉시 출력(RD-015 정책).
- **`sys.stdin.readline()`의 `^C` 에코**.
- **꼬리 뒤 블록의 `... `가 꼬리 폭만큼 밀리는 3.14 quirk**.
- **RD-012g 동기 XHR 대기 중 Ctrl+C**: `pyodide.http.open_url`·`pyxhr.get`은 `req.open(…, False)`인 동기 XHR이라 워커 스레드를 통째로 막아 폴링 지점도 감시 타이머도 없다. 3초 지연 서버 N=5 실측에서 `pyxhr.get`은 응답 뒤 `KeyboardInterrupt`, `open_url`은 눌림 무시. 동기 API 의미를 바꾸지 않는 설계가 필요한데 시나리오가 드물다.
- **RD-016e 미로드 pyodide 배포 패키지의 import 후보**: 3.14 동등 범위 밖의 pyodide 확장. lockfile 패키지명을 후보에 넣으면 후보 집합이 로드 상태에 의존하고 `from numpy import <Tab>`은 로드 전 속성을 볼 수 없어 일관성이 깨진다.

