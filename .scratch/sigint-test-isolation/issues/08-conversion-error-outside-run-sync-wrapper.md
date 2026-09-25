# 08 `run_sync` 래퍼 밖의 Python→JS 변환 중 처리된 SIGINT가 `ConversionError`로 샐 수 있다(미시험)

Status: deferred
Origin: 이슈 [05](./05-sigint-idle-subclasscheck-conversion-error-flake.md) 수정(2026-09-25)의 범위 제외 항목. 코드 읽기로만 추정했고 이 창에서 실패를 관찰한 적이 없다.

## 현상(추정)

05는 `run_sync` 래퍼가 부른 C `run_sync`의 변환 구간만 고쳤다(`packages/pyodide-core/src/worker/sigint-handler.py`의 `converting` + `run_sync.__code__` 프레임 감지). 같은 변환 경로(`python2js` → `pyproxy_new_ex` → `pyproxy_getflags` → `type_getflags`, pyodide 314.0.7)는 래퍼 밖에서도 불린다.

- `src/core/jsproxy.c:792`·`:1270`(`python2js_track_proxies`, JS 함수 호출 인자 변환)·`:1858`(`python2js(arg)`) 등. `js.fn(py_obj)`처럼 사용자 코드가 JS를 부르는 지점과 콘솔 쪽 변환(`ConsoleFuture` 등)이다.
- `type_getflags`는 `dict`·`tuple`·`list` 정확 타입 외에 캐시가 없어(`src/core/pyproxy.c:1576-1578`) 그 밖의 타입은 매번 `PyObject_IsSubclass(…, Generator)`·`AsyncGenerator`(`:215-218`)로 `ABCMeta.__subclasscheck__` Python 프레임을 연다.

그 프레임에서 SIGINT가 처리되고 사슬에 `<console>` 프레임이 있으면 규칙 ①이 `KeyboardInterrupt`를 올리고, C 변환이 `ConversionError`(`__cause__` = `KeyboardInterrupt`)로 감싸며 `PyErr_Print()`가 excepthook 출력을 콘솔 `sys.stderr`로 흘릴 수 있다(05와 같은 모양). 사용자 `except KeyboardInterrupt:`도 비켜 간다. 이번 수정은 래퍼 프레임 감지에 기대므로 이 지점에는 적용되지 않는다. 래퍼 프레임보다 안쪽에 사용자 프레임이 있는 경우(사용자 ABC의 `__subclasshook__` 등)도 시험하지 않았다.

`packages/pyodide-repl/src/worker/submission-runner.ts`의 안전망(`isKeyboardInterrupt`)은 사용자 코드 밖에서 새는 예외용이라 `runcode` 안의 이 모양에는 해당하지 않는다(`docs/design/02-console-core.md` 5.2).

## 재개 조건

다음 중 하나가 충족되면 `open`으로 바꾸고 `## Comments`에 근거(로그 경로·수치)를 남긴다(`docs/agents/issue-tracker.md` "등록·분류 기준").

1. `run_sync` 래퍼 밖 지점에서 `ConversionError`(cause `KeyboardInterrupt`) 또는 stderr의 `__subclasscheck__` 프레임이 실제로 관찰된다(원시 stderr 보존).
2. 해당 지점(예: `js.fn(py_obj)`)에 `abc.ABCMeta.__subclasscheck__` 교체 주입을 넣는 결정적 시험이 RED로 재현되고, 그 지점을 부르는 재현 가능한 사용자 시나리오가 있다. 주입 방식은 05의 시험(`sigint-handler-idle.test.ts` describe `asyncio 콜백 경합 지점에서 처리된 SIGINT(주입)`)을 따른다. 조건에는 `is` 비교만 쓴다(ABC를 `isinstance`·`issubclass`로 검사하면 재귀한다).

그 전에는 조사하지 않는다. SIGINT 처리 위치는 폴링 위상에 좌우되므로 자연 반복 재현은 판별력이 없다(`docs/traps/TRP-030-natural-repro-zero-under-sigint-polling-phase.md`).

## Comments

- 2026-09-25 등록: 코드 읽기로만 추정한 문제 → `deferred`.
