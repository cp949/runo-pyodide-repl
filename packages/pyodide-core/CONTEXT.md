# pyodide-core

REPL·실행 driver가 공유하는 프로토콜·worker 커널·main 세션. UI·xterm·coincident에 의존하지 않는다. private이고 공개 API로 확정하지 않은 내부 계약이다(RD-020). 코드·문서·시험 이름에 쓰는 용어를 정의한다. main·worker·세션·읽기·인터럽트·채널의 일반 용어는 `packages/pyodide-repl/CONTEXT.md`를 따르고, 여기서는 core가 도입한 용어만 정의한다.

## Language

### 경계

**core**:
`@cp949/runo-pyodide-core`. 프로토콜(RPC·메일박스·interrupt buffer·초기화 프레임), worker 커널, main 세션을 한 벌로 가진다. 화면·줄 편집·REPL 루프는 모른다.
_Avoid_: 엔진, 런타임

**driver**:
core가 세션 동안 부르는, 소비자(REPL 등)가 채우는 인터페이스. main 쪽 `MainDriver`(`session/driver.ts`)와 worker 쪽 `WorkerDriver`(`worker/driver.ts`) 둘이 한 쌍이다. driver가 화면 상호작용과 세션 제어 흐름을 내고, core가 공통 순서·게이트·종료를 소유한다.
_Avoid_: 플러그인(`plugins`는 RD-023의 별개 개념), 콜백 모음, 어댑터

**driver 옵션**:
초기화 프레임의 `driver` 필드(`InitFrame.driver: unknown`). core는 값의 모양을 모르고 필드가 있는지만 검증한다. worker 쪽 `WorkerDriver.parseOptions(frame.driver)`가 값을 검증한다. REPL은 `{ topLevelAwait }`.
_Avoid_: 설정, config

### main 쪽

**core 세션**:
`startCoreSession`이 만드는 main 쪽 세션 한 개. worker·`MessageChannel`·메일박스·초기화 프레임·RPC·`readInput` 처리·게이트·크래시·종료를 소유한다. `reset()`은 core 세션을 통째로 교체한다.
_Avoid_: 세션 매니저

**게이트**:
core 세션의 `pythonRunning = alive && inputReadsPending === 0 && !driver.isIdle()`. 거짓이면 Ctrl+C를 에코도 전송도 하지 않는다. `alive`·`inputReadsPending`은 core가, `isIdle`은 driver가 낸다.
_Avoid_: running 플래그

**`isIdle`**:
driver가 내는 "대상 Python 코드가 없어 Ctrl+C를 보낼 곳이 없는 구간인가". REPL은 `readLinePending || cancelSettling`이다.

**출력 조각**:
`OutputChunk = { stream: "stdout" | "stderr", text }`. core가 `write`·`writeErrorRaw` 알림을 세션 `output` 콜백에 넘기는 형식. Python이 쓴 원문이며 줄 끝 처리·색은 소비자가 정한다. `writeOutput`·`writeError`(값 에코·트레이스백)는 core가 아니라 driver 핸들러다.
_Avoid_: 로그 줄

**핸들러 합성**:
RPC 끝점을 만들 때 core 핸들러 표와 driver 핸들러 표를 `composeRpcHandlers`로 한 표로 합치는 것. 이름이 겹치면 생성 시 예외이고 늦은 등록 API는 없다. main 쪽 core 표(`CORE_MAIN_HANDLER_NAMES`, worker → main)와 worker 쪽 core 표(main → worker)는 방향이 반대인 별개 끝점의 표다.
_Avoid_: 등록, 미들웨어

**읽기 seam**:
`MainDriver.readInput(cancelable)`. `input()`·`sys.stdin` 읽기 한 건을 driver가 수행해 줄 또는 `null`(취소)로 돌려주는 내부 경계다. 공개 `InputProvider`가 아니다(RD-022). `isReadCancelled(error)`는 "읽기가 끝나 응답 없이 버린다"는 오류를 driver가 판정하게 한다(core가 터미널 라이브러리를 import하지 않는다).

### worker 쪽

**worker 커널**:
`runWorker({ driver })`·`bootWorker`. 초기화 프레임 수신 → driver 옵션 검증 → RPC 생성 → pyodide 로드 → `driver.createConsole` → webloop 억제 → Ctrl+C 연결 → `setStdin` → `ready` → 감시 타이머 → `driver.run` 순서를 소유한다.
_Avoid_: 부트로더, 런처

**init 필터**:
`runWorker`가 모듈 본문에서 동기로 거는 `message` 리스너. `kind: "init"`인 객체만 소비한다. 배열 메시지(다른 프로토콜)는 넘기고, `kind`가 다른 메시지는 오류를 남기되 리스너를 유지한다. init 후보를 받으면 리스너를 뗀다.
_Avoid_: 첫 메시지 리스너, once 리스너

**콘솔 뼈대**:
`installStdioWriters`(전역 stdout/stderr Writer)와 `createCoreConsole`(`PyodideConsole` 생성 + 콜백, 파일명 기본 `<console>`). `sys.ps1/ps2`·TLA 비트·헬퍼 namespace는 driver가 그 사이·뒤에 끼운다.
_Avoid_: 콘솔 베이스

**worker 세션**:
`WorkerDriver.createSession(options)`가 돌려주는 worker 한 개의 driver 상태(`handlers`·`createConsole`·`run`·`atPrompt`). 상태는 클로저에 둔다. worker 하나마다 새로 만든다.
_Avoid_: 싱글턴 driver

### 소비자 요구

**core 타입 소비자**:
core `./worker`의 `.d.mts`를 import하는 코드. 그 파일이 `pyodide`·`pyodide/ffi` 타입을 import하는데 core는 `pyodide`를 배포 의존으로 선언하지 않으므로, 소비자가 `pyodide`(+`@types/node`·`@types/emscripten`)를 직접 설치해야 한다(`docs/design/00-architecture.md` 4.4, `09-testing.md` 9.8.3). repl만 쓰는 소비자는 해당하지 않는다.
