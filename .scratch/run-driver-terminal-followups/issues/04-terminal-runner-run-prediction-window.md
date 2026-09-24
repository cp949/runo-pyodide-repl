# 대기 중 run이 있을 때 `onStatus("ready")` 콜백 안에서 `run()`을 부르면 거부되는데도 화면이 준비된다

Status: done
Origin: RD-022 구현 중 발견(terminal 실행창)(`docs/traps/TRP-047`의 남는 창).

## 현상

`createTerminalRunner`는 core `run()`의 거부를 core 상태로 예측해 거부될 `run()`이 화면을 건드리지 않게 한다(`willBeRejected`, `docs/design/14-runner.md` 14.5.4). core는 `loading`·`restarting` 대기 중이던 run을 `ready` 알림에서 dispatch한다(`onStatus("ready")` → dispatch). 그 콜백 안에서 호출자가 `run()`을 또 부르면 core는 `busy`로 거부하는데 실행창의 예측은 상태가 `ready`라서 받아들여질 것으로 보고 `clearOnRun`이면 화면을 지우고, 아니면 줄바꿈을 낸다.

영향: 대기 run이 곧 시작될 화면(아직 출력 없음)이라 관찰 가능한 피해는 빈 줄 하나 또는 화면 지움이다. 재현하려면 앱이 `onStatus`에서 동기로 `run()`을 불러야 한다. 실제 재현은 시험으로만 확인했고 앱에서 관찰한 적은 없다.

## 완료 기준

core `RunnerHandle`에 슬롯 점유를 읽는 게터(예: `busy`)를 두고 `willBeRejected`가 상태 추측 대신 그것을 쓴다. 시험: 대기 run이 있는 `onStatus("ready")` 콜백 안의 `run()`이 화면을 건드리지 않는다(RED + 변이 killed).

## 재개 조건

앱이 `onStatus("ready")` 콜백 안에서 `run()`을 동기로 부르는 사용례(예: RD-024 React 래퍼)가 생기거나, core `RunnerHandle` 공개 표면을 손댈 일이 있을 때. 그 전에는 조사하지 않는다.

## Comments

- 2026-09-24 등록 시점 분류: 코드 읽기와 시험으로만 확인했고 앱에서 관찰한 피해가 없어 `deferred`(`docs/agents/issue-tracker.md` "등록·분류 기준": 추정만 있는 문제).
- 2026-09-24 재개·종결: RD-022 사후 리뷰에서 같은 예측 결함의 더 흔한 경로를 찾았다 — 실행 중 `reset(); run(code)`를 같은 틱에 부르면 core는 받아들이는데 실행창은 `inFlight`(옛 run의 `finally` 전)로 거부를 예측해 화면을 준비하지 않고, 그 run이 플래그를 올리지 않아 이어지는 세 번째 `run()`은 거부되면서 화면을 지운다. 재개 조건(core `RunnerHandle` 공개 표면 변경)을 이 수정이 충족한다. core `RunnerHandle.busy`(`active !== undefined || status === "waiting-input"`)를 추가하고 `willBeRejected`가 `inFlight` 대신 그것을 읽는다. 시험: `terminal-runner.test.ts` 3건 RED → GREEN(본 이슈 시나리오 포함), core `runner.test.ts` `busy` 3건. 변이: `willBeRejected`의 `core.busy` → `false`는 4건 killed, core `busy`의 `waiting-input` 항 제거는 1건 killed.
