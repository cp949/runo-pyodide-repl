# REPL `spawnSession`과 core `createRunner`가 세션·송신기 배선을 각자 구현한다

Status: deferred
Origin: RD-022 확정 10(REPL `spawnSession`은 건드리지 않는다). 내부 중복 기록.

## 현상

`packages/pyodide-repl/src/index.ts`의 `spawnSession`·`reset()`(interrupt buffer·송신기 생성, `startCoreSession` 호출, 리셋 순서, 재생성)과 `packages/pyodide-core/src/session/runner.ts`의 `spawn()`·`restart()`가 같은 배선을 따로 구현한다. 동작이 갈라져 있다: runner는 세션마다 새 interrupt buffer를 쓰고(`docs/design/14-runner.md` 14.3.5) REPL은 재사용한다(`01-repl-reset-reuses-interrupt-buffer.md`). 결함이 아니라 중복이고, 한쪽 수정이 다른 쪽에 자동으로 전파되지 않는다.

## 완료 기준

공통 부분(buffer·송신기 생성, 세션 교체 순서: 옛 세션 종료 → 새 세션 시작)을 core 도우미로 뽑아 REPL과 runner가 공유한다. REPL 공개 export 이름 diff 0, `e2e:session-reset` 25/25·REPL 단위 시험 통과.

## 재개 조건

`01-repl-reset-reuses-interrupt-buffer.md`를 착수할 때(같은 배선을 두 곳에서 고치게 되므로 추출 여부를 그때 판단한다), 또는 세 번째 소비자(RD-024 React·RD-023)가 세션 배선을 다시 구현하려 할 때. 그 전에는 조사하지 않는다.

## Comments

- 2026-09-24 등록 시점 분류: 제품 결함이 아닌 리팩터링 후보라 재현 시나리오가 없어 `open` 조건을 충족하지 못한다. 기록만 남기는 `deferred`.
