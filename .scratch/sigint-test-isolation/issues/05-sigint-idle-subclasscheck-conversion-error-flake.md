# 05 `sigint-handler-idle.test.ts`의 `정지한 run_sync 루프의 콜백이 소비한 SIGINT도 루프를 끊는다`가 `__subclasscheck__` 안 SIGINT + `ConversionError` 모양으로 1회 실패했다

Status: open
Origin: RD-022b L0(2026-09-24). 1회 관찰, 원인 미조사.

## 현상

루트 `pnpm test --force --concurrency=1` 1회차에 `packages/pyodide-repl/src/worker/sigint-handler-idle.test.ts` > `SIGINT 핸들러 보완(타이머 없음)` > `정지한 run_sync 루프의 콜백이 소비한 SIGINT도 루프를 끊는다`가 실패했다. 기대 `File "<console>", line 1` + `KeyboardInterrupt` 대신 stderr가 다음 모양이었다:

- `File "<frozen abc>", line 123, in __subclasscheck__` → `File "<sigint-handler>", line 136, in sigint_handler` → `KeyboardInterrupt`(두 번)
- 이어 `The above exception was the direct cause of the following exception:` + `pyodide.ffi.ConversionError: Conversion from python to javascript failed`

SIGINT가 JS 변환 중의 `isinstance` 검사(`abc.__subclasscheck__`) 안에서 처리된 모양이다(추정, 미검증). [02](./02-sigint-handler-idle-flaky-under-full-suite.md)의 원인 A(`InvalidStateError` 노이즈)·B(never-awaited 경고)와 모양이 다르고, [03](./03-keyboardinterrupt-end-anchor-mismatch-unreproduced.md)의 `/KeyboardInterrupt\n$/` 불일치와도 단언이 다르다.

같은 파일 단독 실행 43/43 통과, 이어 전체 2회차 15/15 태스크 통과. 실패 당시 변경은 main 쪽 `source-bridge.ts`·주석·jsdom 시험뿐이고 worker·SIGINT 경로는 건드리지 않았다.

## 로그

- 실패: `_works/_completed/20260924-28-rd-022b-bg-output-above-read/verify/l0-delta03-root-test.log`(stderr 원문 포함)
- 단독 통과: `_works/_completed/20260924-28-rd-022b-bg-output-above-read/verify/l0-delta03-sigint-idle-solo.log`
- 전체 2회차 통과: `_works/_completed/20260924-28-rd-022b-bg-output-above-read/verify/l0-delta03-root-test-run2.log`

## 재개 조건

같은 모양(`__subclasscheck__` 안 SIGINT 또는 `ConversionError`)이 다시 관찰되거나, 이 파일 단독 N=10에서 1회 이상 재현되면 `open`으로 바꾸고 원시 stderr를 보존한다. 그 전에는 원인을 조사하지 않는다(`docs/agents/issue-tracker.md` "등록·분류 기준"). SIGINT 처리 위치는 폴링 위상에 좌우되므로(`docs/traps/TRP-030-natural-repro-zero-under-sigint-polling-phase.md`) 재현하려면 02의 결정적 주입 방식(해당 지점에 SIGINT 주입)을 먼저 검토한다.

## Comments

- 2026-09-24 등록 시점 분류: 1회 관찰·원인 불명 간헐 실패 → `deferred`.
- 2026-09-25 재분류(`deferred` → `open`): 재개 조건(같은 모양 재관찰)이 충족됐다. RD-023 DELTA-01 루트 `pnpm test --force`(기본 병렬도) 1회차에서 같은 시험이 같은 모양으로 실패했다: stderr에 `File "<frozen abc>", line 123, in __subclasscheck__` → `File "<sigint-handler>", line 136, in sigint_handler` → `KeyboardInterrupt`(두 번) + `The above exception was the direct cause…` + `pyodide.ffi.ConversionError: Conversion from python to javascript failed`(원시 로그 `_works/_completed/20260925-32-rd-023-dom-bridge/verify/delta01-l0-pnpm-test---force.log` 625~650행 부근, 병합 뒤 이동 예정 경로). 같은 실행에서 같은 파일 밖의 `sigint-handler-sleep-slice`(04 참고)·`sigint-handler`(06) 시험도 실패했다. 이 브랜치는 `packages/pyodide-repl`을 바꾸지 않았다(변경 전 커밋의 같은 명령은 sleep-slice 2건만 실패했고 이 모양은 나오지 않았다). 원인 조사는 하지 않았고 재현 방법(02의 결정적 주입 방식 검토)은 이 이슈의 "재개 조건" 절을 따른다.
