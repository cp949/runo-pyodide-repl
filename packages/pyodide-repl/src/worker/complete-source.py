import warnings

# pyodide 내부에서 쓰는 이름(모듈·인스턴스 변수)이 후보에 섞여 나오는 것을 막는다. RD-016(모듈 완성)이 늘릴 수 있다.
INTERNAL_PREFIXES = ('_pyodide', '___')


def complete_source(console, source, pending=None):
    """`console.complete(source)`를 후처리해 정렬된 후보 목록과 `start`를 돌려준다.

    pending은 RD-016(모듈 완성, `import`/`from` 줄)이 쓴다. 이 RD는 인자로 받기만 하고 쓰지 않는다.
    `console.complete`가 내부적으로 `getattr`/`dir`을 부르므로 사용자 정의 `__getattr__`/`__dir__`이 임의
    예외를 던질 수 있다 — `except Exception`으로 삼키고 빈 결과를 돌려준다. `KeyboardInterrupt`는
    `Exception`이 아니라 `BaseException`이라 여기서 잡히지 않고 그대로 전파된다(호출부가 `PythonError`로 받는다).
    """
    try:
        with warnings.catch_warnings():
            # 속성 접근이 DeprecationWarning 등을 낼 수 있다. 완성 계산 중에는 경고를 stderr로 흘리지 않는다.
            warnings.simplefilter('ignore')
            completions, start = console.complete(source)
    except Exception:
        return [], 0
    return sorted(c for c in completions if not c.startswith(INTERNAL_PREFIXES)), start
