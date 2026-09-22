# - 요청 번호(`seq()`)가 마지막으로 처리한 것과 같으면 main의 재전송이다: ack도 예외도 없다. 같은 눌림이 두 번 중단되는
#   것을 막는다(TRP-025). 다르면 새 눌림이라 스택 검사·예외보다 먼저 ack한다: 아래에서 버려지는 SIGINT도 전달된 것이라
#   ack가 없으면 main이 소실로 오판해 같은 번호로 다시 쓴다(TRP-019).
# - `frame.f_back` 사슬에 `console.filename`(`<console>`)과 같은 파일명의 프레임이 하나라도 있으면 사용자 코드 실행 중이다.
#   `signal.default_int_handler`는 반드시 예외를 던져야 한다(`input()` 취소가 기대는 EINTR 경로, PEP 475).
# - 사용자 프레임이 없어도 `runcode` 안이면(= `active`가 있으면) 사용자 코드가 정지한 채 실행 중이다: `interrupt_idle()`로
#   깨운다. `asyncio.run`·`run_until_complete`·`run_sync` 대기는 JSPI로 사용자 스택이 정지하고, top-level await 대기는
#   콘솔 task가 멈춰 있어 폴링이 사용자 프레임 없는 콜백에서 일어난다(TRP-020).
# - 그 밖(트레이스백 생성 중, 다음 문장 컴파일 중, 시작 코드)에는 버린다.
# - 핸들러 프레임은 예외 트레이스백의 안쪽 끝에 붙는다. `formattraceback`이 가장 바깥의 우리 프레임부터 안쪽 전부를 자른다
#   (핸들러 실행 중에 또 눌림이 도착하면 핸들러 프레임이 겹치므로 안쪽 하나만 자르면 샌다). 바깥의 내부 프레임(`runcode`
#   등)은 원본 `formattraceback`이 `<console>` 첫 프레임부터 남긴다. 자른 자리 앞에 낀 `webloop.py` 프레임
#   (`run_until_complete`)도 함께 뗀다.
#
# - `extra_own_codes`는 다른 모듈이 심은 우리 코드 객체다(`sleep-slice.py`의 `sleep`·`poll`). 절단 규칙은 같으므로
#   `own_codes`에 합치기만 한다. 설치 순서상 조각 교체가 먼저라 여기서는 이미 만들어진 tuple을 받는다.
#
# 깨우기 세부:
#   - `run_sync` 래퍼(`pyodide.webloop.run_sync`·`pyodide.ffi.run_sync` 교체): 대기 awaitable을 `guard` 코루틴 Task로
#     감싼다. 깨울 때 그 Task를 취소해 취소 처리(`finally` 등)를 끝낸 뒤 `guard`가 `CancelledError`를 정상 값 `WOKEN`으로
#     바꾸고, 래퍼가 사용자 스택(대기 호출 지점)에서 `KeyboardInterrupt`를 올린다. Task를 취소로 끝내면 pyodide가 그
#     예외를 JS로 옮기며 `sys.excepthook`으로 트레이스백을 한 번 더 찍는다.
#   - `runcode` 래퍼(인스턴스 속성 교체): 실행 중인 콘솔 task를 `active`로 기록한다. top-level await 대기 중에는 그 task를
#     취소하고 표지 예외 `IdleInterrupt`로 끝낸다. 취소로 끝난 task는 `ConsoleFuture`의 done 콜백이 `fut.exception()`에서
#     `CancelledError`를 만나 영영 끝나지 않는다(HANG).
#   - 취소는 await 지점에서 멈춘(`CORO_SUSPENDED`) Task에만 안전하다. 깨울 수 없는 순간(대기 코루틴 실행 중, 재개 직전)에
#     핸들러가 소비한 SIGINT는 `pending`으로 표시해 두었다가 재개하는 `run_sync` 래퍼가 올린다(TRP-021).
#   - 이벤트 루프가 비어 폴링이 아예 일어나지 않는 구간은 JS 감시 타이머가 `interrupt_idle()`을 불러 같은 일을 한다.
#   - 설치 가드 3종에 걸리면 깨우기만 건너뛴다(`active`가 늘 `None`이라 `interrupt_idle()`은 언제나 거짓이고 위 규칙
#     ①②④는 그대로다).
import asyncio
import inspect
import signal

import pyodide.ffi
import pyodide.webloop as webloop


# 깨운 대기가 정상 값으로 끝났다는 표지. 사용자 awaitable이 돌려줄 수 없는 고유한 객체다.
WOKEN = object()


class Raised:
    """guard가 나르는 예외. run_sync 래퍼가 사용자 스택에서 그 객체를 다시 올린다.
    Task 결과(정상 값)로 JS 경계를 넘으므로 pyodide가 excepthook으로 트레이스백을 찍지 않는다."""

    __slots__ = ('exc',)

    def __init__(self, exc):
        self.exc = exc


class IdleInterrupt(Exception):
    """정지한 콘솔 task를 취소해 중단했다는 표지. formattraceback이 KeyboardInterrupt 한 줄로 바꾼다.
    KeyboardInterrupt를 쓰지 않는 것은 Task가 KeyboardInterrupt로 끝나면 webloop가 다시 던지기 때문이다."""


def find_problems(console):
    """정지한 실행 깨우기가 기대하는 pyodide 314.0.7 내부 형태와 다른 지점의 이름들. 비어 있으면 설치할 수 있다."""
    problems = []
    if not callable(getattr(webloop, 'run_sync', None)):
        problems.append('pyodide.webloop.run_sync')
    if not callable(getattr(pyodide.ffi, 'run_sync', None)):
        problems.append('pyodide.ffi.run_sync')
    if not inspect.iscoroutinefunction(getattr(console, 'runcode', None)):
        problems.append('console.runcode')
    return problems


def install(console, ack, seq, warn, extra_own_codes=()):
    user_filename = console.filename
    # 사용자 코드를 실행 중인 콘솔 task. runcode 래퍼가 들어갈 때 정하고 나올 때 비운다(시간 조건 없이 이것만이 "실행 중"의 정의다).
    active = None
    waiters = set()  # run_sync 래퍼가 기다리는 대기 Task
    woken = set()  # 이미 깨운 대기(중복 취소를 막고, 그 CancelledError가 우리 것임을 표시한다)
    cancelled = set()  # 이미 취소한 콘솔 task(중복 취소 방지)
    # 설치 시점의 번호는 이미 처리한 것으로 본다: 세션 리셋 뒤 버퍼를 재사용하면 이전 세션이 남긴 번호의 재전송이
    # 새 세션을 끊으면 안 된다.
    last_seq = seq()
    # 깨울 수 없는 순간에 핸들러가 소비한 SIGINT가 있다. 재개하는 run_sync 래퍼가 KeyboardInterrupt로 올리고,
    # runcode 경계에서 지운다.
    pending = False

    def wakeable(task):
        # 취소는 await 지점에서 멈춘(CORO_SUSPENDED) Task에만 안전하다. 코루틴이 실행 중(CORO_RUNNING)인 Task를 취소하면
        # `_must_cancel`만 서서 코루틴이 끝나는 순간 Task가 취소로 끝나고, 그 Task를 기다리는 쪽이 끝나지 않는다(HANG).
        # 아직 시작하지 않은(CORO_CREATED) Task를 취소하면 코루틴이 실행되지 않은 채 닫힌다.
        return not task.done() and inspect.getcoroutinestate(task.get_coro()) == inspect.CORO_SUSPENDED

    def interrupt_idle():
        """정지한 사용자 실행을 깨운다. 깨웠으면 True(부른 쪽이 SIGINT를 소비한다), 깨울 것이 없으면 False(SIGINT는 그대로 둔다)."""
        if active is None:
            return False
        woke = False
        for fut in list(waiters):
            # 깨울 수 없는 대기(실행 중, 이미 끝나 재개 직전)는 건너뛴다. 부른 쪽이 JS 감시 타이머면 SIGINT가 버퍼에
            # 남아 재개한 사용자 스택의 폴링이 받는다.
            if fut not in woken and wakeable(fut):
                woken.add(fut)
                fut.cancel()
                woke = True
        if woke:
            return True
        if active not in cancelled and wakeable(active):
            cancelled.add(active)
            active.cancel()
            return True
        return False

    def sigint_handler(signum, frame):
        nonlocal pending, last_seq
        s = seq()
        if s == last_seq:
            return
        last_seq = s
        ack()
        f = frame
        while f is not None:
            if f.f_code.co_filename == user_filename:
                signal.default_int_handler(signum, frame)
            f = f.f_back
        # 사용자 프레임이 없다. 사용자 코드가 실행 중이면(정지한 대기, await 중) 그 실행을 깨운다. 깨울 수 없는 순간이면
        # 재개하는 run_sync 래퍼가 올리도록 표시한다. 실행 중이 아니면 다음 문장 컴파일·트레이스백 생성·시작 코드 중이므로 버린다.
        if not interrupt_idle() and active is not None:
            pending = True

    own_codes = {sigint_handler.__code__, *extra_own_codes}

    problems = find_problems(console)
    if problems:
        # 깨우기 없이 규칙 ①②④만 남는다: active가 None이라 interrupt_idle()은 아무것도 하지 않는다.
        warn(
            '[sigint-handler] pyodide 내부가 기대와 달라 정지한 실행(asyncio.run·run_sync 대기, await 등)의 Ctrl+C 중단을 건너뜁니다: '
            + ', '.join(problems)
            + '. pyodide 버전이 바뀌었는지 확인하세요.'
        )
    else:
        original_run_sync = webloop.run_sync
        original_runcode = console.runcode

        async def guard(awaitable):
            try:
                return await awaitable
            except asyncio.CancelledError as exc:
                # 우리가 깨운 취소는 정상 값으로 끝낸다. 취소는 awaitable 안으로 전달돼 finally 등의 취소 처리가 끝난
                # 뒤에야 여기에 도착한다. 사용자 코드가 낸 CancelledError는 다른 예외와 같이 나른다.
                if asyncio.current_task() in woken:
                    return WOKEN
                return Raised(exc)
            except GeneratorExit:
                # 코루틴 close()의 신호다. 값으로 바꾸면 RuntimeError("coroutine ignored GeneratorExit")가 된다.
                raise
            except BaseException as exc:
                # KeyboardInterrupt(조각 폴링·바쁜 루프의 핸들러가 코루틴 프레임에서 올린 것, 사용자가 직접 올린 것)·
                # SystemExit·일반 예외 전부. 예외로 끝난 Task는 pyodide가 Promise로 바꾸며 sys.excepthook으로 한 번 더
                # 찍고 콘솔 실행 중에는 그것이 화면에 새므로(TRP-021) 값으로 나른다.
                return Raised(exc)

        def run_sync(awaitable):
            nonlocal pending
            fut = asyncio.ensure_future(guard(awaitable))
            waiters.add(fut)
            try:
                result = original_run_sync(fut)
            finally:
                waiters.discard(fut)
                woken.discard(fut)
            if isinstance(result, Raised):
                # awaitable이 낸 예외를 그 객체 그대로 올린다(from None 없음 — __context__·__cause__ 보존). pending은
                # 건드리지 않는다: 예외로 끝난 실행의 표시는 runcode 경계가 지운다.
                raise result.exc
            if result is WOKEN or pending:
                # 깨운 대기와 깨울 수 없는 순간에 소비된 SIGINT는 사용자 스택(대기 호출 지점)에서 KeyboardInterrupt로 올린다.
                pending = False
                raise KeyboardInterrupt from None
            return result

        async def runcode(source, code):
            nonlocal active, pending
            task = asyncio.current_task()
            active = task
            pending = False
            try:
                return await original_runcode(source, code)
            except asyncio.CancelledError:
                if task in cancelled:
                    # 우리가 취소한 것이면 표지 예외로 끝낸다. 취소로 끝난 task는 ConsoleFuture가 fut.exception()에서
                    # CancelledError를 만나 끝나지 않는다.
                    raise IdleInterrupt from None
                raise
            finally:
                cancelled.discard(task)
                active = None
                pending = False

        # webloop의 run_until_complete는 모듈 전역 run_sync를 부르고, 사용자는 `from pyodide.ffi import run_sync`로
        # 가져간다. 사용자 코드는 worker 시작 뒤에 실행되므로 지금 교체하면 두 경로 모두 래퍼를 가리킨다.
        webloop.run_sync = run_sync
        pyodide.ffi.run_sync = run_sync
        console.runcode = runcode
        own_codes.add(run_sync.__code__)
        own_codes.add(guard.__code__)

    format_traceback = console.formattraceback

    def formattraceback(exc):
        if isinstance(exc, IdleInterrupt):
            return 'KeyboardInterrupt\n'
        entries = []
        tb = exc.__traceback__
        while tb is not None:
            entries.append(tb)
            tb = tb.tb_next
        cut_at = next((i for i, entry in enumerate(entries) if entry.tb_frame.f_code in own_codes), None)
        if cut_at is not None:
            entries = entries[:cut_at]
            # 자른 자리 앞에 낀 pyodide webloop 프레임(`run_until_complete`)도 뗀다. runcode 래퍼는 사용자 프레임보다
            # 바깥이라 pyodide가 `<console>` 이전 프레임을 이미 걸러 준다.
            while entries and entries[-1].tb_frame.f_code.co_filename.endswith('pyodide/webloop.py'):
                entries.pop()
            if entries:
                entries[-1].tb_next = None
        return format_traceback(exc)

    console.formattraceback = formattraceback
    signal.signal(signal.SIGINT, sigint_handler)
    return interrupt_idle
