# 프로토콜: RPC·stdin 메일박스·interrupt buffer·초기화 프레임

`00-architecture.md` 2절의 채널 세 개와 초기화 프레임의 정확한 형식이다. 이 문서의 상수·상태 전이가 `packages/pyodide-repl/src/protocol/`의 계약이고, 시험은 이 문서를 기준으로 쓴다.

## 1. RPC (MessagePort 위 요청/응답/알림)

### 1.1 메시지 형식

```ts
type RpcMessage =
  | { kind: 'req'; id: number; name: string; args: unknown[] }        // 응답을 기다린다
  | { kind: 'res'; id: number; ok: true;  result: unknown }
  | { kind: 'res'; id: number; ok: false; error: string }             // 핸들러가 던진 값의 String()
  | { kind: 'ntf'; name: string; args: unknown[] }                    // 응답 없음
```

- 값은 구조적 복제로 그대로 간다. `null`은 `null`로 도착한다(이전 구현의 TRP-010 같은 변환이 없다).
- `id`는 보내는 쪽에서 1부터 증가. 양쪽이 독립 카운터를 가져도 `res`는 요청을 보낸 쪽에서만 해석하므로 충돌하지 않는다.
- 핸들러가 없는 `req`는 `ok: false, error: 'unknown method <name>'`로 답한다. 없는 `ntf`는 버린다. 핸들러 표는 own 속성만 본다(`toString` 같은 `Object.prototype` 이름은 없는 메서드다).
- 알림 핸들러가 던지거나 reject하면 응답 통로가 없으므로 `console.error("[rpc] 알림 핸들러 예외", name, error)`를 남기고 다음 메시지를 계속 처리한다.
- `dispose()`는 대기 중 요청을 모두 `Error('rpc disposed')`로 reject하고 포트를 닫는다. 두 번 불러도 안전하고, `dispose()` 뒤의 `call()`은 보내지 않고 바로 같은 오류로 reject한다(닫힌 포트의 응답은 오지 않는다).
- 알려진 한계: 핸들러 결과는 구조적 복제가 가능해야 한다. 복제할 수 없는 값(함수 등)을 돌려주면 응답 `postMessage`가 `DataCloneError`를 던지고 호출자는 응답을 받지 못해 멈춘다. 현재 핸들러 결과(문자열·`null`·`{completions, start}`)에서는 재현되지 않는다.

### 1.2 메서드 표

| 이름 | 종류 | 방향 | 인자 | 결과 | 시점 |
| --- | --- | --- | --- | --- | --- |
| `readLine` | req | worker→main | `prompt: string, pending: string \| undefined, cancelable: boolean` | `string \| null`(취소) | REPL 루프가 한 줄을 읽을 때 |
| `complete` | req | main→worker | `source: string, pending: string \| undefined` | `{ completions: string[], start: number }` | Tab. worker는 프롬프트 대기 중에만 계산 |
| `readInput` | ntf | worker→main | `cancelable: boolean` | — | stdin 콜백 진입. 이 알림 직후 worker는 메일박스 대기에 들어간다 |
| `write` | ntf | worker→main | `text: string` | — | stdout 조각(개행 미강제) |
| `writeErrorRaw` | ntf | worker→main | `text: string` | — | stderr 조각(개행 미강제, main이 빨강) |
| `writeOutput` | ntf | worker→main | `text: string` | — | 값 에코·배너(main이 개행을 붙인다) |
| `writeError` | ntf | worker→main | `text: string` | — | 트레이스백·SyntaxError(main이 개행·빨강) |
| `ready` | ntf | worker→main | `{ pyodideVersion: string }` | — | 콘솔 생성 뒤 REPL 루프 직전 |
| `loadFailed` | ntf | worker→main | `message: string` | — | pyodide 로드 실패. worker는 살아 있고 루프에 들어가지 않는다 |
| `sessionTerminated` | ntf | worker→main | — | — | `exit()`/`quit()`/`SystemExit` |

`loadFailed`의 `message`는 worker의 `String(error)`이고 main이 `pyodide 로드 실패: ` 접두사를 붙여 `writeError`로 낸다(빨강 + 개행). pyodide 로드뿐 아니라 콘솔 생성 실패도 같은 알림으로 온다.

main→worker 알림은 없다. 설정은 초기화 프레임(4절)으로만 간다.

### 1.3 순서 규칙

- 한 세션의 모든 RPC 메시지는 **같은 포트**를 탄다. MessagePort는 FIFO이므로 worker가 `write("x: ")` 뒤에 `readInput`을 보내면 main은 반드시 그 순서로 받는다.
- `readInput` 알림은 `mailbox.wait()` **직전**에 보낸다. `postMessage`는 호출 즉시 큐에 들어가므로 뒤이어 worker가 `Atomics.wait`로 멈춰도 main에 전달된다.
- worker가 메일박스 대기 중이면 포트에 도착한 `complete` 요청은 worker가 깨어난 뒤 처리된다. main의 Tab 리더는 `input()` 읽기 중 Tab을 요청하지 않으므로 이 경우는 생기지 않는다.

## 2. stdin 메일박스 (SharedArrayBuffer)

`input()`·`sys.stdin` 읽기 한 건의 응답을 main이 worker에 동기적으로 넘기는 단방향 우편함이다. 세션(worker)마다 새로 만든다.

### 2.1 배치

```ts
const CAPACITY = 64 * 1024                       // 데이터 바이트. 고정 크기(ADR-0002)
const sab  = new SharedArrayBuffer(16 + CAPACITY)
const ctrl = new Int32Array(sab, 0, 4)           // [STATE, BYTE_LENGTH, FLAGS, RESERVED]
const data = new Uint8Array(sab, 16, CAPACITY)

const STATE = 0, BYTE_LENGTH = 1, FLAGS = 2
const IDLE = 0, READY = 1, CANCELLED = 2, ERROR = 3   // ctrl[STATE]
const FLAG_LAST = 1                                   // ctrl[FLAGS] 비트: 마지막 청크
```

- 한 줄은 UTF-8로 인코딩해 `CAPACITY` 이하 청크로 나눈다. 대부분의 입력은 청크 1개다. 청크 경계는 바이트 단위라 UTF-8 시퀀스 중간일 수 있으므로 worker는 `TextDecoder`를 `{ stream: true }`로 이어 붙이고 마지막 청크 뒤 `decode()`로 닫는다.
- growable `SharedArrayBuffer`는 쓰지 않는다. 필요한 최대 용량을 먼저 정해 고정 할당한다(runo-reflected-ffi ADR-0002와 같은 방침).

### 2.2 worker `wait(): string | null`

```text
전제: ctrl[STATE] == IDLE, 이 세션에 진행 중인 다른 wait 없음(stdin 콜백은 재진입하지 않는다)
loop:
  Atomics.wait(ctrl, STATE, IDLE)              # IDLE인 동안 잔다. 타임아웃 없음
  s = Atomics.load(ctrl, STATE)
  READY:     chunk = data[0 .. ctrl[BYTE_LENGTH]) 복사 → decoder에 이어 붙임
             last = ctrl[FLAGS] & FLAG_LAST
             Atomics.store(ctrl, STATE, IDLE); Atomics.notify(ctrl, STATE)   # main의 다음 청크 신호
             if last: return decoder.decode()
             continue
  CANCELLED: Atomics.store(ctrl, STATE, IDLE); Atomics.notify(ctrl, STATE); return null
  ERROR:     msg = data[0 .. BYTE_LENGTH) UTF-8 디코드; Atomics.store(ctrl, STATE, IDLE); Atomics.notify(ctrl, STATE); throw new Error(msg)
```

- `Atomics.wait`는 worker에서만 허용된다. 코어의 worker 쪽에서만 부른다.
- IDLE로 되돌릴 때는 세 경로(READY·CANCELLED·ERROR) 모두 `Atomics.notify`한다. main이 취소·오류 표식을 worker가 가져가기 전에 다음 `deliver`를 부르면 `untilIdle()`이 IDLE 복귀를 기다리는데, notify가 없으면 그 대기가 깨어나지 않는다.
- `null`은 취소 표식이고, stdin 콜백이 `03`·`04`의 규칙으로 `KeyboardInterrupt`로 바꾼다. pyodide `setStdin` 콜백에 `null`을 그대로 돌려주면 EOF가 되므로(`11-known-traps.md` TRAP-05) 이 값은 콜백 밖으로 새지 않는다.

### 2.3 main `deliver(text)` / `cancel()` / `fail(message)`

```text
deliver(text):
  bytes = TextEncoder().encode(text)
  for each chunk of bytes by CAPACITY (빈 문자열이면 빈 청크 1개):
    await untilIdle()                                   # 직전 청크를 worker가 가져갈 때까지
    data.set(chunk); ctrl[BYTE_LENGTH] = chunk.length; ctrl[FLAGS] = isLast ? FLAG_LAST : 0
    Atomics.store(ctrl, STATE, READY); Atomics.notify(ctrl, STATE)
cancel():  await untilIdle(); Atomics.store(ctrl, STATE, CANCELLED); Atomics.notify(ctrl, STATE)
fail(msg): await untilIdle(); data ← encodeInto(msg)(완전한 문자만 쓰므로 넘치면 문자 경계에서 잘린다); BYTE_LENGTH; Atomics.store(ctrl, STATE, ERROR); notify

untilIdle():
  Atomics.load(ctrl, STATE) == IDLE이면 즉시.
  아니면 Atomics.waitAsync가 있으면 Atomics.waitAsync(ctrl, STATE, <현재값>).value를 await,
  없으면 setTimeout(1ms) 폴링.
```

- 폴링 간격은 `POLL_INTERVAL_MS = 1`(ms)로 확정했다. 브라우저의 중첩 타이머 클램프(약 4ms)가 실제 간격을 늘려도 이 대기는 64KiB를 넘는 입력의 청크 사이에서만 돌아 정확성에는 영향이 없다. `Atomics.waitAsync` 유무는 호출 시점에 확인한다(Chromium 148은 메인·Worker 모두 있다. Firefox·WebKit은 미확인).

- main은 `readInput` 알림을 받은 뒤에만 쓴다. 알림 없이 쓰면 worker가 없는 값을 다음 읽기에서 가져간다.
- `deliver`·`cancel`은 둘 중 하나만, 한 번만 부른다. read-guard와 readline이 한 읽기에 한 결과만 내는 것으로 보장한다.
- worker가 `terminate()`로 죽으면 대기 중 값은 버려진다. 메일박스는 세션마다 새로 만들므로 다음 세션에 섞이지 않는다.

### 2.4 시험

- node `worker_threads`에서 실제 `SharedArrayBuffer`로 왕복: 한 청크, 정확히 `CAPACITY` 바이트, `CAPACITY + 1` 바이트(2청크), 멀티바이트 문자가 청크 경계에 걸리는 경우, 빈 문자열, `cancel`, `fail`(넘치는 메시지의 문자 경계 절단 포함), worker가 표식을 가져가기 전에 main이 다음 `deliver`를 부르는 경우.
- 변이 검사: `readInput` 알림을 `wait()` 뒤로 옮기면 main이 알림을 받지 못하고 멈추는지, `FLAG_LAST`를 빼면 worker가 영원히 기다리는지.

## 3. interrupt buffer

```ts
const buffer = new Int32Array(new SharedArrayBuffer(4 * 4))
const SIGNAL = 0   // main이 2를 쓴다. pyodide 폴링이 읽고 0으로 비운다
const ACK    = 1   // worker만 올린다
const SEQ    = 2   // 요청 번호. 새 눌림마다 +1, 재전송은 같은 번호
//    [3]    예약
```

- 초기화 프레임으로 worker에 넘기고 `pyodide.setInterruptBuffer(buffer)`에 **그대로**(접근자·Proxy 없이) 연결한다.
- 세션 간 재사용한다. 새 worker를 만들기 직전 main이 송신기를 취소하고 `SIGNAL`을 0으로 비운다.
- 쓰기·ack·재전송·핸들러 규칙 전체는 `03-ctrl-c.md`에 있다. 새 SIGINT를 쓰는 곳은 main 송신기와 worker의 stdin 콜백(취소 변환) 둘뿐이다.

## 4. 초기화 프레임

```ts
interface InitFrame {
  kind: 'init'
  rpcPort: MessagePort            // transfer
  interruptBuffer: Int32Array     // SAB 뷰. 구조적 복제로 같은 메모리를 가리킨다
  stdinCtrl: Int32Array           // 메일박스 제어
  stdinData: Uint8Array           // 메일박스 데이터
  topLevelAwait: boolean
  pyodide: { indexURL: string }
}
```

- main: `worker.postMessage(frame, [frame.rpcPort])`. worker 생성 직후 첫 메시지로 보낸다.
- worker: 스크립트 최상단(첫 `await` 이전)에서 `addEventListener('message', once)`로 첫 메시지를 받고 `parseInitFrame`으로 검증한다. 검증 항목은 객체 여부, `kind === 'init'`, 필드 존재·타입, `interruptBuffer`·`stdinCtrl`·`stdinData`가 `SharedArrayBuffer` 위의 뷰인지다(비공유 뷰는 구조적 복제에서 복사돼 메모리 공유가 조용히 끊긴다, `docs/traps/TRP-002`). 실패하면 필드 이름을 담아 `console.error` 후 프레임을 무시한다. 이후 네이티브 `message` 채널은 쓰지 않는다.
- `SharedArrayBuffer` 뷰는 postMessage로 넘겨도 같은 메모리를 공유한다(coincident 프록시가 값으로 직렬화하던 문제가 없다).
- 설정 변경(`topLevelAwait`)은 새 프레임 = 새 worker다. worker가 main에 설정을 되묻는 호출은 없다.

## 5. 시퀀스

```text
(S1) 시작
main : Terminal/Readline 생성 → 채널 3종 생성 → createWorker() → postMessage(init, [port]) → onStatus('loading')
       (crossOriginIsolated가 거짓이면 위를 하지 않고 경고 한 줄 + onStatus('not-isolated')로 끝난다)
worker: init 수신 → loadPyodide → setStdout/setStderr(전역 Writer) → sys.ps1/ps2 → PyodideConsole → TLA 비트(프레임 값)
      → 핸들러 설치 → 버퍼 연결 → setStdin → 감시 타이머     (RD-004는 앞 다섯 단계까지, 뒤 넷은 후속 RD)
      → ntf ready → ntf writeOutput(BANNER) → req readLine('>>> ')   (RD-004는 readLine 대신 시험용 스크립트를 runLine으로 실행)
      로드·콘솔 생성 실패 → ntf loadFailed(String(error))만 보내고 돌아온다(worker는 살아 있다)
main : ready → onStatus('ready') → readLine 핸들러: 꼬리 + '>>> ' 합성 → readline.read()
       loadFailed → writeError('pyodide 로드 실패: ' + message) + onStatus('load-failed')

(S2) 한 줄 실행
main : Enter → res readLine("1+1")
worker: discardPendingInterrupt → runner.run → ntf writeOutput("2") → req readLine('>>> ')

(S3) input()
worker: run("x = input('x: ')") → stdout 콜백 → ntf write("x: ") → stdin 콜백 → ntf readInput(true) → mailbox.wait() [정지]
main : write → 화면·꼬리 "x: " → readInput → read-guard 통과 → 꼬리를 프롬프트로 readline.read()
       Enter "abc" → mailbox.deliver("abc")           |  Ctrl+C → mailbox.cancel()
worker: wait() = "abc" → 콜백 반환 → 실행 계속       |  wait() = null → signalInterrupt → checkInterrupt → KeyboardInterrupt

(S4) 실행 중 Ctrl+C
main : setCtrlCHandler → ntf 없이 sink.write("^C") → sender.send(): SEQ+1, SIGNAL=2, 5ms 점검
worker: 폴링 → 핸들러 → ack → KeyboardInterrupt → ntf writeError(traceback) → req readLine

(S5) Tab
main : Tab → req complete(source, pending)   ←  worker: atPrompt이면 계산 → res {completions, start}
main : 읽기가 살아 있고 버퍼·커서가 같으면 적용

(S6) 종료
worker: run("exit()") → {exit:true} → 감시 타이머 정지 → ntf sessionTerminated → 루프 종료(더 이상 readLine 없음)
main : 안내 표시. 복구는 reset()
```
