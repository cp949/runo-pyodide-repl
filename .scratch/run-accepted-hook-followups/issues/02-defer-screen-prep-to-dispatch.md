# 대기 run(`loading`·`restarting`)의 화면 준비를 실제 시작(dispatch) 시점으로 미룰지

Status: deferred
Origin: run-accepted-hook 작업 마무리(사양 선택). 관찰된 피해 없음.

## 현상

`onRunAccepted`는 `run()`이 수락되는 즉시 불린다. 그래서 `loading`·`restarting` 중 수락된 run도 그때 화면을 지우거나(`clearOnRun`) 줄바꿈을 낸다. 대기 중 `stop()`으로 취소된 run은 코드가 실행되지 않았는데 화면이 이미 준비돼 있다. `docs/design/14-runner.md` 14.5.4는 "받아들여질 때"로 이 동작을 사양으로 적고 있다. 앱에서 이로 인한 문제가 관찰된 적은 없다.

## 완료 기준

대기 run의 화면 준비가 `runCode` 전송 시점으로 옮겨진 뒤 다음이 성립한다: 로딩 중 수락됐다가 `stop()`으로 취소된 run은 화면을 건드리지 않는다. core에 dispatch 시점 콜백을 더하고 14.3·14.5.4·`packages/pyodide-core/CONTEXT.md` "수락"을 고치며, `terminal-runner-screen.test.ts`에 취소 시나리오 시험을 더한다(변이 killed).

## 재개 조건

앱에서 "취소된 run이 화면을 지운다" 또는 로딩 중 붙은 줄바꿈이 문제로 관찰될 때. 그 전에는 조사하지 않는다.

## Comments

- 등록 시점 분류: 재현 가능한 사용자 시나리오와 관찰된 피해가 없는 사양 선택이라 `open` 기준 미충족, `deferred`.
