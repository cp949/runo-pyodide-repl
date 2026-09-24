# stdin: input() 읽기·취소·read-guard·프롬프트 꼬리

> 이 문서의 규칙·상수는 이전 구현(`/work/cp949/pyodide-samples/apps/repl`, 읽기 전용 참고)이 CPython 3.14.4 pty 실측과 브라우저 회귀로 확정한 것이다. 새 구현은 통신 계층만 바꾸고(`docs/design/00-architecture.md`, `01-protocols.md`) 이 규칙은 그대로 지킨다. 절 끝의 "참고:" 경로는 이전 구현의 근거 위치다.

새 구현에서 `readInput(cancelable)`은 coincident proxy 호출이 아니라 **stdin 메일박스**(`01-protocols.md` 2절)다: worker가 RPC 알림 `readInput`을 보낸 뒤 `Atomics.wait`로 멈추고, main이 메일박스에 줄(또는 취소 표식)을 써서 깨운다. worker 쪽 `stdin-callback`(core `worker/stdin-callback.ts`)은 `createStdinCallback({ requestInput, wait, signalInterrupt, checkInterrupt })`다. core `worker/boot.ts`가 `requestInput`에 `rpc.notify("readInput", cancelable)`를, `wait`에 `createMailboxReader(...).wait`를, `signalInterrupt`에 `() => signalInterrupt(interruptBuffer)`를, `checkInterrupt`에 `() => pyodide.checkInterrupt()`를 주입하고 `readInput` 알림 → `wait()` 순서는 이 모듈이 소유한다(3.1).

## 3.1 stdin 콜백과 취소 변환 규칙(`createStdinCallback`)
- `createStdinCallback({ requestInput, wait, signalInterrupt, checkInterrupt })`. 호출마다 `requestInput(true)`(= `readInput` 알림) → `wait()`(메일박스 `Atomics.wait`) 순서로 돌고 `wait()`가 돌려준 줄을 그대로 반환한다. 순서를 이 모듈이 소유하므로 알림을 `wait()` 뒤로 옮기면 worker가 알림 없이 정지한다. `wait()`가 던진 오류(main의 `fail`)는 그대로 전파되어 `input()`에서 `OSError`가 된다. `null`(취소 표식)은 아래 변환을 거친다.
- `pyodide.setStdin({ stdin })`만 쓴다(기본 `isatty: false`, `autoEOF: true`, pyodide 314.0.7 `LegacyReader`). 콜백이 돌려준 문자열 끝에 `\n`이 없으면 pyodide가 붙이고 마지막 바이트가 `\n`이면 EOF를 넣지 않으므로 콜백은 `\n`을 붙이지 않는다. `input()`은 `"abc"`, `readline()`은 `"abc\n"`이고 `read()`·`readlines()`·`for line in sys.stdin`은 줄마다 콜백을 다시 불러 끝나지 않는다(편차 34). `read(n)`은 줄 끝 `\n`을 남겨 다음 읽기를 콜백 없이 채운다(`docs/traps/TRP-010`).
- 취소 변환(RD-008). 의존성은 **객체가 아니라 클로저 둘**(`signalInterrupt`·`checkInterrupt`)로 받는다: core `worker/stdin-callback.ts`는 `protocol/`을 import하지 않고(`00-architecture.md` 4.2), 실제 pyodide 없이도 변환 순서와 "재시도 없음"을 단위로 고정할 수 있다.
- `readInput(true)`(취소 가능)로 읽는다. 프롬프트는 넘기지 않는다(main이 꼬리로 정한다).
- 결과가 `null`(Ctrl+C 취소)이면 **`signalInterrupt(interruptBuffer)` → `pyodide.checkInterrupt()`**.
  stdin 콜백은 GIL이 풀린 상태라 `checkInterrupt()`가 `FS.ErrnoError(EINTR)`를 던지고, CPython이
  EINTR 뒤 `PyErr_CheckSignals()`로 버퍼를 소비해 **`input()` 호출 지점에서** `KeyboardInterrupt`를
  올린다(PEP 475). 콜백 안에서 쓰고 바로 소비되므로 잔류 SIGINT가 없다.
- `checkInterrupt()`가 던지지 않고 돌아오면 `console.warn("[repl.worker] checkInterrupt가 SIGINT를 소비하지 않아 입력 취소를 EOF로 처리한다")`를 남기고 `null`을 돌려준다(→ `EOFError`). 버퍼가 아직 연결되지 않은 구간(`connectInterrupts` 전)에 콜백이 불리는 경우다.
- `signalInterrupt`로 써서 **요청 번호를 반드시 올린다**. 번호를 올리지 않으면 핸들러가 직전 눌림의
  재전송으로 보고 이 취소를 무시한다(TRP-035).
- 금지된 대안 5종(실측으로 탈락, TRP-014): `buf[0]=2` 뒤 정상 반환(신호가 임의 지점에서 소비돼 HANG·엉뚱한
  프레임), 일반 `Error`(→ `OSError`가 되어 `except Exception`이 삼킴), `null` 그대로(→ EOF), `errno`만 가진
  `Error`(pyodide 사망), 버퍼 없이 `ErrnoError`만(무한 재시도).
- main은 이 경로에서 버퍼를 쓰지 않는다.
- `input()` 취소에는 main 게이트의 `cancelSettling`을 세우지 않는다(`06-editing.md` 6.3, `03-ctrl-c.md` 2.7):
  취소 뒤에도 사용자 코드가 계속 돌기 때문에 그 구간의 Ctrl+C는 실행 중단이어야 한다. 실측: 방어를 걸면
  `except KeyboardInterrupt` 뒤 4초 계산 중 Ctrl+C가 3.0초 무시되고(이전 구현), 걸지 않으면 33~58ms에
  중단된다(RD-008 브라우저 판정 항목).
- 의미: `try/except KeyboardInterrupt`가 잡고 `except Exception`은 못 잡으며 `with.__exit__`·`finally`가
  실행된다. `input()`/`sys.stdin.readline()/read()/readlines()`/`for line in sys.stdin`은 같은 콜백이라
  구분하지 않는다.
- worker는 `PyodideConsole`에 `stdin_callback`을 넘기지 않는다. 넘기지 않으면 콘솔이 `sys.stdin`을
  건드리지 않아 전역 `setStdin` 설정이 그대로 쓰인다.

## 3.2 read-guard(`createReadGuard({ readLine, readInput })`)
- REPL 읽기와 stdin 읽기가 같은 `readline`을 쓰고, `readline.read()`는 이미 열린 읽기를 교체하면서
  옛 읽기의 promise를 영영 끝내지 않는다. 프롬프트 대기 중 배경 콜백이 `input()`을 부르면 REPL 읽기가
  고아가 되어 입력이 멈춘다.
- 규칙: 돌려받은 `readLine`이 반환 promise를 "활성 REPL 읽기"로 추적하고, `readInput`은 **그 결과가
  정해진 뒤에** 시작한다. 결과가 입력 줄이든 취소(`null`)든 실패든 stdin 읽기는 진행한다.
- `readLine` 자체는 기다리지 않고 즉시 부른다(시작 타이밍 불변). stdin 읽기끼리는 직렬화하지 않는다
  (worker가 동기 대기라 겹치지 않는다).
- 목록 재그리기로 읽기가 새로 시작돼도 `readLine`이 돌려주는 promise는 바뀌지 않으므로
  (`tab-reader.ts`의 `ReadHandle.result`) 그 promise가 최종 종료 시점이다.
- 교착 없음: worker는 `readInput` 동안 동기 대기하고 `readLine` 응답은 포트에 큐잉된다.
  화면 순서는 REPL 줄 → 배경 `input` 줄 → 콜백 출력 → REPL 줄 실행.
- 겹침 거절(열린 읽기 위에 `readLine` 요청이 또 오면 `Error("이미 읽는 중")`)은 `createRepl`이 가드 **바깥**에서 검사한다. 거절된 promise를 가드가 활성 읽기로 추적하면 진짜 활성 REPL 읽기를 잃어 stdin 읽기가 앞당겨진다. 순서: `reading` 검사 → `guard.readLine(prompt)` → `.finally(reading = false)`.
- stdin 읽기가 실패(reject)하면 `createRepl`의 `readInput` 핸들러가 `disposed`가 아닐 때만 `mailbox.fail(String(error))`로 worker를 깨워 Python `OSError`로 드러낸다. `disposed`면 쓰지 않는다: worker는 이미 `terminate()`됐고 `fail()`의 `untilIdle`이 영영 안 풀릴 수 있다. `Readline.dispose()`가 대기 중인 읽기를 reject하므로 dispose 때는 항상 이 분기다.
- 제네릭(`L`·`I`)은 REPL 읽기 결과를 `string | null`로 넓혀도 가드 코드를 바꾸지 않으려는 것이다(RD-008에서 실제로 그렇게 넓혔고 가드는 인자 전달만 늘었다). 인자는 `readLine(prompt, pending, cancelable)`·`readInput(cancelable)`이다(RD-013 완료: `pending`을 `ReadGuardDeps.readLine`·`ReadGuard.readLine`에 넣어 리더까지 그대로 통과시킨다 — stdin 읽기(`readInput`)는 여전히 `pending`을 받지 않는다).
- 화면(브라우저 확인): 활성 REPL 읽기 중 배경 `bg> `는 프롬프트 행 뒤에 붙고(`>>> bg>`), REPL 줄 Enter 뒤 그 행은 `>>> x = 41`로 다시 그려지며 다음 행에서 stdin 읽기가 `bg> `로 시작해 `bg> hello`가 남는다.

## 3.3 프롬프트 꼬리(output-tail) 렌더링
- 꼬리 = 직전 출력의 **마지막 `\n` 뒤이면서 그 안에서 마지막 `\r` 뒤** 텍스트. 꼬리가 없으면 프롬프트 없이
  입력만 받는다. `input("x: ")`의 `x: `는 stdout으로 먼저 나가고, 읽기가 시작되면 그 꼬리를 프롬프트로
  같은 행에 다시 그린다(3.14의 `x: abc` 한 줄과 같다).
- 색: 줄 경계를 넘어 열린 SGR 시퀀스를 꼬리 앞에 이어 붙인다(시퀀스 목록으로 보관, 첫 파라미터가 0이거나
  비면 초기화, **상한 64개**). SGR 스캔은 정규식 없이 ESC + `[` + 숫자/`;`/`:` + `m`을 직접 읽는다.
  SGR 외 제어(`\b`, CSI 이동/지우기, OSC)는 걸러내지 않고 통과시킨다.
- 꼬리 초기화 시점: println 계열 sink(`writeOutput`/`writeError`), 텍스트 안 `\n`, 읽기 시작(REPL·stdin),
  새 worker. 읽기는 Enter뿐 아니라 **취소(Ctrl+C)로도 `\r\n`을 내고 끝나므로** 취소 뒤에도 꼬리가 남지 않는다.
- 폭 초과 처리(`rewindTail`, `terminal/rewind-tail.ts`): 꼬리가 터미널 폭을 넘으면 `read()` 앞에 `\x1b[nA`로 첫 행까지 커서를
  올린다(TRP-016). 행 수는 `term.write('', cb)`로 flush를 기다린 뒤 화면 버퍼에서 커서 행(`baseY + cursorY`)부터 `isWrapped`를
  위로 세어 구하고, `cursorY`를 넘어 스크롤백으로는 올리지 않는다. **짧은 꼬리(`길이 × 2 < cols`)는 flush 없이 건너뛴다.**
  커서만 옮기므로 sink를 거치지 않는다. REPL 경로와 stdin 경로가 같은 `rewindTail`을 쓴다.
- REPL 경로(`terminal/repl-reader.ts`의 `createReplReader(readline, term, sinks)` → `read(prompt, cancelable): Promise<string | null>`, 세션마다 하나)의 순서: `rewindTail` → 꼬리
  재조회(flush를 기다리는 사이 온 출력을 반영) → `resetTail` → `readline.read(꼬리 + "\x1b[0m" + 프롬프트, { cancelable })`. 꼬리가 없으면
  프롬프트 그대로 읽는다. 꼬리의 열린 색이 프롬프트로 새지 않도록 둘 사이에 SGR 리셋을 넣는다.
- stdin 경로(`terminal/stdin-reader.ts`의 `createInputReader(readline, term, sinks)` → `read(cancelable): Promise<string | null>`, 세션마다 하나)는 꼬리 그대로가
  프롬프트의 전부다(sink·꼬리 규칙은 `05-output.md`, 프롬프트 문자열은 `02-console-core.md` 5.2 참고). 순서는 `rewindTail` → 꼬리
  재조회 → `resetTail` → `readline.read(꼬리, { cancelable })`이고 **SGR 리셋을 붙이지 않는다**: 프롬프트의 열린 색은 tty처럼 입력에 이어진다(색이 닫힌
  프롬프트의 입력은 기본색). 꼬리가 없으면 프롬프트 없이 읽는다. 둘을 한 함수로 일반화하지 않았다(합성과 SGR 리셋이 다르다).
  `createRepl`이 REPL 리더와 같은 "`dispose()` 뒤 write 콜백을 전달하지 않는 터미널 뷰"(`00-architecture.md` 4.1, TRP-004)를 준다.
  `rewindTail`의 flush 콜백은 해제 여부를 스스로 알 수 없다. `input()` 시작 전에 친 키(프롬프트 글자가 그려진 뒤 `readline.read()`가 시작되기 전, 실행 중 포함)는 벤더 readline이 버리지 않고 쌓았다가 읽기가 시작될 때 재생해 `input()` 값이 된다(RD-019, `06-editing.md` 6.7, 편차 32 해소). 읽기당 소비라 첫 줄만 값이 되고 나머지는 다음 읽기가 받는다.

참고: `/work/cp949/pyodide-samples/apps/repl/docs/design/02b-input-ctrl-c.md`,
이전 구현 설계 문서 `11-stdin-prompt.md`,
`/work/cp949/pyodide-samples/apps/repl/src/repl/{stdin-callback,read-guard,stdin-reader,output-tail}.ts`

