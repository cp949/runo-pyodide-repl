# Ctrl+C / SIGINT 프로토콜

> 이 문서의 규칙·상수는 이전 구현(`/work/cp949/pyodide-samples/apps/repl`, 읽기 전용 참고)이 CPython 3.14.4 pty 실측과 브라우저 회귀로 확정한 것이다. 새 구현은 통신 계층만 바꾸고(`docs/design/00-architecture.md`, `01-protocols.md`) 이 규칙은 그대로 지킨다. 절 끝의 "참고:" 경로는 이전 구현의 근거 위치다.

interrupt buffer의 슬롯 배치와 전달 경로 자체는 `01-protocols.md` 3절에 있다. 이 문서는 그 위의 프로토콜(요청 번호·ack·재전송, Python 핸들러, 감시 타이머, 연결 순서)이다. 새 구현에서 달라지는 점은 하나다: `readInput` 진입은 main이 메일박스 요청 알림을 받는 시점이다.

## 2.1 버퍼 슬롯
- `createInterruptBuffer()` = `new Int32Array(new SharedArrayBuffer(4 * 4))`,
  `INTERRUPT_BUFFER_LENGTH = 4`.
- `SIGNAL = 0` — main이 `2`를 쓰고 pyodide 폴링이 읽고 비운다.
- `ACK = 1` — 눌림이 worker에 전달됐다는 표시. **worker 스레드 한 곳만** 올린다.
- `SEQ = 2` — 요청 번호. 새 눌림마다 +1, 재전송은 같은 번호.
- `[3]` 예약.
- pyodide에는 **진짜 `Int32Array`를 그대로** 넘긴다. 접근자/Proxy를 끼우면 소실은 0이 되지만
  폴링 경로 비용이 통과선(plain 대비 1.05)을 넘는다(하한 1.095, TRP-024).
- `hasProtocolSlots(buffer) = buffer.length > SEQ`. 길이 3 미만 버퍼(옛 하니스)에서는 ack·번호·재전송이
  모두 no-op이고 SIGINT 슬롯만 동작한다.

## 2.2 쓰기·ack 규칙
- `signalInterrupt(buffer)`: **`Atomics.add(SEQ, 1)`을 먼저** 하고 그다음 `Atomics.store(SIGNAL, 2)`.
  SIGINT가 보이는 순간 핸들러가 읽는 번호가 이 눌림의 것이어야 새 눌림이 직전 눌림의 재전송으로 오인되지 않는다.
  새 SIGINT를 쓰는 경로는 main 송신기와 `stdin-callback.ts` 두 곳뿐이다.
- 재전송은 번호를 올리지 않고 `Atomics.compareExchange(SIGNAL, 0, 2)`만 한다.
- ack를 올리는 지점은 셋뿐이다: ① 핸들러 진입(스택 검사·예외보다 먼저, 버려지는 SIGINT도 ack),
  ② 감시 타이머의 소비 성공(`compareExchange(2→0)`가 성공했을 때만), ③ 폐기(`discardPendingInterrupt`,
  `attachInterruptBuffer`)가 실제로 `2`를 지웠을 때만.
- 폐기가 ack 없이 슬롯만 지우면 송신기가 "소실"로 오판해 `2`를 되살린다(TRP-027).

## 2.3 main 송신기 상태기계(`createInterruptSender`)
- 옵션 기본값: `intervalMs = 5`, `maxResends = 10`. 타이머는 주입(`setTimer`/`clearTimer`,
  프로덕션은 `window.setTimeout`).
- `send()`: ack 값을 스냅샷 → `signalInterrupt` → 5ms마다 점검.
- 점검 1틱의 읽기 **순서는 `SIGNAL` 먼저, `ACK` 나중**. 반대로 읽으면 낡은 ack와 비워진 슬롯을
  소실로 오판한다.
  - ack ≠ 스냅샷 → 전달됨, 종료.
  - `buf[SIGNAL] === 2` → 아직 소비 전(블로킹 C 호출 등), 재전송하지 않고 다음 틱.
  - `buf[SIGNAL] === 0`인데 ack 그대로 → 폴링이 읽고 비우는 사이에 쓴 값이 지워진 것.
    같은 번호로 `compareExchange(0→2)`(최대 10회).
- 새 `send()`는 이전 요청을 교체한다.
- `cancel()` 지점: ack 증가(점검이 스스로 끝낸다), `readLine` 요청 도착, `readInput` 알림 도착,
  `sessionTerminated`, `loadFailed`, `dispose()`, 새 눌림. 새 worker 직전(슬롯 비우기 전)은 RD-010.
- **main 게이트 `pythonRunning`**(RD-007, 2.7): 거짓이면 `send()` 자체를 하지 않는다. 그래서 `exit()`·로드
  실패 뒤의 눌림이 슬롯에 SIGNAL 2를 영원히 남겨 5ms 점검이 무한히 도는 일이 없다(이전 구현 RD-012h(a)).

## 2.4 worker 핸들러(`worker/sigint-handler.ts` 안의 Python 소스)

RD-007 시점의 시그니처는 `install(console, ack, seq)`(세 인자 필수, 반환값 없음)이고 아래 ①②④와
`formattraceback` 절단까지다. ③(깨우기)과 `warn`·`interrupt_idle` 반환·`run_sync`/`runcode` 래퍼·
`time.sleep` 조각·설치 가드 5종은 RD-009가 더한다.

**RD-009 전의 중간 상태**: `<console>` 프레임이 없는 SIGINT는 **사용자 실행 중이라도 버린다**(ack는 한다).
따라서 `while True: time.sleep(0.1)`·`asyncio.run` 대기 중 Ctrl+C는 무효다(TRP-020).
1. **진입 첫 줄에서 `seq()` 확인**. `last_seq`와 같으면 ack도 예외도 없이 무시(재전송). 다르면
   `last_seq` 갱신 후 ack. `last_seq` 초기값은 설치 시점의 `buf[SEQ]`(세션 리셋 뒤 같은 버퍼를 재사용해도
   이전 세션의 재전송이 새 세션을 끊지 않는다). `ack`/`seq`가 없으면 번호·ack 없이 동작한다.
2. `frame.f_back`을 따라 `co_filename`이 콘솔의 `filename`(`<console>`)인 프레임이 **하나라도 있으면**
   `signal.default_int_handler`로 `KeyboardInterrupt`를 올린다. 정상 반환 후 다른 경로로 올리면 안 된다:
   `input()` 취소의 EINTR 경로에서 예외를 못 보면 CPython이 읽기를 다시 시도한다(PEP 475).
3. 사용자 프레임이 없고 **사용자 실행 중**(= `runcode` 안, 시간 조건 없음)이면 `interrupt_idle()`로
   정지한 실행을 깨운다.
4. 그 밖(트레이스백 생성 중, 다음 문장 컴파일 중)에는 **버린다**. 허용 목록 방식이고 arm/disarm 상태가
   없어 `KeyboardInterrupt`를 잡고 계속 도는 프로그램은 다음 SIGINT에 다시 중단된다.

깨우기 세부:
- `run_sync` 래퍼(`pyodide.webloop.run_sync`, `pyodide.ffi.run_sync` 교체): 대기 awaitable을 `guard`
  코루틴 Task로 감싼다. 깨울 때 Task를 취소해 `finally`를 돌린 뒤 `guard`가 `CancelledError`를 정상 값
  `WOKEN`으로 바꾸고, 래퍼가 사용자 스택(대기 호출 지점)에서 `KeyboardInterrupt`를 올린다.
- `runcode` 래퍼(인스턴스 속성 교체): 실행 중인 콘솔 task를 `active`로 기록. top-level await 대기 중에는
  그 task를 취소하고 표지 예외 `IdleInterrupt`(`Exception` 계열 — webloop 재던짐 경로를 피함)로 끝낸다.
- 취소는 `CORO_SUSPENDED` Task에만. 깨울 수 없는 순간(대기 코루틴 실행 중, 재개 직전)에는 `pending`
  플래그로 표시하고 재개하는 `run_sync` 래퍼가 `KeyboardInterrupt`로 올린다(TRP-021).
- **`time.sleep` 20ms 조각**(JSPI 유무와 무관하게 항상 교체): 원본은 `time.sleep.__wrapped__`(pyodide가
  `@wraps`로 남긴 원본 C 함수), 래퍼는 `functools.wraps(원본)`. 위치 인자 하나가 유한 양수 `int`/`float`
  (`bool` 제외) 또는 `__index__` 객체이고 9.2e9초 미만일 때만 조각한다. 그 밖(0·음수·NaN·inf·비수치·
  키워드·인자 개수 오류)은 원본에 그대로 넘겨 CPython 그대로의 예외 문구를 낸다. 20ms 초과는
  `end = monotonic() + secs`까지 `원본(min(20ms, 남은 시간))` + `poll()` 반복, **20ms 이하도 원본이 끝난 뒤
  `poll()`을 한 번 한다**(생략하면 지연이 반복 1회 시간의 약 13배까지 늘어난다, TRP-028).
  `poll()`은 `pyodide_js.checkInterrupt()`이고, 그 예외가 `sys.excepthook`으로 stderr에 트레이스백을
  찍으므로(TRP-022) 호출 동안만 `sys.excepthook`을 no-op으로 바꿨다 되돌린다.
- `formattraceback` 래퍼: 트레이스백에서 **가장 바깥의 우리 프레임(핸들러, `run_sync` 래퍼, `sleep`,
  `poll`)부터 안쪽 전부**를 자르고 그 앞에 낀 `webloop.py` 프레임(`run_until_complete`)도 뗀다.
  `IdleInterrupt`는 `KeyboardInterrupt` 한 줄로 만든다. 문자열에서 `File "<sigint-handler>"` 줄을 지우는
  방식보다 견고하다. 안쪽만 자르는 규칙은 연타에서 우리 프레임이 샜다(2/10 → 0/10).
- 설치 가드(pyodide 내부 의존): ① `pyodide.webloop.run_sync` ② `pyodide.ffi.run_sync`
  ③ `console.runcode`가 코루틴 함수 ④ `time.sleep.__wrapped__`가 원본 C 함수(`inspect.isbuiltin`)
  ⑤ `pyodide_js.checkInterrupt` 호출 가능. 하나라도 다르면 해당 부분만 건너뛰고 `console.warn`.
- 핸들러는 별도 namespace에서 `<sigint-handler>` 파일명으로 실행해 사용자 globals를 오염시키지 않는다.

## 2.5 감시 타이머(`startInterruptWatch(buffer, interruptIdle, { atPrompt, tickMs = 20 })`)
- 이벤트 루프가 비는 구간(정지한 `run_sync`·`asyncio.run` 대기, top-level await 대기)에만 실제로 돈다.
- 엿보기는 `Atomics.load(buf, SIGNAL) === 2`, 소비는 **깨웠을 때만** `compareExchange(2 → 0)`.
  깨울 수 없으면 SIGINT를 남겨 재개한 사용자 스택의 폴링이 받게 한다. 소비 성공 시에만 ack.
- **프롬프트 유휴 폐기**: `atPrompt`가 참인데 깨울 것 없이 남은 SIGINT는 대상 코드가 없는 낡은 눌림이라
  그 틱에서 버린다(2를 지웠을 때만 ack). 실행 중(`atPrompt` 거짓) 규칙은 위와 같다.
- 타이머는 요청 번호를 확인하지 않는다(알려진 한계).
- 틱 콜백의 예외는 잡아 로그만 남기고 다음 틱에 재시도한다.
- REPL 루프 직전에 켜고, 루프가 끝나면(`exit()`) 끈다. 세션 리셋은 worker 교체라 함께 사라진다.

## 2.6 연결 순서와 시작 코드 보호
- `connectInterrupts(pyodide, pyconsole, buffer, { ack, seq, discard })`가 유일한 진입점이다. `worker/`는
  `protocol/`을 import하지 않으므로 세 함수는 `boot.ts`가 클로저로 넣는다(`stdin-callback.ts`와 같은 패턴).
  부팅 순서에서 위치는 `createConsole` 뒤·`setStdin` 앞이고 `try` 안이라 실패하면 `loadFailed`다. **핸들러를 먼저 설치하고 그다음
  `attachInterruptBuffer`**(= `discardPendingInterrupt` → `setInterruptBuffer`). 폴링은 연결 뒤에야
  시작하므로 순서가 반대이면 그 사이(Node 3.5~6.6ms)의 눌림을 pyodide 기본 핸들러가 받아 시작 코드가 죽는다.
- REPL 루프는 `readLine`이 줄을 돌려준 직후, `runner.run` **전에** `discardPendingInterrupt(buffer)`로
  비운다(취소 `null`에도 적용). 읽는 동안이나 Enter 직후 쓴 SIGINT는 대상 코드가 없다(TRP-009).
- 새 worker를 만들기 직전 main이 `interruptSender.cancel()` → `Atomics.store(buffer, SIGNAL, 0)` 순서로
  치운다(재전송이 새 worker에 도착하면 같은 사고).

## 2.7 main 쪽 Ctrl+C 처리
- `readline.setCtrlCHandler(...)`는 읽는 중이 아닐 때만 불린다. 눌림마다 `^C`를 **sink `write`로**
  에코하고(꼬리에 들어가야 한다) `interruptSender.send()`를 부른다.
- **게이트 `pythonRunning = alive && !readLinePending && inputReadsPending === 0`**. 거짓이면 에코도 전송도
  하지 않는다. 각 항의 뜻:
  - `alive`: worker 생성부터 `sessionTerminated`·`loadFailed`·`dispose()` 전까지. 그 뒤에는 눌림이 닿을
    코드가 없다(3.14에도 프로세스가 없으므로 편차가 아니다).
  - `!readLinePending`: 수락한 `readLine`의 읽기가 끝나기 전. 요청 도착부터 응답이 포트에 올라가기 전까지라
    **읽기가 실제로 열리기 전의 갭(약 20ms)도 포함한다** — 그 사이 눌림은 에코 없이 버려진다(편차 32).
  - `inputReadsPending === 0`: `readInput` 알림 도착부터 `deliver`/`fail`이 끝날 때까지. 값을 다 전달한
    시점이 worker가 깨어나 실행을 재개하는 시점이다.
- 로딩 중(`ready` 전)은 참이다. 부팅 중 눌림이 실제로 버퍼에 써지고 worker의 연결 단계가 폐기한다(2.6).
  `readLine` 응답 뒤~다음 요청 전(배경 콜백이 CPU를 잡는 구간)도 참이다(편차 2).
- 입력줄 편집 중 Ctrl+C는 `auto-indent-reader`의 `readKey` 래퍼가 처리한다(`04-stdin-input.md` 3.1, `06-editing.md` 6.3).

## 2.8 webloop 재보고 억제(`webloop-reraise.py`)
- WebLoop의 `_keyboard_interrupt_handler`·`_system_exit_handler`를 no-op으로 바꿔 `run_handle`이
  콜백 안의 `KeyboardInterrupt`·`SystemExit`을 다시 던지지 않게 한다. 정상 중단·`input()` 취소·`exit()`가
  내던 `pageerror`(시행당 2, 2, 1건)가 0이 된다. 화면 트레이스백과 `exit()` 종료는 그대로.
- pyodide private 속성이라 없으면 건너뛰고 `console.warn`. 세션당 1회.
- 편차: Task 밖 콜백(`call_later` 등)에서 난 `KeyboardInterrupt`·`SystemExit`은 조용히 버려진다.
- 이 억제 뒤 vitest의 `onUnhandledError` 필터 두 개는 제거했다(재보고 자체를 없앴으므로).

## 2.9 텍스트 시퀀스
```
(A) 실행 중 정상 중단
main: Ctrl+C → pythonRunning() 확인 → sink.write("^C") → sender.send()
      SEQ+=1 → SIGNAL=2 → 5ms 타이머 시작
worker: 폴링이 SIGNAL을 읽고 0으로 비움 → 핸들러 진입
        seq 확인(새 번호) → ACK+=1 → 스택에 <console> 있음 → KeyboardInterrupt
        runcode 밖으로 전파 → formattraceback(우리 프레임 절단) → writeError
main: 다음 점검에서 ack ≠ 스냅샷 → 송신기 종료
      worker가 readLine 진입 → 송신기 cancel

(B) 눌림 소실 → 재전송
main: SEQ+=1 → SIGNAL=2
worker: 폴링이 SIGNAL을 읽고 비웠으나 KeyboardInterrupt가 나지 않음(TRP-019) → ACK 변화 없음
main: 5ms 점검 → SIGNAL===0 && ack 그대로 → 소실 판정 → compareExchange(0→2), 같은 SEQ
worker: 폴링 → 핸들러 → 새 번호이므로 처리 → ACK+=1 → KeyboardInterrupt
main: 점검에서 ack 증가 확인 → 종료 (재전송 최대 10회)

(C) 정지한 실행(time.sleep 밖의 await 대기)
main: SEQ+=1 → SIGNAL=2
worker: Python이 안 돌아 폴링 없음 → 20ms 감시 타이머가 Atomics.load===2 확인
        interruptIdle() 호출 → 깨우기 성공 → compareExchange(2→0) 성공 → ACK+=1
        run_sync 래퍼 또는 콘솔 task 취소로 사용자 지점에서 중단
```

참고: `/work/cp949/pyodide-samples/apps/repl/docs/design/02-ctrl-c.md`,
이전 구현 설계 문서 `02a-prompt-cancel.md`, `02c-key-repeat.md`, `02d-idle-ctrl-c.md`, `02e-lost-press.md`,
이전 구현 설계 문서 `02f-sleep-slice.md`,
`/work/cp949/pyodide-samples/apps/repl/src/repl/{interrupt-protocol,interrupt-sender,interrupt-buffer,interrupt-watch,sigint-handler,webloop-reraise}.ts`,
`/work/cp949/pyodide-samples/apps/repl/src/repl/sigint-handler.py`

