# TRP-049 node의 `worker.terminate()`는 즉시 끝나지만 Chromium은 스크립트가 끝나지 않는 worker를 최대 약 2초 늦게 끝내, 재시작 뒤 공유 버퍼의 눌림이 옛 worker에 가로채인다

- 상태: ACTIVE
- 적용 조건: main이 `worker.terminate()`를 부른 뒤 새 worker를 만드는 재시작 경로(`createRunner`의 `stop()` 폴백·`reset()`·크래시 복구, REPL `reset()`)에서 옛 worker가 Python 무한 루프처럼 스크립트가 끝나지 않는 상태일 때. 옛 worker와 새 worker가 SharedArrayBuffer(interrupt buffer)를 공유할 때 특히. 재시작 시험을 쓸 때.

## 오해하기 쉬운 신호

- node 시험(실제 pyodide worker 스레드)에서는 폴백 뒤 첫 `stop()`·`interrupt()`가 정상이라 결함이 없어 보인다. "재시작 뒤 새 run이 `print`를 정상 실행한다"까지만 보는 시험은 통과하고 `reset()` 뒤 interrupt도 브라우저에서 (idle 상태의 옛 worker라) 통과한다.
- 브라우저에서 `ready` 상태·worker 수(2개)·화면은 정상이고 `^C`만 찍힌 채 결과가 오지 않는다. `SEQ`·`ACK` 값은 연속·정상이라 프로토콜 규약 오류처럼 보인다(`ACK`가 눌림 수만큼 올랐는데 새 worker는 중단되지 않았다).

## 원인

- Chromium(Blink)은 terminate 요청 뒤 스크립트 실행이 끝나지 않는 worker를 약 2초 뒤에 강제 종료한다(실측: `close` 이벤트가 `terminate()`로부터 약 2.0초). 그동안 옛 worker의 Python은 계속 돌며 SIGINT를 폴링하고, 같은 buffer의 `SIGNAL`을 소비·`ACK`하고 `KeyboardInterrupt`를 삼킨다. 새 worker의 첫 눌림이 유실된다.

## 탐지/회피

- 세션마다 새 SharedArrayBuffer(interrupt buffer)와 송신기를 만든다(core `createRunner`의 `spawn()`). REPL의 `reset()`은 같은 buffer를 재사용해 같은 잠재 결함이 있고 브라우저 재현은 확인하지 않았다.
- 재시작 시험은 "재시작 뒤 `while True: pass` + interrupt → `interrupted`"까지 보고, 옛 worker의 `terminate()`를 지연시키는 worker 공장으로 2초 구간을 흉내 낸다(`session/runner-pyodide.test.ts`의 `lingeringWorkers()`). node의 즉시 종료만으로는 RED가 되지 않는다.
- 브라우저 재현은 재시작 직후(옛 worker가 닫히기 전, 약 2초 안) 첫 interrupt를 N회 반복한다.
