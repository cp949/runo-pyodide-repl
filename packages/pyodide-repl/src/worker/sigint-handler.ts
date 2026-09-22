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
import SIGINT_HANDLER_SOURCE from "./sigint-handler.py?raw";

export interface SigintHandlerDeps {
  /** 눌림을 받았다는 표시. `acknowledgeInterrupt(buffer)`를 boot.ts가 넣는다. 폴링 경로가 아니라 핸들러 진입에서만 불린다. */
  ack(): void;
  /** 현재 요청 번호. `readRequestSeq(buffer)`를 boot.ts가 넣는다. */
  seq(): number;
}

/** 핸들러·래퍼 소스의 Python 파일명. 트레이스백에 새면 알아보기 위한 이름이고 절단은 코드 객체로 한다. */
export const SIGINT_HANDLER_FILENAME = "<sigint-handler>";

/**
 * `signal.signal(SIGINT, …)` 핸들러 설치 + `console.formattraceback` 교체. `connectInterrupts`가 버퍼 연결 **전에**
 * 부른다(핸들러 없이 연결하면 부팅 중 눌림이 기본 핸들러로 시작 코드를 죽인다, TRP-009). 세션마다 pyodide가 새로
 * 만들어지므로 한 번만 설치한다. 동기 함수.
 *
 * `extraOwnCodes`는 다른 모듈이 심은 우리 코드 객체 tuple의 proxy다(`installSleepSlice`의 반환값). 절단 대상에
 * 합쳐지며, 호출자가 이 함수가 돌아온 뒤 destroy한다.
 */
export function installSigintHandler(
  pyodide: Pick<PyodideInterface, "runPython" | "toPy">,
  pyconsole: PyodideConsoleProxy,
  deps: SigintHandlerDeps,
  extraOwnCodes?: PyProxy,
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
        extraOwnCodes?: PyProxy,
      ) => void);
    try {
      // JS 함수 두 개는 pyodide가 JsProxy로 넘긴다. 핸들러 진입에서만 불리며 폴링 경로가 아니다(TRP-024 무관).
      // `undefined`를 넘기면 Python이 `None`으로 받아 기본값 `()`가 무시되므로 인자 수를 나눠 부른다.
      if (extraOwnCodes) install(pyconsole, deps.ack, deps.seq, extraOwnCodes);
      else install(pyconsole, deps.ack, deps.seq);
    } finally {
      install.destroy();
    }
  } finally {
    namespace.destroy();
  }
}
