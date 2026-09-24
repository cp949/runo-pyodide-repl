# pyodide-terminal

xterm 실행창(`createTerminalRunner`)과 repl이 공유하는 xterm 결합 부품 5종. core 위에 얹히고 coincident에 의존하지 않는다. private이고 공개 API로 확정하지 않은 내부 계약이다(RD-022). 코드·문서·시험 이름에 쓰는 용어를 정의한다. main·worker·세션·읽기·인터럽트·꼬리의 일반 용어는 `packages/pyodide-repl/CONTEXT.md`, driver·core 세션·`InputProvider`는 `packages/pyodide-core/CONTEXT.md`를 따르고, 여기서는 terminal이 도입한 용어만 정의한다. 규칙 본문은 `docs/design/14-runner.md`.

## Language

### 실행창

**실행창(terminal runner)**:
`createTerminalRunner(options)`가 만드는 핸들. core `createRunner`를 호출자 소유 xterm `Terminal`에 붙여 코드 한 덩어리를 실행하고 `input()`만 한 줄 읽는다. REPL과 달리 프롬프트도 history도 없다. `Terminal`은 dispose하지 않는다.
_Avoid_: 콘솔, 터미널 REPL

**runner**:
core `createRunner`가 돌려주는 UI 비의존 실행 핸들(`run`·`stop`·`interrupt`·`reset`·`dispose`·`status`). 실행창은 runner 위에 화면·입력을 얹는다. 상태 8종·결과 유니온·`RunRejectedError`는 core 용어다.
_Avoid_: 세션(세션은 core 세션 = worker 한 개), 실행기

**읽기 밖 입력**:
`input()` 읽기가 열려 있지 않은 구간(실행 중·로딩 중·결과 뒤)에 들어온 문자·붙여넣기·IME 조합 결과·Shift+Enter. 실행창은 벤더 `Readline`을 `typeAhead: false`로 만들어 이를 버린다. REPL의 type-ahead(쌓았다가 재생)와 반대다.
_Avoid_: 무시된 키, 유실 키(의도된 동작이다)

**Ctrl+C 분기**:
읽기 밖 Ctrl+C(벤더 `setCtrlCHandler`)를 runner 상태로 가르는 규칙. 선택이 있으면 복사, `running`이면 `^C` + `interrupt()`, `waiting-input`이면 읽기 취소, 그 밖은 무동작. 읽기 중 Ctrl+C는 벤더가 `cancelable` 읽기를 `null`로 끝낸다.

**abort 정리**:
기본 입력 provider가 `signal` abort에서 하는 일. `readline.cancelRead()`로 열린 읽기를 끝내고 입력줄 뒤에 `\r\n`을 쓴다(`dispose()` 중에는 쓰지 않는다). 안 하면 다음 Enter가 죽은 읽기로 들어간다.

**커서 줄바꿈**:
`run()` 시작 시 커서가 행 머리가 아니면(`cursorX !== 0`) `\r\n`을 한 번 쓰는 규칙. `clearOnRun`이면 대신 화면을 지운다. 거부될 `run()`은 화면을 건드리지 않는다.

**거부 예측**:
core가 코드를 실행하지 않고 거부할 `run()`(상태로 알 수 있는 경우)에서 화면을 준비하지 않게 하는 판정(`willBeRejected`). `loading`·`restarting` 중 대기하는 run은 상태만으로 알 수 없어 `inFlight` 플래그를 함께 본다.
_Avoid_: 사전 검증

### 공통 부품

**`./internal`**:
`@cp949/runo-pyodide-terminal/internal` 서브패스. `sinks`·`rewind-tail`·`stdin-reader`·`notice`·`selection-copy`를 `export *`로 낸다. repl 전용이고 두 패키지가 lockstep으로 바뀌며 안정성을 보장하지 않는다. 앱 코드는 `.` 진입점만 쓴다.
_Avoid_: 공개 API, 유틸

**sink**:
main이 터미널에 쓰는 함수 4종(`writeOutput`·`writeError`·`write`·`writeErrorRaw`)과 꼬리 추적(`tail`·`resetTail`). 실행창은 stdout을 `write`, stderr를 `writeErrorRaw`로 그린다. 정의는 `05-output.md`.

**입력 리더(`createInputReader`)**:
직전 출력의 꼬리를 프롬프트로 그 자리에 다시 그려(`rewindTail` 뒤) 한 줄을 읽는 부품. `read(cancelable, signal?)`. `signal`은 꼬리 정리(flush) 대기 뒤 abort 여부를 다시 확인하는 데만 쓴다. REPL 읽기(`repl-reader`, `>>> ` 합성)와 다르다.

**선택 복사(`createSelectionCopy`)**:
드래그 선택 시 자동 복사와 선택 중 Ctrl+C 복사(Shift 무관)를 처리하는 정책 객체. `Readline`보다 먼저 만든다(`06-editing.md` 6.6).
