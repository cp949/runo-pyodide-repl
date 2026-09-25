# 05 `sigint-handler-idle.test.ts`의 `정지한 run_sync 루프의 콜백이 소비한 SIGINT도 루프를 끊는다`가 `__subclasscheck__` 안 SIGINT + `ConversionError` 모양으로 1회 실패했다

Status: done
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
- 2026-09-25 `done`: 결정적 주입으로 재현하고 `sigint-handler.py`에서 고쳤다(아래 `## 해결`). 이 창이 `run_sync` 래퍼 밖 변환 지점에도 있을 수 있다는 추정은 [08](./08-conversion-error-outside-run-sync-wrapper.md)로 넘겼다.

## 해결

2026-09-25. 제품 결함이다. `run_sync` 래퍼가 C `run_sync`를 부르는 동안 JS 변환 중의 Python 프레임(`ABCMeta.__subclasscheck__`)에서 처리된 SIGINT를 핸들러가 규칙 ①로 `KeyboardInterrupt`로 올려, C 변환이 이를 `ConversionError`로 감싸고 excepthook 출력이 콘솔 `sys.stderr`로 샜다. 변환 구간에서는 규칙 ①을 미루고 규칙 ③의 미룬 깨우기로 보내도록 `packages/pyodide-core/src/worker/sigint-handler.py`를 고쳤다.

### 원인(pyodide 314.0.7 태그 `b1e4fcc2488962f6360a97f19b9982d6fdb5d16f`의 `src/core/`와 대조)

1. 래퍼 `original_run_sync(fut)` → C `run_sync`가 `asyncio.ensure_future` 뒤 `python2js(ensured_future)`를 부른다(`jsproxy.c:4569-4572`).
2. `python2js`(`python2js.c:621-624`) → `python2js_inner`(`:574-598`) → `pyproxy_new_ex`(`:594`, `pyproxy.c:1317-1326`) → JS `pyproxy_new`(`pyproxy.ts:196-228`) → C `pyproxy_getflags`(`pyproxy.c:269-322`) → `type_getflags`(`pyproxy.c:167-259`). 정확 타입 `dict`·`tuple`·`list`만 캐시가 있고(`:1576-1578`) Task 타입은 매번 검사한다.
3. `type_getflags`가 `PyObject_IsSubclass(obj_type, Generator)`·`AsyncGenerator`(`pyproxy.c:215-218`)를 부르고, 이것이 `ABCMeta.__subclasscheck__` Python 프레임을 연다. SIGINT가 여기서 처리되면 사슬 위쪽에 `<console>` 프레임이 있어 규칙 ①(`sigint-handler.py`의 사슬 순회)이 `KeyboardInterrupt`를 올린다.
4. 변환 실패는 `python2js_inner`(`python2js.c:579-582`)의 `_PyErr_FormatFromCause(conversion_error, "Conversion from python to javascript failed")`로 `ConversionError`(`__cause__` = `KeyboardInterrupt`)가 된다. `_pythonexc2js()` → `wrap_exception_inner`(`error_handling.c:151-197`)의 `PyErr_Print()`(`:163-179`)가 `sys.excepthook` 출력을 콘솔 `sys.stderr`로 흘린다(`capture_stderr()`는 fd 2만 잡는다). 이것이 관찰된 stderr의 첫 블록이다(프레임 구조와 코드 읽기로 추론했고 `PyErr_Print` 시점의 `sys.stderr`를 직접 관측하지는 않았다).
5. 관찰된 두 로그(rd-022b `l0-delta03-root-test.log`, rd-023 `delta01-l0-pnpm-test---force.log`)의 stderr와 주입 시험의 stderr는 `File "<test>", line 11, in _sc_pressing` 한 줄을 `File "<frozen abc>", line 123, in __subclasscheck__`로 치환하면 글자까지 같다(`delta01-shape-judge.log` `판정: 일치`).

### 수정

`sigint-handler.py`에 `converting`·`run_sync_code`를 두었다. 래퍼가 `original_run_sync(fut)`를 부르는 동안 `converting`을 참으로 두고 `finally`에서 내린다. 핸들러의 사슬 순회에서 `converting`이 참이고 `f.f_code is run_sync_code`인 프레임을 `<console>` 프레임보다 먼저(안쪽에서) 만나면 순회를 멈추고 규칙 ③(`call_soon(interrupt_deferred, active)`)으로 보낸다. 대기 Task가 취소되고 래퍼가 `WOKEN`을 보고 사용자 스택에서 표준 `KeyboardInterrupt`를 올린다. 규칙 ①·③의 의미와 기존 시험 기대값은 바꾸지 않았다. 문서는 `docs/design/03-ctrl-c.md` 2.4 "깨우기 세부"의 `run_sync` 래퍼 항목, `docs/design/02-console-core.md` 5.2에 반영했다.

방식 B(래퍼에서 `ConversionError`를 풀어 `KeyboardInterrupt`로 바꿈)는 택하지 않았다. 블록1이 이미 콘솔 `sys.stderr`에 써진 뒤라 지울 수 없고, 막으려면 대기 시간이 든 구간의 excepthook·stderr를 임시로 바꿔야 해 다른 출력을 삼킬 수 있다.

### 검증(로그는 `_works/_completed/20260925-33-sigint-05-conversion-error/verify/`)

- 결정적 주입 시험: `abc.ABCMeta.__subclasscheck__`를 `<test>` 파일명 래퍼로 교체하고(조건 `cls is collections.abc.Generator and subclass is pyodide.webloop.PyodideTask`, 1회 발동) 주입 횟수 1을 단언한다. 새 시험은 `sigint-handler-idle.test.ts` describe `asyncio 콜백 경합 지점에서 처리된 SIGINT(주입)`의 4건이다(표준 트레이스백, 사용자 `except KeyboardInterrupt:` 포착, 긴 awaitable 취소, 앞선 `run_sync` 뒤 Task 생성 전 눌림).
- RED 3/3(수정 전 코드, `delta01-red-{1,2,3}.log`, 각 `Tests 2 failed`).
- GREEN: 새 4건 3/3(`delta02-green-{1,2,3}.log`, `4 passed`), 파일 전체 47/47(`delta02-green-file.log`).
- 변이 검사 6/6 killed(`mutations-delta02.log`, `mutations-delta02.json`). 첫 실행은 5/6이었다. `converting` 해제를 지운 변이가 시험 3건에 살아남아(시험마다 새 핸들러 클로저를 만들어 표시가 이월되지 않고 결말 stderr가 같아서) 4번째 시험을 더한 뒤 6/6이 됐다.
- 기존 시험: 제거된 줄 0, 기대값 변경 0(`git diff dev -- '*.test.ts'`).
- L0: `pnpm check-types`·`lint`·`build` 통과. 루트 `pnpm test --force --concurrency=1` exit 0, 21/21 task(`delta02-l0-test-after-dist-fix.log`). 처음에는 dev의 별개 `check-dist` 실패(core 소스 주석의 금지 문자열)로 중단했고 별도 `fix:` 커밋(주석 문구 2줄)으로 해소했다. 그 전 `--continue` 실행은 2443/2443이었다(`delta02-l0-test.log`). 이 실행들에서 `ConversionError`·`__subclasscheck__` 모양과 04·06·07 형제 모양의 실패는 관찰되지 않았다.
- L1(각 1회, dev 서버): `ctrl-c` 10/10, `prompt-cancel` 23/23, `input-cancel` 26/26, `tla` 16/16, `session-reset` 26/26(`delta02-l1-<이름>/`, 모두 `BASELINE.md`와 같다. `tla`·`session-reset`의 등록된 forced pageerror 1건 제외).

### 남은 한계

- 결정적 주입은 그 창에 눌림을 정확히 1회 넣는다. 자연 발생 확률과 브라우저(JSPI·실제 Worker)에서 이 창이 열리는지는 확인하지 않았다(`docs/traps/TRP-030-natural-repro-zero-under-sigint-polling-phase.md`).
- "변환 구간"은 `converting` 표시와 프레임 사슬 검사의 곱이다. C `run_sync` 호출 안의 모든 Python 프레임(변환 외에 C의 `ensure_future`)과, C가 돌려준 직후 `finally`에서 표시를 내리기 전의 짧은 창도 규칙 ①에서 빠져 미룬 깨우기로 간다. 결말은 같은 `KeyboardInterrupt`이나 한 틱 늦다. 전용 시험은 없다.
- 래퍼 프레임보다 안쪽에 사용자 프레임이 있는 경우(사용자 ABC의 `__subclasshook__` 등)는 규칙 ①이 그대로 올려 `ConversionError`로 감싸일 수 있다. 시험하지 않았다.
- `run_sync` 래퍼 밖 변환 지점은 처리하지 않았다: [08](./08-conversion-error-outside-run-sync-wrapper.md).
- 03(`/KeyboardInterrupt\n$/` 불일치)과의 공통 원인 여부는 03의 원시 stderr가 없어 판정하지 못했다(03 Comments).
