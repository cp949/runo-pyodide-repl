# - 요청 번호(`seq()`)가 마지막으로 처리한 것과 같으면 main의 재전송이다: ack도 예외도 없다. 같은 눌림이 두 번 중단되는
#   것을 막는다(TRP-025). 다르면 새 눌림이라 스택 검사·예외보다 먼저 ack한다: 아래에서 버려지는 SIGINT도 전달된 것이라
#   ack가 없으면 main이 소실로 오판해 같은 번호로 다시 쓴다(TRP-019).
# - `frame.f_back` 사슬에 `console.filename`(`<console>`)과 같은 파일명의 프레임이 하나라도 있으면 사용자 코드 실행 중이다.
#   `signal.default_int_handler`는 반드시 예외를 던져야 한다(`input()` 취소가 기대는 EINTR 경로, PEP 475).
# - 핸들러 프레임은 예외 트레이스백의 안쪽 끝에 붙는다. `formattraceback`이 가장 바깥의 우리 프레임부터 안쪽 전부를 자른다
#   (핸들러 실행 중에 또 눌림이 도착하면 핸들러 프레임이 겹치므로 안쪽 하나만 자르면 샌다). 바깥의 내부 프레임(`runcode`
#   등)은 원본 `formattraceback`이 `<console>` 첫 프레임부터 남긴다.
#
# - `extra_own_codes`는 다른 모듈이 심은 우리 코드 객체다(`sleep-slice.py`의 `sleep`·`poll`). 절단 규칙은 같으므로
#   `own_codes`에 합치기만 한다. 설치 순서상 조각 교체가 먼저라 여기서는 이미 만들어진 tuple을 받는다.
#
# RD-009 확장 지점: `install`의 인자에 `warn`, 반환값 `interrupt_idle`, 사용자 프레임이 없을 때 정지한 실행 깨우기,
# `webloop.py` 프레임 제거, `IdleInterrupt`.
import signal

def install(console, ack, seq, extra_own_codes=()):
    user_filename = console.filename
    # 설치 시점의 번호는 이미 처리한 것으로 본다: 세션 리셋 뒤 버퍼를 재사용하면 이전 세션이 남긴 번호의 재전송이
    # 새 세션을 끊으면 안 된다.
    last_seq = seq()

    def sigint_handler(signum, frame):
        nonlocal last_seq
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
        # 사용자 프레임이 없다: 다음 문장 컴파일·트레이스백 생성·시작 코드 중이므로 버린다.

    own_codes = {sigint_handler.__code__, *extra_own_codes}
    format_traceback = console.formattraceback

    def formattraceback(exc):
        entries = []
        tb = exc.__traceback__
        while tb is not None:
            entries.append(tb)
            tb = tb.tb_next
        cut_at = next((i for i, entry in enumerate(entries) if entry.tb_frame.f_code in own_codes), None)
        if cut_at is not None:
            entries = entries[:cut_at]
            if entries:
                entries[-1].tb_next = None
        return format_traceback(exc)

    console.formattraceback = formattraceback
    signal.signal(signal.SIGINT, sigint_handler)
