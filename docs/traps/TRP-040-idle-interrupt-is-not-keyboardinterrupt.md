# TRP-040 정지한 대기를 깨운 중단은 `KeyboardInterrupt`가 아니라 `IdleInterrupt`로 끝난다

- 상태: ACTIVE
- 적용 조건: 실행 결말을 `except KeyboardInterrupt`·`isinstance(exc, KeyboardInterrupt)`로 분류하는 코드(`console.runcode`를 부르는 모든 경로: 실행 driver, REPL `runSource` 같은 새 소비자). `sigint-handler.py`의 `IdleInterrupt` 클래스 이름을 바꿀 때.

## 오해하기 쉬운 신호

- 동기 루프(`while` 바쁜 루프)·`time.sleep`·`asyncio.run`·`input()` 취소로 끝낸 중단은 전부 `KeyboardInterrupt`로 와서, 분류 시험이 그것만 보면 통과한다.
- 모듈 최상위 `await`(TLA) 대기를 Ctrl+C로 깨운 경우만 `error`로 분류되고 `errorType: "IdleInterrupt"` 같은 값이 나간다. 화면에는 `KeyboardInterrupt` 한 줄이 나와 사용자에게는 정상 중단처럼 보인다.

## 원인

- 콘솔 task를 `KeyboardInterrupt`로 끝내면 WebLoop가 그것을 다시 던지므로, `sigint-handler.py`의 `runcode` 래퍼가 취소한 콘솔 task를 표지 예외 `IdleInterrupt`(`Exception` 하위)로 끝낸다. `console.formattraceback`이 이를 `"KeyboardInterrupt\n"` 한 줄로 바꾼다. `IdleInterrupt`는 공개 이름이 없다.

## 탐지/회피

- `isinstance(exc, KeyboardInterrupt) or type(exc).__name__ == "IdleInterrupt"`로 판정한다(`packages/pyodide-core/src/worker/run-driver.py`의 `_is_interrupt`). 클래스 이름 문자열에 의존하므로 `sigint-handler.py`에서 이름을 바꾸면 이 판정도 고친다.
- 시험은 TLA `await asyncio.sleep(60)` 중단이 `interrupted`인지 본다(`run-driver-pyodide.test.ts` 가설 3). `run-driver-classify.test.ts`는 이름이 `IdleInterrupt`인 `Exception`을 `interrupted`로, 이름이 비슷한 다른 예외(`IdleInterrupted`)를 `error`로 본다. 이름이 바뀌면 가설 3이 `error`로 실패한다.
