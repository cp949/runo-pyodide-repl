# 세션: 리셋·이중 마운트·종료 후 상태

> 이 문서의 규칙·상수는 이전 구현(`/work/cp949/pyodide-samples/apps/repl`, 읽기 전용 참고)이 CPython 3.14.4 pty 실측과 브라우저 회귀로 확정한 것이다. 새 구현은 통신 계층만 바꾸고(`docs/design/00-architecture.md`, `01-protocols.md`) 이 규칙은 그대로 지킨다. 절 끝의 "참고:" 경로는 이전 구현의 근거 위치다.

## 8.1 리셋 = worker 교체(`ReplHandle.reset()`, RD-010)

`readline`(벤더 `Readline`)·Ctrl+C 핸들러는 핸들(`index.ts`) 소유라 리셋을 넘어 산다. interrupt buffer·송신기는 세션(`session.ts`)이
소유해 세션마다 새로 만들어진다(아래 4번). `Terminal`(화면)도 호출자 소유라 마운트 시 1회만 만들어진다. 세션 1개(worker·RPC·
sink·리더·가드·게이트)는 `session.ts`의 `startSession()`이 만들고 `reset()`이 통째로 교체하는 단위다
(`00-architecture.md` 4.2). RD-020 뒤 `startSession()`은 두 부분을 조립한다. core 세션(`startCoreSession`,
core `session/core-session.ts`)이 worker·`MessageChannel`·메일박스·초기화 프레임·RPC(core 핸들러 + driver 핸들러
합성)·`readInput` 처리·게이트 `alive`·`inputReadsPending`·크래시·종료를 맡고, REPL main driver
(`createReplMainDriver`, `repl-main-driver.ts`)가 sink·리더·가드·`autoIndent`·`blockHistory`·`tabReader`·
게이트 `readLinePending`·`cancelSettling`·`reading`·`readLine`/`writeOutput`/`writeError` 핸들러·종료 시 읽기 정리를 맡는다.

`reset()` 순서. 자동 들여쓰기 단위(`lastUsedIndentation`)는 세션 소유(`createAutoIndent`, RD-013 완료)라
별도 초기화 단계가 없다 — 4번이 새 세션을 만들 때 `startSession()`이 만드는 REPL main driver가 `createAutoIndent
(readline)`을 다시 불러 새 객체(4칸)가 되기 때문이다:

1. `session.terminate()` — 옛 세션을 끝낸다. core 세션(`terminate()`)의 순서는 `ended=true` → REPL main driver의
   `terminate` 훅 → `endSession()`(`alive=false`, `interruptSender.cancel()`) → worker `error` 리스너 제거 →
   `rpc.dispose()` → `worker.terminate()`다(`rpc.dispose()`가 `worker.terminate()`보다 앞이어야 한다). 훅의 순서는
   (REPL 읽기가 열려 있으면 `blockHistory.discard()`로 대기 중 블록 history를 첫 줄까지 버린다 →, RD-014 완료·
   `06-editing.md` 6.4) `tabReader.readEnded(null)`(`ended=true`·큐 비움을 동기로 확정 — 뒤이은 `rpc.dispose()`의
   `complete` 요청 reject가 취소된 세션의 버퍼·커서로 큐를 다시 처리하는 것을 막는다, RD-015 DELTA-04a) →
   `readline.cancelRead()`(열린 읽기를 `ReadCancelledError`로 끝낸다. 화면·history·리스너·`term`은 건드리지
   않는다, `06-editing.md` 6.1)다. 배경 출력 재그리기 콜백 전이라 아직 그리지 않은 접두가 있으면(`readline.undrawnAbovePrefix()`)
   `cancelRead()` 앞에서 `접두 + "\x1b[0m\r\n"`을 써 자기 행으로 남긴다(`05-output.md` 4.4).
2. 커서 행 처리: `terminal.buffer.active.cursorX !== 0`이면 `readline.write("\r\n")`을 먼저 쓴다
   (TRP-006). 개행 여부는 **코어**가 결정한다 — 벤더 `cancelRead()`는 화면에 아무것도 그리지 않는다.
3. `writeNotice(readline, RESET_NOTICE, "info")` — 청록 안내 줄
   `[세션 리셋됨 — 이전 변수/import가 모두 초기화되었습니다]`. 세션 밖 출력 경로(TRAP-12의 유일한 예외,
   `05-output.md` 4.1).
4. `startSession(...)`로 새 세션을 만든다: 새 `MessageChannel`·메일박스·interrupt buffer·송신기·`InitFrame`·RPC·worker·sink
   세트·리더·가드·게이트(`createWorker()`가 새 worker를 만든다). 옛 buffer에 남은 SIGINT는 새 worker가 보지 못하므로 리셋이
   `SIGNAL`을 지우는 단계는 없다. 옛 worker가 `terminate()` 뒤에도 Chromium에서 최대 약 2초 살아 같은 buffer의 눌림을 가로채는 것을
   막기 위해서다(`14-runner.md` 14.3.5, `docs/traps/TRP-049`). 리셋 직전 Ctrl+C가 새 세션의 시작 코드를 죽이지 않는 것도 이 분리가
   보장한다(브라우저 `session-reset-check.mjs`의 `ccreset`·`ccafter`).
5. `onStatus("loading")`을 동기로 발행한다. 이후 새 worker의 `ready`/`loadFailed` 알림이
   `ready`/`load-failed`를 재발행한다.

4번에서 `createWorker()`가 던지면(잘못된 URL, `SecurityError`) `reset()`은 던지지 않는다. 핸들의 세션을 비우고
5번 대신 `onStatus("crashed")` → `onCrash?.(String(error))` 순으로 부른다(`dispose()` 뒤면 `onCrash` 생략). core
`createRunner.reset()`의 `restart()`와 같은 계약이다(`14-runner.md`). 그 뒤 `busy`는 `false`, `runSource()`는 `unavailable`로
거부하고 복구는 다시 `reset()`이다. 소비자가 `onCrash` 안에서 동기로 `reset()`을 부르면 생성이 계속 실패할 때 재귀한다 —
데모(`ReplView`)는 `onCrash`에서 메시지만 저장하고 재시작은 버튼으로 한다. `crashed` 콜백 안에서 `reset()`을 부르면
그 리셋의 `loading`이 먼저 나가고 실패한 생성의 `onCrash`는 그 뒤에 온다(runner와 같다, `14-runner.md` "상태 콜백 재진입"). 세션이 없는 채로
다음 `reset()`이 오면 1번 대신 `readline.cancelRead()`만 불러 `crashed` 동안 쌓인 type-ahead 키를 버린다. worker를 만든 뒤
프레임 전송이 던지면 core 세션(`startCoreSession`)이 그 worker의 `error` 리스너를 떼고 `rpc.dispose()`·`worker.terminate()`로
정리한 뒤 던진다(남은 worker의 뒤늦은 `error`가 다음 세션을 `crashed`로 바꾸지 않게) — REPL은 이것도 같은 `crashed` 경로로 받는다.
화면에는 이미 `RESET_NOTICE`가 찍혀 있다(4번이 5번보다 앞이다). 이 계약은 이슈 08(2026-09-24)에서 바꿨다.
이전(RD-010~RD-022a)에는 `reset()`이 그 예외를 호출자에게 던지고 상태를 옛 값으로 남겼다.

`dispose()` 뒤 `reset()`은 no-op. `!isolated`(worker가 없다)에서도 no-op. 그 외 상태(`ready`·
`terminated`·`crashed`·`load-failed`·`loading`)는 전부 허용한다. `{ topLevelAwait? }` 옵션은 새 프레임에
실린다. 생략하면 마지막 값을 유지한다(RD-012). 확인 대화상자·디바운스 없음.

세션 소유 vs 핸들 소유(`session.ts`·`repl-main-driver.ts`·core `session/core-session.ts`): 세션은 게이트 4종(`alive`·`readLinePending`·`inputReadsPending`·
`cancelSettling`)·`reading`·`ended`·sink·리더·가드·`autoIndent`(`lastUsedIndentation`, RD-013)·
`blockHistory`(기준점 `blockBase`·`pendingBlock`, RD-014)·`tabReader`(`createTabReader`, 세대·큐·왕복 상태
`requesting`, RD-015)·메일박스·RPC·worker·interrupt buffer·송신기를 소유한다. 리셋마다 전부
초기값으로 새로 만들어져, 옛 세션의 상태(예: 취소 응답 직후의 `cancelSettling=true`)가 새 세션으로 새지
않는다. 핸들은 `readline`·Ctrl+C 핸들러(`session?.pythonRunning()`·`session.interrupt()`를
현재 세션 변수로 늦게 읽어, 리셋으로 세션이 바뀌어도 다시 등록할 필요가 없다)·`dispose()`·`reset()`을
소유한다.

화면·history는 유지된다: `Readline`이 핸들 소유라 벤더 `History`(`persist: false`, 메모리만)가 세션을
넘어 산다. 리셋 시 미제출 입력·대기 읽기·쌓인 type-ahead 키(`06-editing.md` 6.7)는 버린다(history 미기록, 화면에는 남긴다) — `cancelRead()`가
벤더 읽기를 화면·history를 건드리지 않고 끝내기 때문이다.

옛 세션의 열린 읽기: `cancelRead()`로 `ReadCancelledError`가 되면 REPL main driver의 `readLine` 핸들러와 core 세션의
`readInput` 처리(판정은 driver의 `isReadCancelled`)가 응답 없이 조용히 끝낸다(영영 안 풀리는 Promise를 돌려줘 RPC가 응답을 보내지 않는다) — 옛
worker는 이미 종료 중이라 응답을 기다리지 않는다. `readInput`은 세션이 `ended`면(TRP-003) 메일박스에
`fail()`도 쓰지 않는다.

`runSource`(RD-022a, `02-console-core.md` 5.6)의 슬롯은 핸들 소유라 리셋을 넘어 산다. 세션 순서에서 슬롯을 비우는 시점은 `onStatus` 콜백 앞이고 결과는 콜백 뒤에 낸다(`docs/traps/TRP-051`). 리셋은 실행 중(`{ source }`를 보낸 뒤 결말 도착 전)이면 `restarted`로 resolve하고 대기 중(첫 프롬프트 전)이면 유지해 새 세션의 첫 `>>> `에서 실행한다. 리셋 중 worker 생성이 실패하면 실행 중은 `restarted`, 대기 중은 `crashed`다(`crashed` 발행이 대기 슬롯을 끝낸다). 옛 세션 정리(`session.terminate()`) 자체가 던지면 그 예외는 호출자에게 가지만 슬롯에서 뗀 실행은 `finally`에서 `restarted`(리셋)·`disposed`(`dispose()`)로 끝난다. 이때 상태는 옛 값으로 남는다(실제 `worker.terminate()`·`cancelRead()`는 던지지 않아 닿지 않는 경로다). 크래시(8.4)는 실행 중·대기 중 모두 `crashed`, `dispose()`는 `disposed`로 거부하고, 결말이 이미 도착한 슬롯은 그 결말로 resolve한다. 대기 중 `load-failed`는 `unavailable`이다.

Ctrl+L(화면 지우기)과 리셋(Python 상태 초기화)은 별개 기능이다. Ctrl+L은 벤더 동작 그대로이고 코어는
손대지 않는다(`10-parity-deviations.md`).

## 8.2 StrictMode 이중 마운트

- dev의 StrictMode는 mount→cleanup→mount를 한 번 더 돌린다. `Readline.dispose()`는 리스너만 정리하고
  `this.term` 참조를 남겨, 버려지는 첫 인스턴스의 지연된 `term.write("", cb)` 콜백이 이미 dispose된 xterm에
  접근해 `DisposableStore` 경고를 낸다(TRP-001, throw는 아님).
- 대응: **상시 `while read()` 재귀 루프를 두지 않는다**(worker가 필요할 때만 읽기를 요청). 그 뒤로 경고가
  재현되지 않았고 트랩은 ACTIVE로 남겼다. 이중 마운트로 interrupt buffer·송신기가 두 번 만들어지는 것은
  측정에서 수용했다(정확성 영향 없음).
- 새 구현: 벤더 `Readline.dispose()`가 `term`을 비우고 대기 읽기를 reject하므로(`06-editing.md` 6.1) 마운트 직후 읽기를 시작하는 루프도 안전하다. RD-003 데모(`ReplView`)가 이 순서로 동작하고 dev StrictMode에서 콘솔 경고 0과 `.xterm` 1개를 확인했다. `dispose()` 뒤 읽기 promise는 `Error`로 reject되므로 읽기 루프는 dispose로 끝난 reject를 정상 종료로 처리한다.

## 8.3 종료 후 상태

- `exit()`/`quit()`/`raise SystemExit()` → worker 루프가 `break`하고 `onSessionTerminated`로 main에 알린다
  → `sessionTerminated = true`. main은 Alert로 "Python session terminated. 세션 리셋 버튼으로 새 세션을
  시작하세요."를 띄운다. 더 이상 읽기를 요청하지 않으므로 입력에 응답하지 않는다. 복구 경로는 세션 리셋뿐이다.
- 알려진 잔재: `exit()` 뒤·pyodide 로드 실패 뒤에는 읽기도 실행도 없는데 Ctrl+C가 `send()`를 만들어 송신기
  타이머가 리셋/언마운트까지 돈다(정확성 영향 없음).

## 8.4 크래시(RD-010)

worker가 죽거나(전역 `error` 이벤트) 부팅 뒤(REPL 루프)에서 잡히지 않은 예외가 나면(`crashed` 알림,
`01-protocols.md` 1.2) core 세션(`session/core-session.ts`)의 `crash(message)`가 `endSession()`(`alive=false`) →
`onStatus("crashed")` → `onCrash?.(message)` 순으로 부른다(`00-architecture.md` 3.4). 둘 중 먼저 온
신호만 반영한다 — 이미 크래시했거나 `terminate()`됐으면 `crash()`는 아무것도 하지 않는다. 터미널에는
아무것도 쓰지 않는다(앱의 Alert가 보여준다). worker는 terminate하지 않는다(복구는 8.1의 `reset()`뿐).

`error` 리스너는 core 세션이 worker 생성 직후 건다. `session.terminate()`(리셋·dispose 양쪽이
부른다)에서 뗀다 — 안 떼면 다음 세션이 시작된 뒤 옛 worker가 뒤늦게 죽어도(가비지 컬렉션 전) 리스너가
남아 있지만, `crash()` 자체가 `ended` 가드로 막으므로 관찰 가능한 차이는 없다(리스너 제거는 누수 방지
목적).

크래시 뒤 `session.pythonRunning()`은 `alive=false`라 거짓이다 — Ctrl+C가 에코도 전송도 하지 않는다
(`03-ctrl-c.md` 2.7과 같은 게이트).

참고: `/work/cp949/pyodide-samples/apps/repl/docs/design/04-session-reset.md`,
`/work/cp949/pyodide-samples/apps/repl/src/repl/ReplTerminal.tsx`,
`/work/cp949/pyodide-samples/docs/repl/traps/TRP-001-strictmode-readline-dispose-race.md`
