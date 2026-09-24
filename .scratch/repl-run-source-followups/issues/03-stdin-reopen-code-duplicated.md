# stdin 재개 코드가 core `run-driver.py`와 REPL `run-source.ts`에 두 벌이다

Status: deferred
Origin: RD-022a 마무리. 내부 중복 기록.

## 현상

`exit()`가 닫은 `sys.stdin`을 되살리는 Python 6줄(repl `worker/run-source.ts`의 `REOPEN_CLOSED_STDIN`)이 core `run-driver.py`의 `_reset_stdin()`과 같은 모양(fd 0·`<stdin>`·라인 버퍼·`errors="strict"`)을 복사했다. 한쪽만 바꾸면 runner와 REPL의 `input()` 동작이 조용히 갈라진다(`docs/traps/TRP-054`).

## 완료 기준

재개 코드가 한 곳(core)에 있고 runner와 REPL이 함께 쓴다. 방법 후보: core `./worker`가 조건부 재설정 함수(닫혀 있을 때만 여는 `reopen_stdin_if_closed`)를 export하거나 `exec_in_console`의 `SystemExit` 분기에서 부른다. 후자는 `exec_in_console`이 stdin을 건드리지 않는다는 계약(core `run-driver-exec-in-console.test.ts`)을 바꾸므로 계약과 시험을 함께 다시 정한다. `runSource` 시험(`exit()` 뒤 `input()`)과 runner 시험이 통과한다.

## 재개 조건

core `_reset_stdin()`을 바꿀 때, 또는 세 번째 소비자(RD-024 React 래퍼가 직접 실행 경로를 만드는 경우)가 같은 재개가 필요할 때.

## Comments

- 2026-09-24 등록 시점 분류: 중복이지만 두 곳이 어긋난 사례가 없다. `deferred`.
