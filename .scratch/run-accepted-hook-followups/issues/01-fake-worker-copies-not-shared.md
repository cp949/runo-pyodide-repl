# fake worker 사본 3개를 core 공용으로 합친다

Status: deferred
Origin: run-accepted-hook 작업 마무리(코드 읽기로 확인한 중복). 사용자 시나리오 결함이 아니라 시험 코드 중복이다.

## 현상

같은 역할의 fake worker가 세 곳에 있다: core `session/runner.test.ts`의 `createFakeWorker`, react `test-utils/fake-worker.ts`, core `src/test/fake-worker.ts`(시험 전용 하위 경로 `@cp949/runo-pyodide-core/test-utils`로 내보내며 terminal `terminal-runner-screen.test.ts`만 쓴다). 앞의 둘은 공용으로 바꾸지 않았다. 세 사본이 어긋나 거짓 통과·거짓 실패가 난 사례는 아직 관찰하지 않았다.

## 완료 기준

core `runner.test.ts`와 react 시험이 공용 fake worker(`test-utils`)를 쓰고 사본이 core `src/test/fake-worker.ts` 하나만 남는다. `pnpm test`가 통과하고 세 사본에만 있던 동작(있다면)은 공용 쪽에 옮겨져 시험 개수가 줄지 않는다.

## 재개 조건

fake worker 동작을 고쳐야 해서 두 곳 이상을 함께 수정하게 될 때, 또는 네 번째 사본이 필요해질 때. 그 전에는 조사하지 않는다.

## Comments

- 등록 시점 분류: 코드 읽기로만 확인한 시험 도구 중복이고 거짓 결과를 관찰하지 않았으므로 `docs/agents/issue-tracker.md` "등록·분류 기준"의 `deferred`.
