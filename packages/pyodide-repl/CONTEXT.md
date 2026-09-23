# pyodide-repl

브라우저 Python REPL 코어. main 스레드의 터미널과 worker의 pyodide를 잇는다. 이 문서는 코드·문서·시험 이름에 쓰는 용어를 정의한다.

## Language

### 실행 주체

**main**:
브라우저 메인 스레드. 터미널·줄 편집·인터럽트 송신을 맡는다.
_Avoid_: UI 스레드, 호스트, 클라이언트

**worker**:
pyodide와 콘솔이 도는 Web Worker. 세션마다 하나.
_Avoid_: 백엔드, 런타임 스레드

**세션**:
worker 하나의 생애. 변수·import·들여쓰기 단위·history 기준점이 세션에 속한다. 화면(스크롤백)은 세션에 속하지 않는다.
_Avoid_: 커널, 인스턴스

**리셋**:
세션을 새 worker로 바꾸는 것. 화면은 남는다.
_Avoid_: 재시작(크래시 복구를 가리킬 때만), 화면 지우기(Ctrl+L, 별개 동작)

**상태**:
`ReplStatus`. 세션의 생애를 앱에 알리는 값(`loading`·`ready`·`load-failed`·`not-isolated`·`terminated`·`crashed`).
_Avoid_: 단계, 페이즈

### 읽기

**REPL 읽기**:
worker가 다음 입력 줄을 요청하는 것(`readLine`). 비동기이며 worker는 기다리는 동안 살아 있다.
_Avoid_: 프롬프트 읽기, 콘솔 입력

**stdin 읽기**:
Python `input()`·`sys.stdin`이 한 줄을 요구하는 것(`readInput`). worker가 멈춘 채 메일박스로 응답을 받는다.
_Avoid_: input 읽기, 동기 읽기

**취소**:
읽기 중 Ctrl+C로 그 읽기를 `null`로 끝내는 것. 벤더 `Readline`의 cancelable 읽기가 `^C`·history 없이 `\r\n` 뒤 `null`로 이행한다.
REPL 읽기의 취소는 `readLine` 응답 `null` → worker `run(null)`이 미완성 블록을 버리고 빨간 `KeyboardInterrupt` 한 줄을 낸다.
stdin 읽기의 취소는 메일박스 CANCELLED → worker 콜백이 `signalInterrupt` → `checkInterrupt()`로 바꿔 `input()` 호출 지점의 `KeyboardInterrupt`가 된다.
취소는 **읽기를 끝내는 것**이고 중단은 **돌고 있는 코드를 끊는 것**이다. 취소는 interrupt buffer를 main에서 쓰지 않는다(REPL 취소는 버퍼를 전혀 쓰지 않고, stdin 취소는 worker 콜백이 쓰고 그 자리에서 소비한다).
_Avoid_: 중단(실행 중 Ctrl+C를 가리키는 말), abort

**read-guard**:
REPL 읽기가 활성인 동안 도착한 stdin 읽기를 그 REPL 읽기가 끝난 뒤로 미루는 규칙.

**꼬리**:
직전 출력에서 마지막 개행 뒤(그 안에서 마지막 `\r` 뒤)에 남은 텍스트. 읽기의 프롬프트로 다시 그려진다.
_Avoid_: 잔여 출력, 부분 줄

**pending**:
블록 입력 중 이미 제출된 `... ` 줄들을 개행으로 이은 텍스트. 자동 들여쓰기·Tab 완성·블록 히스토리가 쓴다.
_Avoid_: 버퍼(콘솔 내부 `buffer`와 혼동)

**블록 history 기준점**:
`createBlockHistory`가 소유하는 세션 상태(`blockBase`·`pendingBlock`). 블록 첫 줄이 append되기 직전의
`entries` 스냅샷이고, 이어지는 제출마다 이 기준점으로 되돌린 뒤 다시 기록한다("진행형 교체"). 취소·리셋의
`discard()`가 이 기준점으로 복원한다. 세션이 바뀌면(리셋) 새 `createBlockHistory` 객체가 되어 사라진다.
_Avoid_: 스냅샷(코드 안에서는 이 이름을 쓰지만 용어로는 "기준점"을 쓴다)

**`historyEntry`**:
벤더 `ReadOptions.historyEntry`. Enter 분기에서 `skipBlankHistory`가 거른 뒤·`history.append` 직전에 불려
돌려준 문자열이 기록된다(`resolve`는 원래 줄 그대로). 블록 히스토리가 이 훅으로 진행형 교체를 구현한다.

**`mergeReadOptions`**:
`terminal/read-options.ts`의 순수 함수. 세션이 `blockHistory.readOptions(pending)`·
`autoIndent.readOptions(pending)` 등 여러 정책 객체의 `ReadOptions` 조각을 하나로 합성해 `createReplReader`에
넘긴다. `onKey`는 앞에서부터 먼저 소비한 쪽이 이기고, `prefill`·`historyEntry`는 뒤가 이긴다.

### 실행

**제출**:
Enter 한 번으로 worker에 넘어가는 입력 단위. 한 줄이거나 개행이 든 여러 줄이다.
_Avoid_: 커맨드, 셀

**블록**:
`... ` 프롬프트로 이어지는 미완성 복합문 입력. 제출이 아니라 판정(`incomplete`)의 결과다.

**프리필**:
`... ` 다음 입력줄에 자동으로 채워 넣는 들여쓰기 텍스트(`terminal/auto-indent.ts`의 `nextIndentation`).
벤더 `ReadOptions.prefill`로 넣는다. 일반 Enter·붙여넣기·`input()`에는 넣지 않는다.
_Avoid_: 자동완성(Tab 완성과 혼동), 힌트

**`lastUsedIndentation`**:
세션이 사는 동안 유지되는 "마지막으로 본 들여쓰기 단위"(`_pyrepl`의 `last_used_indentation`과 같은 개념).
`createAutoIndent(readline)`가 소유하는 클로저 상태이고, 세션 리셋은 새 객체를 만들어 4칸(`DEFAULT_UNIT`)으로
되돌린다. 취소로는 지워지지 않는다.
_Avoid_: 들여쓰기 폭(단위 자체를 가리킬 때는 이 말을 쓴다. 상태 이름과 섞지 않는다)

**`onKey`**:
벤더 `ReadOptions.onKey`. 활성 읽기의 키마다 벤더 처리 앞에서 불려 `true`를 돌려주면 그 키를 소비한다.
자동 들여쓰기(Shift/Alt+Enter·Backspace)와 Tab 완성이 같은 훅을 쓴다.
_Avoid_: 키 핸들러(범용 이벤트 핸들러와 혼동)

**중단**:
실행 중 Ctrl+C로 사용자 코드에 `KeyboardInterrupt`를 올리는 것.
_Avoid_: 취소, 인터럽트(신호 자체를 가리킬 때만)

**정지한 실행**:
사용자 코드가 실행 중이지만 Python이 돌지 않는 상태(`run_sync`·`asyncio.run`·top-level await 대기). SIGINT 폴링이 없어 감시 타이머가 깨운다.
_Avoid_: idle(프롬프트 유휴와 혼동)

**깨우기**:
정지한 실행을 취소해 사용자 지점에서 `KeyboardInterrupt`가 나게 하는 것. Python `interrupt_idle()`(TS 타입 `InterruptIdle`)이 진입점이고 감시 타이머와 핸들러 규칙 ③이 부른다. 깨웠으면 참을 돌려주지만 **거짓이 "깨우지 못했다"를 뜻하지는 않는다**(폴링이 먼저 깨운 경우가 있다).
_Avoid_: 인터럽트, 재개

**`time.sleep` 조각**:
`time.sleep`을 20ms 조각으로 나누고 조각마다 `checkInterrupt()`를 부르는 래퍼(`worker/sleep-slice.py`). 원본은 `time.sleep.__wrapped__`이고 JSPI 유무와 무관하게 항상 교체한다. 조각이 있으면 sleep 중에도 사용자 스택이 살아 있어 깨우기가 아니라 일반 중단 경로로 끊긴다.
_Avoid_: 슬라이스 sleep, 청크

**`IdleInterrupt`**:
top-level await 대기를 깨울 때 콘솔 task를 끝내는 표지 예외(`Exception` 계열이라 webloop 재던짐 경로를 피한다). `formattraceback`이 `KeyboardInterrupt` 한 줄로 바꿔 보여 준다.

**프롬프트 유휴**:
REPL 읽기를 기다리며 사용자 코드가 없는 상태(`ReplLoopDeps.setAtPrompt(true)` 구간). 여기서 남은 SIGINT는 폐기한다.

**Python 소스**:
worker가 pyodide에 넣는 Python 코드. TS 문자열이 아니라 `src/worker/*.py` 파일이고 `import SOURCE from "./x.py?raw"`로 가져온다(tsdown `load` 훅 + `src/py-modules.d.ts`). `runPython(SOURCE, { globals, filename })`의 `filename`은 `<console-helpers>`처럼 **`<…>` 꺾쇠 이름**을 쓴다 — 트레이스백에 새면 알아보기 위한 것이고, 절단은 문자열이 아니라 코드 객체로 한다.
_Avoid_: 인라인 스크립트, 템플릿 문자열

### 인터럽트

**눌림**:
사용자의 Ctrl+C 한 번. 요청 번호 하나에 대응한다.
_Avoid_: 시그널, 이벤트

**SIGINT**:
interrupt buffer 슬롯 `[0]`의 값 2. pyodide 폴링이 소비한다.

**요청 번호**:
슬롯 `[2]`. 눌림마다 1 증가하고 재전송은 같은 번호다.
_Avoid_: seq(코드 상수명으로만), 시퀀스 ID

**ack**:
슬롯 `[1]`. worker가 눌림을 받았다는 표시. 핸들러 진입·감시 타이머 소비·폐기 지점에서만 올린다.

**재전송**:
송신기가 소실로 판정한 눌림을 같은 요청 번호로 다시 쓰는 것(5ms 점검, 최대 10회).
_Avoid_: 재시도

**폐기**:
대상 코드가 없는 SIGINT를 지우고 ack하는 것(실행 직전은 `worker/repl-loop.ts`, 버퍼 연결 직전은 `worker/interrupt-buffer.ts`, 프롬프트 유휴는 `worker/interrupt-watch.ts`의 감시 타이머). 핸들러의 "`<console>` 프레임 없으면 버린다"도 같은 목적이다.

**송신기**:
main의 눌림 전송·점검·재전송 상태기계(`protocol/interrupt-sender.ts`).

**게이트**:
main이 보는 "Python 실행 중"(`createRepl`의 `pythonRunning`). worker가 살아 있고(`alive`) 대기 중인 `readLine`·`readInput` 읽기가 없고 취소 직후 구간이 아니면(`!cancelSettling`) 참이다. 거짓이면 Ctrl+C를 에코도 전송도 하지 않는다. 로딩 중은 참이다(부팅 중 눌림은 worker의 연결 단계가 폐기한다).
_Avoid_: running 플래그, busy

**cancelSettling**:
게이트의 항 하나. REPL 읽기가 취소로 끝난 뒤 다음 요청이 도착하기 전까지 참이다(`readLine` 도착·`readInput` 도착·`inputReadsPending → 0`에서 거짓). 이 구간의 Ctrl+C는 SIGINT를 남겨 다음 실행을 죽이므로 막는다. `input()` 취소에는 세우지 않는다(취소 뒤에도 사용자 코드가 계속 돈다).
_Avoid_: guardAfterCancel(이전 구현의 벤더 인자 이름), 취소 방어 플래그

**감시 타이머**:
worker의 20ms 타이머. 정지한 실행 중 SIGINT를 엿보고 깨우며, 프롬프트 유휴 SIGINT를 폐기한다.
_Avoid_: 워치독, 폴러

### 채널

**RPC**:
전용 MessagePort 위의 요청/응답/알림. 비동기.
_Avoid_: 브리지, 프록시

**메일박스**:
stdin 읽기 응답을 담는 SharedArrayBuffer. worker가 `Atomics.wait`로 기다린다.
_Avoid_: 동기 브리지, 채널

**interrupt buffer**:
pyodide `setInterruptBuffer`에 넘기는 `Int32Array(4)`. 세션 간 재사용한다.

**초기화 프레임**:
worker 생성 직후 main이 보내는 단 하나의 네이티브 메시지. 포트·버퍼·설정을 담는다.
_Avoid_: handshake

### 출력

**sink**:
main이 터미널에 쓰는 함수 4종(`write`, `writeErrorRaw`, `writeOutput`, `writeError`). 개행·색 규칙을 가진다.
_Avoid_: 로거, 출력 콜백

**값 에코**:
식의 결과를 `repr()`로 `writeOutput`에 내는 것. `None`은 내지 않는다.
_Avoid_: displayhook, 결과 출력

**전역 스트림**:
콘솔 리다이렉트 밖에서 Python이 쓰는 stdout/stderr. 배경 콜백 출력이 여기로 온다.

**안내 줄**:
세션 밖에서 main이 찍는 개행으로 끝나는 한 줄(비격리 경고·리셋 안내). sink 세트가 아니라 `writeNotice`로 낸다.
_Avoid_: 시스템 메시지, 로그

### 동등성

**동등성 기준**:
CPython 3.14.4 `_pyrepl`을 pty 24×80으로 띄운 실측 화면.
_Avoid_: 레퍼런스, 원본 동작

**편차**:
동등성 기준과 다르다고 확인하고 문서에 남긴 동작.
_Avoid_: 버그, 한계(원인이 라이브러리 제약일 때만)

**범위 밖**:
편차 중 재현하지 않기로 확정한 것. 로드맵에 등록하지 않는다.
