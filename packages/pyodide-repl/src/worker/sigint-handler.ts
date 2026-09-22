/**
 * worker Python SIGINT 핸들러(03-ctrl-c.md 2.4의 RD-007 부분). pyodide 폴링이 interrupt buffer의 SIGINT를 읽으면
 * `signal.signal(SIGINT, …)`로 등록한 이 핸들러가 돈다. 눌림을 받았다고 ack하고, 스택에 사용자 프레임(`<console>`)이
 * 있을 때만 `KeyboardInterrupt`를 낸다. 사용자 프레임이 없는 구간(다음 문장 컴파일, 트레이스백 생성, 시작 코드)의
 * SIGINT는 버린다(TRP-009). 중단 트레이스백에서 핸들러 프레임은 `console.formattraceback` 교체로 자른다.
 *
 * `worker/`는 `protocol/`을 import하지 않는다. `ack`·`seq`는 `boot.ts`가 `acknowledgeInterrupt`·`readRequestSeq`를
 * 클로저로 넣는다(`stdin-callback.ts`와 같은 패턴).
 */
import type { PyodideInterface } from "pyodide";
import type { PyProxy } from "pyodide/ffi";
import type { PyodideConsoleProxy } from "./console";

export interface SigintHandlerDeps {
  /** 눌림을 받았다는 표시. `acknowledgeInterrupt(buffer)`를 boot.ts가 넣는다. 폴링 경로가 아니라 핸들러 진입에서만 불린다. */
  ack(): void;
  /** 현재 요청 번호. `readRequestSeq(buffer)`를 boot.ts가 넣는다. */
  seq(): number;
}

/** 핸들러·래퍼 소스의 Python 파일명. 트레이스백에 새면 알아보기 위한 이름이고 절단은 코드 객체로 한다. */
export const SIGINT_HANDLER_FILENAME = "<sigint-handler>";

// tsdown 0.23(rolldown 1.2.9)은 `?raw`를 지원하지 않아 Python 소스를 문자열로 둔다(`console.ts`의 HELPERS_SOURCE와 같다).
//
// - 요청 번호(`seq()`)가 마지막으로 처리한 것과 같으면 main의 재전송이다: ack도 예외도 없다. 같은 눌림이 두 번 중단되는
//   것을 막는다(TRP-025). 다르면 새 눌림이라 스택 검사·예외보다 먼저 ack한다: 아래에서 버려지는 SIGINT도 전달된 것이라
//   ack가 없으면 main이 소실로 오판해 같은 번호로 다시 쓴다(TRP-019).
// - `frame.f_back` 사슬에 `console.filename`(`<console>`)과 같은 파일명의 프레임이 하나라도 있으면 사용자 코드 실행 중이다.
//   `signal.default_int_handler`는 반드시 예외를 던져야 한다(`input()` 취소가 기대는 EINTR 경로, PEP 475).
// - 핸들러 프레임은 예외 트레이스백의 안쪽 끝에 붙는다. `formattraceback`이 가장 바깥의 우리 프레임부터 안쪽 전부를 자른다
//   (핸들러 실행 중에 또 눌림이 도착하면 핸들러 프레임이 겹치므로 안쪽 하나만 자르면 샌다). 바깥의 내부 프레임(`runcode`
//   등)은 원본 `formattraceback`이 `<console>` 첫 프레임부터 남긴다.
//
// RD-009 확장 지점: `install`의 인자에 `warn`, 반환값 `interrupt_idle`, 사용자 프레임이 없을 때 정지한 실행 깨우기,
// `own_codes.update(...)`, `webloop.py` 프레임 제거, `IdleInterrupt`.
const SIGINT_HANDLER_SOURCE = `
import signal

def install(console, ack, seq):
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

    own_codes = {sigint_handler.__code__}
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
`;

/**
 * `signal.signal(SIGINT, …)` 핸들러 설치 + `console.formattraceback` 교체. `connectInterrupts`가 버퍼 연결 **전에**
 * 부른다(핸들러 없이 연결하면 부팅 중 눌림이 기본 핸들러로 시작 코드를 죽인다, TRP-009). 세션마다 pyodide가 새로
 * 만들어지므로 한 번만 설치한다. 동기 함수.
 */
export function installSigintHandler(
  pyodide: Pick<PyodideInterface, "runPython" | "toPy">,
  pyconsole: PyodideConsoleProxy,
  deps: SigintHandlerDeps,
): void {
  // 별도 namespace(빈 dict)에서 정의해 사용자 globals를 오염시키지 않는다. proxy는 설치 뒤 버리고, 핸들러 함수는
  // Python 쪽 참조(`signal` 모듈, `console.formattraceback`)가 유지한다.
  const namespace = pyodide.toPy({}) as PyProxy & {
    get(name: string): unknown;
  };
  try {
    pyodide.runPython(SIGINT_HANDLER_SOURCE, {
      globals: namespace,
      filename: SIGINT_HANDLER_FILENAME,
    });
    const install = namespace.get("install") as PyProxy &
      ((
        console: PyodideConsoleProxy,
        ack: () => void,
        seq: () => number,
      ) => void);
    try {
      // JS 함수 두 개는 pyodide가 JsProxy로 넘긴다. 핸들러 진입에서만 불리며 폴링 경로가 아니다(TRP-024 무관).
      install(pyconsole, deps.ack, deps.seq);
    } finally {
      install.destroy();
    }
  } finally {
    namespace.destroy();
  }
}
