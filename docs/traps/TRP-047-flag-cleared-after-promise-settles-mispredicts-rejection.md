# TRP-047 결과 Promise 정착 뒤 풀리는 `inFlight` 플래그로 "run이 받아들여질지"를 예측하면 콜백 안 재호출에서 낡는다

- 상태: ACTIVE
- 적용 조건: 실행창(또는 React 래퍼)이 core `run()`의 거부(`busy`)를 미리 예측해 거부될 `run()`이 화면을 건드리지 않게 하는 코드. 예측에 `run()`의 Promise `finally`에서 내리는 플래그를 쓸 때.

## 오해하기 쉬운 신호

- `finally` 콜백은 core가 슬롯을 비우고 Promise를 resolve한 뒤 마이크로태스크에서 돈다. core가 `ready`를 알리는 콜백(`onStatus`) 안이나 `resolve` 직후 같은 동기 구간에서 `run()`을 다시 부르면 core는 슬롯이 비어 받아들이는데 플래그는 아직 참이라 "거부될 것"으로 잘못 예측해 화면을 준비하지 않는다.
- 결과: 출력 꼬리가 남아 다음 `input()` 프롬프트가 이전 출력을 물려받는다. 일반 순서(결과를 `await`한 뒤 다음 `run()`)의 시험은 모두 통과한다.

## 원인

- 슬롯 점유의 진실은 core 상태(`running`·`waiting-input`)에 있다. 플래그가 필요한 것은 상태만으로 알 수 없는 `loading`·`restarting` 대기 중 run뿐이다.

## 탐지/회피

- 예측은 core 상태로 하고 플래그는 `loading`·`restarting`일 때만 본다(`terminal-runner.ts`의 `willBeRejected`). 남는 좁은 창(대기 중 run이 있는 `onStatus("ready")` 콜백 안의 `run()`)은 core에 슬롯 점유 게터가 생기면 없앨 수 있다.
- 시험: `terminal-runner.test.ts`의 "실행 시작에 꼬리를 비워…"(동기 재호출), "끝난 run 뒤 재시작 대기 중에 부른 run은 슬롯이 비어 있으므로 화면을 준비한다".
