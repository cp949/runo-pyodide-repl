# 02 `sigint-handler-idle.test.ts`의 시험 2건이 전체 스위트 병렬 실행에서 가끔 실패한다

Status: done

## 현상

RD-013 DELTA-03 검증 중(2026-09-23) `pnpm test`(루트, 전체 스위트) 반복 실행에서
`packages/pyodide-repl/src/worker/sigint-handler-idle.test.ts`의 시험이 회차마다 다른 것 1건씩 실패했다.

- 1차: `정지한 run_sync 루프의 콜백이 소비한 SIGINT도 루프를 끊는다` — `screen.stderr`에 예상 밖
  `Exception in callback _set_result_unless_cancelled() at .../asyncio/futures.py:319` +
  `asyncio.exceptions.InvalidStateError: invalid state` 노이즈가 섞여 기대 트레이스백과 달랐다.
- 2차: 다른 시험 1건이 `screen.stderr`의 `KeyboardInterrupt\n$` 매치에서 실패(`pressed count 1` 관련 단언).

같은 시험을 단독으로 돌리면(`vitest run sigint-handler-idle -t "..."`) 항상 통과하고, 전체 스위트를
바로 재실행해도 대부분 통과한다(재현율은 낮음, 1~2회 반복에 한 번꼴로 추정).

## 왜 지금은 크게 안 보이나

간헐적이라 개별 PR 검증에서는 대체로 통과하고 넘어간다. `_works/20260923-14-rd-013-auto-indent/pending-issues/01.md`에서
처음 관찰했다.

## 판단 근거

RD-013(자동 들여쓰기) 범위와 무관한 파일이라 그 RD에서는 다루지 않고 여기 등록만 한다. 타이밍 경계 근처의
비동기 폴링/타이머 시험으로 추정되나 근본 원인은 미조사. 다음에 `sigint-handler-idle.test.ts`를 만지거나
반복 재현되면 원인을 좁힌다(전체 스위트 병렬 실행에서만 나는 것으로 보아 리소스 경합·타이밍 문턱 후보).

## Comments

- (2026-09-23, RD-017 DELTA-02 리뷰) 위 "판단 근거"의 전제가 틀렸다는 것을 실측으로 확인했다: **단독
  실행이 오히려 더 자주 실패한다**(단독 5회 중 4회 실패 vs 전체 스위트 3회 중 1회 실패) — "전체 스위트
  병렬 실행에서만 나는 리소스 경합"이 아니다. 오류 문구는 `asyncio.exceptions.InvalidStateError: invalid
  state`로, 타이밍 문턱보다 Pyodide asyncio 내부 경쟁 조건으로 보인다. RD-017 변경(커밋 `79ccdb0` 이전
  코드에서도 재현)과는 무관 — RD-017 범위 밖이라 이 라운드에서 고치지 않는다. 다음에 이 파일을 만질 때는
  "전체 스위트에서만" 가설을 버리고 단독 실행 반복(N≥5)으로 재현율부터 다시 잰다.

## 해결

2026-09-24. 실패 유형 중 `InvalidStateError` 노이즈는 근본 원인 2개(A·B)를 결정적 재현으로 특정해 제품 코드
`packages/pyodide-repl/src/worker/sigint-handler.py`에서 고쳤다. `KeyboardInterrupt\n$` 불일치 유형은 재현하지 못해 미판정으로
남기고 [03](./03-keyboardinterrupt-end-anchor-mismatch-unreproduced.md)으로 넘겼다.

### 제목·"판단 근거"의 전제 정정

제목의 "전체 스위트 병렬 실행에서"는 틀렸다. 실패는 한 시험(`SIGINT 핸들러 보완(타이머 없음)` > `정지한 run_sync 루프의
콜백이 소비한 SIGINT도 루프를 끊는다`) 안에서 닫힌 경합이고, 단독 실행에서도 난다. 앞 시험의 타이머 잔류·해체 콜백·실시간
부하(리소스 경합) 가설은 모두 기각했다(CPU 부하 단독 0/20, 동시 vitest 부하 단독 1/20).

### 근본 원인

- **A. 규칙 ③의 동기 취소가 `_set_result_unless_cancelled`의 검사-설정 사이에 끼어든다.** `asyncio.sleep`의 타이머 콜백
  `asyncio.futures._set_result_unless_cancelled(fut, result)`가 `if fut.cancelled(): return`을 통과한 직후 pyodide가 SIGINT를
  폴링 → 핸들러 규칙 ③(사용자 프레임 없음 + 실행 중)이 그 자리에서 `interrupt_idle()`로 대기 중인 guard Task를 취소 →
  `Task.cancel`이 기다리던 sleep future를 즉시 취소 → 콜백으로 돌아와 `fut.set_result(result)`가 `InvalidStateError: invalid
  state` → WebLoop가 `Exception in callback _set_result_unless_cancelled() …`를 stderr에 찍는다. 깨우기 자체는 성공해 기대
  트레이스백은 뒤에 그대로 온다. CPython 표준 라이브러리는 이벤트 루프 스레드 안에서만 이 검사-설정이 원자적이라고 가정한다.
  Python 신호 핸들러는 bytecode 경계에서 돌므로, 핸들러 안에서 asyncio 상태를 바꾼 우리 설계가 원인이다(Pyodide 버그 아님).
- **B. `run_sync` 래퍼의 Task 생성 전 눌림이 never-awaited 경고를 남긴다.** 래퍼의 `asyncio.ensure_future(guard(awaitable))`가
  `guard` 코루틴을 만든 뒤 Task를 만들기 전에 SIGINT가 처리되면 규칙 ①이 그 자리에서 `KeyboardInterrupt`를 올리고, `guard`·
  awaitable 코루틴이 await되지 않은 채 버려진다 → 트레이스백 생성 중 GC가 `RuntimeWarning: coroutine
  'install.<locals>.guard' was never awaited`·`coroutine 'sleep' was never awaited`를 트레이스백 앞에 찍는다. 같은 시험을 같은
  단언으로 깨는 두 번째 원인이다(자연 발생은 드묾: 계측 1/40, 위상 스윕 2/180).

### 자연 재현율은 SIGINT 폴링 위상이 정한다

- SIGINT가 처리되는 bytecode 위치는 눌림 시각보다 그때까지 실행한 eval breaker 확인 횟수의 위상으로 정해진다. 무관한
  변경으로 위상이 옮겨 재현율이 크게 바뀐다(`docs/traps/TRP-030-natural-repro-zero-under-sigint-polling-phase.md`).
- 실측(수정 전 제품 코드): 현재 시험 조립 단독 **0/30**, 전체 스위트 0/6. 이슈 01 수정 전 조립(`restoreRunSync` 위치만 다름)
  단독 **20/30**(20건 모두 `InvalidStateError`). 눌림 전 `for _ in range(k): pass`로 위상을 옮기면 k=10 0/20, k=34 **8/20~9/20**.
- 즉 이슈 01 수정 뒤 "안 보이게 된" 것은 수정이 아니라 위상 우연이었다. 판별은 결정적 주입 시험이 맡는다.

### 수정 요지

- A: 핸들러 규칙 ③은 이제 그 자리에서 취소하지 않고 `active.get_loop().call_soon(interrupt_deferred, active)`로 한 틱 미룬다.
  미룬 콜백은 그 사이 실행이 바뀌었으면 버리고, 아니면 기존처럼 `interrupt_idle()` → 깨울 것이 없으면 `pending = True`.
  핸들러 시점에 이미 깨운 대기(`woken`)가 있으면 미루지 않고 `pending = True`만 세운다(미룬 콜백이 그 대기의
  `KeyboardInterrupt` 전달 뒤에 돌아 한 번 더 만드는 것을 막는다). WebLoop `call_soon`은 JS 예약만 해 신호 문맥에서 안전하다.
  Ctrl+C 반영은 핸들러 경로에서 한 매크로태스크 늦다(감시 타이머 경로는 그대로 동기).
- B: 래퍼가 `ensure_future`에서 예외로 나오면, 그 `guard` 코루틴을 소유한 Task가 없을 때만 `guard`를 `close()`하고,
  awaitable이 시작 전(`CORO_CREATED`) 코루틴이면 그것도 `close()`한 뒤 예외를 다시 올린다. Task가 이미 만들어졌으면 그 Task가
  `guard`를 돌리므로 닫지 않는다(닫으면 `RuntimeError: cannot reuse already awaited coroutine`).
- 사용자 관찰 동작(출력 문구·트레이스백·프롬프트·Ctrl+C 의미) 변화 없음: 사양 밖 노이즈만 사라진다. 기존 시험 기대값 불변.
- 설계 문서 `docs/design/03-ctrl-c.md` 2.4·2.5, `packages/pyodide-repl/CONTEXT.md` "깨우기" 갱신.

### 검증

- 결정적 주입 시험을 `sigint-handler-idle.test.ts`의 `asyncio 콜백 경합 지점에서 처리된 SIGINT(주입)` 묶음에 남겼다.
  - RED-A `sleep 타이머 콜백의 검사 통과 직후 처리된 SIGINT도 표준 트레이스백만 남긴다`: 수정 전 5/5 실패
    (`InvalidStateError` 노이즈) → 통과.
  - RED-B `run_sync 래퍼가 Task를 만들기 전에 처리된 SIGINT도 never awaited 경고 없이 표준 트레이스백만 남긴다`: 수정 전 5/5
    실패(never-awaited 경고) → 통과.
  - `감시 타이머가 깨운 대기의 취소 처리 중 소비된 SIGINT는 KeyboardInterrupt를 한 번 더 만들지 않는다`: `woken` 검사를 뺀
    변이에서 3/3 실패(`expected 2 to be 1`).
- 양성 대조: 제품 코드 수정만 되돌리면 RED-A 5/5, RED-B 5/5 실패. B의 소유 검사를 빼면 기존 시험 `래퍼가 부른 라이브러리
  프레임에서 올라온 KeyboardInterrupt도 우리 프레임 없이 보인다`가 실패한다(기존 시험이 그 분기를 지킨다).
- 반복: 시험 파일 단독 20/20 통과, 위상 k=34 N=20 20/20(수정 전 8/20 실패), 위상 스윕 k=0..59 ×3 180/180, 전체 스위트
  (`pnpm exec turbo run test --force --ui=stream`) 5/5 통과. `pnpm check-types`·`pnpm lint` 통과.
- 브라우저(`apps/demo/e2e/`): `ctrl-c-check` 10/10, `prompt-cancel-check` 23/23, `input-cancel-check` 26/26, `tla-check` 16/16,
  `sleep-await-check` 형식 320/320 — `BASELINE.md` 확인 수와 일치. `sleep-await-check` 일부 셀 중앙값의 30ms 초과는 수정 전
  코드에서도 나 환경 편차로 수용했다(사용자 확정, [e2e-baseline-drift/02](../../e2e-baseline-drift/issues/02-sleep-await-median-over-30ms-reference.md)).
  `burst-matrix` b5·b20·b50·c 셀 실패도 수정 전 코드와 같아 범위 밖으로 등록했다
  ([e2e-baseline-drift/01](../../e2e-baseline-drift/issues/01-burst-matrix-cells-fail-against-baseline.md)).

### 남김

- `KeyboardInterrupt\n$` 불일치 유형: 시험 파일 실행 106회·진단 시험 308건에서 0회라 원인 미판정.
  A·B는 노이즈를 트레이스백 앞에 찍어 이 단언을 깨지 않으므로 별개 원인으로 본다 → [03](./03-keyboardinterrupt-end-anchor-mismatch-unreproduced.md).
- 판별 시험 없는 방어: 미룬 콜백의 "실행이 바뀌었으면 버림" 검사, Task 생성 도중(`Task.__init__` 안) 끊긴 경우의 소유 판정.
- 중첩 `run_sync` 대기가 여럿이고 하나만 깨운 상태에서 온 눌림은 다른 대기를 깨우지 않는다(수정 전 동기 코드는 깨웠다).
  판별 시험 없음.

- 2026-09-24 같은 시험(`정지한 run_sync 루프의 콜백이 소비한 SIGINT도 루프를 끊는다`)이 다른 모양(`<frozen abc>` `__subclasscheck__` 안 `KeyboardInterrupt` + `pyodide.ffi.ConversionError`)으로 1회 실패했다. 이 이슈의 원인 A·B와 모양이 달라 재개하지 않고 [05](./05-sigint-idle-subclasscheck-conversion-error-flake.md)(`deferred`)로 따로 등록했다.
