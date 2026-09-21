# 세션: 리셋·이중 마운트·종료 후 상태

> 이 문서의 규칙·상수는 이전 구현(`/work/cp949/pyodide-samples/apps/repl`, 읽기 전용 참고)이 CPython 3.14.4 pty 실측과 브라우저 회귀로 확정한 것이다. 새 구현은 통신 계층만 바꾸고(`docs/design/00-architecture.md`, `01-protocols.md`) 이 규칙은 그대로 지킨다. 절 끝의 "참고:" 경로는 이전 구현의 근거 위치다.

이 절의 `sessionGen`·`setState`류 서술은 이전 구현의 React 데모 배선이다. 새 구조에서는 코어 패키지의 `createRepl()` 핸들이 `reset()`·`dispose()`·`onCrash`·`onSessionTerminated`를 노출하고(`00-architecture.md` 4절), `apps/demo`이 그 위에 같은 규칙으로 UI 상태를 얹는다. 순서 규칙(버퍼 재사용 전 송신기 취소·슬롯 비우기, sink 세트 재생성, 화면은 1회 생성)은 코어가 지킨다.

## 8.1 리셋 = worker 교체
- 화면(`Terminal`/`Readline`)은 마운트 시 **1회만** 만든다(deps `[]`). 세션 리셋으로도 스크롤 기록이
  유지되어야 한다. worker는 `sessionGen`·`topLevelAwaitEnabled`가 바뀔 때마다 새로 만든다(effect deps).
- `resetSession(message)`: `setWorkerSync(null)` → `setSessionTerminated(false)` →
  안내 줄을 `println`(청록) → `setSessionGen(g => g + 1)`. 그러면 worker effect의 cleanup(이전
  `worker.terminate()`)과 새 worker 생성이 자연히 일어난다. top-level await 스위치도 같은 경로를 쓴다.
- 새 worker 직전 순서: `autoIndent.reset()`(들여쓰기 단위 잊기) → `interruptSender.cancel()` →
  `Atomics.store(buffer, SIGNAL, 0)` → 버퍼 전달. **interrupt buffer는 세션 사이에 재사용**하므로 남은
  SIGINT·재전송을 반드시 먼저 치운다(이전 worker가 소비하지 못한 값이 새 worker의 시작 코드를 죽인다).
  ack·요청 번호는 이어진다(핸들러의 `last_seq` 초기값이 설치 시점 `buf[SEQ]`라 안전하다).
- sink 세트도 worker마다 새로 만든다(이전 꼬리 비물려받음). cleanup에서 `rpc.dispose()`,
  `tabReader.dispose()`, `sinksRef = null`, worker error 리스너 제거, `interruptSender.cancel()`,
  `worker.terminate()`.
- Ctrl+L(화면 지우기)과 리셋(Python 상태 초기화)은 **반드시 별개 기능**으로 유지한다.
- worker `error` 이벤트 → `onCrash(message)` → 상위가 `ReplSession`을 `key`로 재마운트한다(이 경로에서는
  top-level await 스위치가 OFF로 돌아간다).

## 8.2 StrictMode 이중 마운트
- dev의 StrictMode는 mount→cleanup→mount를 한 번 더 돌린다. `Readline.dispose()`는 리스너만 정리하고
  `this.term` 참조를 남겨, 버려지는 첫 인스턴스의 지연된 `term.write("", cb)` 콜백이 이미 dispose된 xterm에
  접근해 `DisposableStore` 경고를 낸다(TRP-001, throw는 아님).
- 대응: **상시 `while read()` 재귀 루프를 두지 않는다**(worker가 필요할 때만 읽기를 요청). 그 뒤로 경고가
  재현되지 않았고 트랩은 ACTIVE로 남겼다. 이중 마운트로 interrupt buffer·송신기가 두 번 만들어지는 것은
  측정에서 수용했다(정확성 영향 없음).

## 8.3 종료 후 상태
- `exit()`/`quit()`/`raise SystemExit()` → worker 루프가 `break`하고 `onSessionTerminated`로 main에 알린다
  → `sessionTerminated = true`. main은 Alert로 "Python session terminated. 세션 리셋 버튼으로 새 세션을
  시작하세요."를 띄운다. 더 이상 읽기를 요청하지 않으므로 입력에 응답하지 않는다. 복구 경로는 세션 리셋뿐이다.
- 알려진 잔재: `exit()` 뒤·pyodide 로드 실패 뒤에는 읽기도 실행도 없는데 Ctrl+C가 `send()`를 만들어 송신기
  타이머가 리셋/언마운트까지 돈다(정확성 영향 없음).

참고: `/work/cp949/pyodide-samples/apps/repl/docs/design/04-session-reset.md`,
`/work/cp949/pyodide-samples/apps/repl/src/repl/ReplTerminal.tsx`,
`/work/cp949/pyodide-samples/docs/repl/traps/TRP-001-strictmode-readline-dispose-race.md`

