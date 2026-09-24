# `reset()` 중 worker 생성이 실패하면 REPL 상태가 옛 값으로 남는다

Status: deferred
Origin: RD-022a 사후 리뷰(2026-09-24). 결과 promise 유실은 이번에 고쳤고 남은 상태 문제만 기록한다.

## 현상

`reset()`에서 새 `createWorker()`가 던지면(잘못된 URL, SecurityError) `reset()`은 그 예외를 호출자에게 던진다(RD-010부터의 동작). 이번 수정으로 실행 중이던 `runSource`는 `finally`에서 `restarted`로 끝난다(`packages/pyodide-repl/src/index.ts`, 시험 "reset() 중 새 worker 생성이 던져도 실행 중이던 runSource는 restarted로 끝난다"). 그러나:

- `ReplStatus`는 옛 값(`ready`)으로 남고 `onStatus`가 불리지 않는다.
- 핸들의 `session`은 terminate된 옛 세션을 가리켜 `runSource`는 계속 `busy`, `busy` 게터는 `true`다.
- 복구는 다시 `reset()`이다.

core `createRunner.reset()`은 같은 상황에서 던지지 않고 `crashed` + `onCrash`로 넘긴다(`packages/pyodide-core/src/session/runner.ts` `restart()`).

## 결정 필요

runner처럼 `crashed` + `onCrash`로 바꿀지. 바꾸면 `reset()`이 던지지 않게 되어(계약 변경) 소비자가 `onCrash`에서 동기로 `reset()`을 부르면 생성이 계속 실패할 때 재귀한다 — 데모 크래시 재시작 경로 확인 필요.

## 완료 기준

선택한 계약이 `08-session.md` 8.1과 `ReplHandle.reset` 주석에 있고, 생성 실패 뒤 `status`·`busy`·`runSource` 거부 사유를 고정하는 jsdom 시험이 있다.
