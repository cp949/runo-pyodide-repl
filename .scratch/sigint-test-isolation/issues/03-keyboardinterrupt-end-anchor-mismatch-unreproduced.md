# 03 `sigint-handler-idle.test.ts`의 `/KeyboardInterrupt\n$/` 불일치 실패가 미재현·원인 미상이다

Status: deferred

## 현상

이슈 02 본문의 둘째 실패 유형이다(2026-09-23, 루트 `pnpm test` 반복 중 1회). `packages/pyodide-repl/src/worker/sigint-handler-idle.test.ts`의
한 시험이 `expect(runner.screen.stderr).toMatch(/KeyboardInterrupt\n$/)`에서 실패했다(`pressed count 1` 관련 단언으로
기록됨). 원시 stderr는 남아 있지 않다.

## 왜 지금 안 보이나

- 2026-09-23~24 측정에서 한 번도 나오지 않았다: 시험 파일 실행 106회(단독 30, 전체 스위트 6, 이슈 01 수정 전 조립 단독 30,
  CPU 부하 단독 20, 동시 vitest 부하 단독 20)와 진단 시험 308건. 이슈 02를 닫은 수정 뒤에도 단독 20회·전체 스위트 5회에서
  0회.
- 이슈 02에서 고친 두 원인(`InvalidStateError` 노이즈, `coroutine ... was never awaited` 경고)은 노이즈를 트레이스백
  **앞**에 찍고 stderr가 `KeyboardInterrupt\n`로 끝난다(결정적 재현의 stderr 원문 확인). 이 단언을 깨지 않으므로 별개 원인으로
  본다.
- SIGINT가 처리되는 bytecode 위치는 폴링 위상에 좌우돼(`docs/traps/TRP-030-natural-repro-zero-under-sigint-polling-phase.md`)
  무관한 변경으로 재현율이 0이 될 수 있다. "지금 안 난다"는 "고쳐졌다"가 아니다.

## 후보(미검증)

`/KeyboardInterrupt\n$/`를 쓰는 presser·눌림 시험:

- `정지한 대기 중 Ctrl+C` > `중첩 호출 안의 run_sync 대기도 사용자 프레임까지만 보인다`
- `설치 가드`의 `expectStillInterruptible`(바쁜 루프 `press()` + `started(); time.sleep(5)` presser) — `it.each` 2건
- `run_sync 계열 대기에서 코루틴이 낸 예외` > `except 안에서 눌린 time.sleep도 컨텍스트 연쇄 문구가 한 번만 찍힌다`

의심 기전: 잔류 타이머·콜백의 예외 로그(`Exception in callback …`, `Task exception was never retrieved` 등)가 트레이스백
**뒤**에 붙는 경우.

## 판단 근거

원인을 좁힐 증거(stderr 원문)가 없어 지금 고칠 수 없다. 재발하면 할 일:

1. 실패 회차의 vitest 출력에서 stderr 원문(diff 전체)을 보존한다.
2. 끝에 붙은 줄의 출처(파일·행)로 기전을 특정하고, 그 지점에 `press(); signal.raise_signal(signal.SIGINT)`를 주입하는
   결정적 시험으로 RED를 만든다(이슈 02의 방식).

## 참고(별개 현상)

이슈 01 `## 해결`에 기록된 `sigint-handler.test.ts:368`(`"20\n"` 기대, `"19\n"` 수신) 간헐 실패는 다른 파일의 현상이다.
이슈 02 작업의 전체 스위트 12회(수정 전 6, 원인 A만 고친 뒤 1, 최종 코드 5)에서는 나오지 않았다. 재발하면 이 폴더에 별도 이슈로 등록한다.

## Comments

- 2026-09-24 재분류: `deferred`(`docs/agents/issue-tracker.md` "등록·분류 기준"). 1회 관찰, 106회 반복에서 재현 0, 원시 stderr 없음. 재개 조건: `pnpm test`에서 같은 단언 실패가 다시 관찰되면 원시 stderr를 보존하고 `open`.
- 2026-09-25 이슈 05 해결 결과(분류는 `deferred` 유지): 05의 `ConversionError` 모양은 stderr가 `ConversionError …\n`으로 끝나 `/KeyboardInterrupt\n$/`도 깨므로 이 이슈의 공통 원인 후보다. 다만 이 이슈의 원시 stderr가 없어 같은 모양인지 확인할 수 없어 근거가 부족하다. 재발하면 원시 stderr에 `ConversionError`·`__subclasscheck__`가 있는지 먼저 본다. 05는 [05](./05-sigint-idle-subclasscheck-conversion-error-flake.md) `## 해결` 참고.
