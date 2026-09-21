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

### 읽기

**REPL 읽기**:
worker가 다음 입력 줄을 요청하는 것(`readLine`). 비동기이며 worker는 기다리는 동안 살아 있다.
_Avoid_: 프롬프트 읽기, 콘솔 입력

**stdin 읽기**:
Python `input()`·`sys.stdin`이 한 줄을 요구하는 것(`readInput`). worker가 멈춘 채 메일박스로 응답을 받는다.
_Avoid_: input 읽기, 동기 읽기

**취소**:
읽기 중 Ctrl+C로 그 읽기를 `null`로 끝내는 것. REPL 읽기의 취소는 미완성 블록을 버리고, stdin 읽기의 취소는 `KeyboardInterrupt`가 된다.
_Avoid_: 중단(실행 중 Ctrl+C를 가리키는 말), abort

**read-guard**:
REPL 읽기가 활성인 동안 도착한 stdin 읽기를 그 REPL 읽기가 끝난 뒤로 미루는 규칙.

**꼬리**:
직전 출력에서 마지막 개행 뒤(그 안에서 마지막 `\r` 뒤)에 남은 텍스트. 읽기의 프롬프트로 다시 그려진다.
_Avoid_: 잔여 출력, 부분 줄

**pending**:
블록 입력 중 이미 제출된 `... ` 줄들을 개행으로 이은 텍스트. 자동 들여쓰기·Tab 완성·블록 히스토리가 쓴다.
_Avoid_: 버퍼(콘솔 내부 `buffer`와 혼동)

### 실행

**제출**:
Enter 한 번으로 worker에 넘어가는 입력 단위. 한 줄이거나 개행이 든 여러 줄이다.
_Avoid_: 커맨드, 셀

**블록**:
`... ` 프롬프트로 이어지는 미완성 복합문 입력. 제출이 아니라 판정(`incomplete`)의 결과다.

**중단**:
실행 중 Ctrl+C로 사용자 코드에 `KeyboardInterrupt`를 올리는 것.
_Avoid_: 취소, 인터럽트(신호 자체를 가리킬 때만)

**정지한 실행**:
사용자 코드가 실행 중이지만 Python이 돌지 않는 상태(`run_sync`·`asyncio.run`·top-level await 대기). SIGINT 폴링이 없어 감시 타이머가 깨운다.
_Avoid_: idle(프롬프트 유휴와 혼동)

**프롬프트 유휴**:
REPL 읽기를 기다리며 사용자 코드가 없는 상태. 여기서 남은 SIGINT는 폐기한다.

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
대상 코드가 없는 SIGINT를 지우고 ack하는 것(실행 직전, 프롬프트 유휴, 버퍼 연결 직전).

**송신기**:
main의 눌림 전송·점검·재전송 상태기계.

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

**전역 스트림**:
콘솔 리다이렉트 밖에서 Python이 쓰는 stdout/stderr. 배경 콜백 출력이 여기로 온다.

### 동등성

**동등성 기준**:
CPython 3.14.4 `_pyrepl`을 pty 24×80으로 띄운 실측 화면.
_Avoid_: 레퍼런스, 원본 동작

**편차**:
동등성 기준과 다르다고 확인하고 문서에 남긴 동작.
_Avoid_: 버그, 한계(원인이 라이브러리 제약일 때만)

**범위 밖**:
편차 중 재현하지 않기로 확정한 것. 로드맵에 등록하지 않는다.
