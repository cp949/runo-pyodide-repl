# TRP-044 `input()` 읽기 취소(`null`)는 `EOFError`가 아니라 `KeyboardInterrupt`다

- 상태: ACTIVE
- 적용 조건: main 쪽에서 `readInput`·`InputProvider`의 결과 `null`을 "입력 없음(EOF)"의 뜻으로 쓰는 설계·소비자(`inputProvider`가 입력 없음을 `null`로 돌려주는 React·canvas 래퍼). provider 없는 runner의 `input()`을 기대할 때.

## 오해하기 쉬운 신호

- 설계 문서나 가짜 worker 시험(메일박스 `CANCELLED` 상태 확인)은 통과한다. 실제로는 `input()`이 `EOFError`가 아니라 `KeyboardInterrupt`로 끝나고 run의 결과는 `interrupted`이며 트레이스백이 나온다.
- 빈 문자열 `""`은 EOF가 아니다: pyodide가 `\n`을 붙여 빈 줄이 된다.

## 원인

- 메일박스 프로토콜에 EOF 상태가 없다(IDLE·READY·CANCELLED·ERROR). CANCELLED = 읽기 취소이고 worker stdin 콜백이 이를 `signalInterrupt` + `checkInterrupt`로 바꿔 `input()` 호출 지점의 `KeyboardInterrupt`를 만든다(`docs/design/04-stdin-input.md` 3.1). `null`을 그대로 돌려 `EOFError`를 만드는 대안은 취소가 아니라는 이유로 기각된 경로다.

## 탐지/회피

- EOF가 필요하면 메일박스 프로토콜과 stdin 콜백에 상태를 더해야 한다(REPL과 공유하는 계층이라 별도 RD 항목, `docs/design/10-parity-deviations.md` 편차 34와 같은 원인). 그 전까지 provider 없는 runner의 `input()`은 `interrupted`다(`docs/design/14-runner.md` 14.4).
- 시험은 가짜 worker가 아니라 실제 pyodide worker 스레드로 본다: `session/runner-pyodide.test.ts`의 "provider가 없으면 input()은 읽기 취소를 받는다".
