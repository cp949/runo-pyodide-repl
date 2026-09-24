# `run-source.test.ts`가 `index.test.ts`의 가짜 worker·세션 하니스와 벤더 `VTerm`을 복제했다

Status: deferred
Origin: RD-022a 마무리. 시험 구조 기록.

## 현상

repl `src/run-source.test.ts`는 `index.test.ts`(2100줄)에 더하지 않고 새 파일로 나누면서 `createFakeWorker`·세션 시작 도우미·`observe`·`waitFor`를 다시 썼다. 화면 행을 해석하는 `src/test/vt-screen.ts`는 벤더 `packages/xterm-readline/src/vterm.ts`의 축소 복제다(패키지 경계 때문에 벤더 시험 도구를 가져올 수 없다). 한쪽 하니스가 바뀌어도 다른 쪽이 따라가지 않는다.

## 완료 기준

공용 하니스가 한 곳(예: repl `src/test/harness.ts`)에 있거나 화면 모델이 `@repo/pyodide-testkit`(`fake-terminal`)에 합쳐져 두 시험 파일이 함께 쓴다. 두 파일의 시험 제목은 그대로이고 통과한다.

## 재개 조건

세 번째 시험 파일이 같은 가짜 worker·화면 모델을 필요로 할 때, 또는 복제 하니스 사이의 불일치로 시험이 거짓 통과·거짓 실패한 것이 실측될 때.

## Comments

- 2026-09-24 등록 시점 분류: 코드 읽기로만 확인한 중복이고 거짓 결과를 관찰하지 않았다. `deferred`(`docs/agents/issue-tracker.md` "코드 읽기로만 추정한 테스트 도구 문제").
