# Context Map

## Contexts

- [pyodide-core](./packages/pyodide-core/CONTEXT.md): 공통 부분. 프로토콜(RPC·메일박스·interrupt buffer·초기화 프레임), worker 커널(`runWorker`), main 세션(`startCoreSession`)과 driver 경계의 용어. UI·xterm·coincident 비의존, private(RD-020, [ADR-0006](./docs/adr/0006-pyodide-core-and-plugin-packages.md)).
- [pyodide-repl](./packages/pyodide-repl/CONTEXT.md): REPL driver와 REPL 프런트. main 쪽(터미널·읽기·인터럽트 송신 연결)과 worker 쪽(콘솔 확장·제출 러너·REPL 루프)의 용어. core의 용어는 core `CONTEXT.md`를 따른다.
- xterm-readline (`packages/xterm-readline`): 벤더링한 줄 편집기. 용어는 원본(`Readline`, `History`, `State`, `Tty`, `InputType`)을 그대로 쓰고 별도 `CONTEXT.md`를 두지 않는다.
- pyodide-testkit (`packages/pyodide-testkit`): 시험 전용 도우미(`spawnRole` 하니스·가짜 터미널·패키지 경계 도우미). private이고 pack 대상이 아니며 고유 용어가 없어 별도 `CONTEXT.md`를 두지 않는다.
- demo (`apps/demo`): 데모 셸. 고유 용어가 없고 pyodide-repl의 용어를 그대로 쓴다.

## Relationships

- **demo → pyodide-repl**: `createRepl()`을 호출하고 `ReplHandle`·상태 콜백만 다룬다. 프로토콜과 터미널 내부에 접근하지 않는다. core를 직접 import하지 않는다.
- **pyodide-repl → pyodide-core**: core의 프로토콜·`startCoreSession`·`runWorker`와 driver 경계(`MainDriver`·`WorkerDriver`)를 쓰고, REPL 전용 부분을 driver로 채운다. core는 repl을 import하지 않는다(의존 방향 repl → core).
- **pyodide-core → (없음)**: 작업공간 내부 의존이 없다. xterm·`@cp949/runo-xterm-readline`·coincident에 의존하지 않고 시험이 강제한다(`docs/design/09-testing.md` 9.8).
- **pyodide-repl → xterm-readline**: export된 공개 API만 사용한다. private 멤버 래핑은 하지 않는다([ADR-0003](./docs/adr/0003-vendor-xterm-readline.md)).
- **main ↔ worker (core 프로토콜)**: `docs/design/01-protocols.md`의 채널 3종으로만 통신한다. 채널·초기화 프레임·세션 게이트는 core, 그 위의 REPL 메시지(`readLine`·`writeOutput`·`writeError`·`complete`)는 repl driver가 얹는다.
- **시험 도우미 (pyodide-testkit)**: core·repl이 devDependencies로만 쓴다. 시험 전용 worker 역할 스크립트(`packages/pyodide-core/src/test/roles/`)는 core에 있다(testkit이 core를 import하는 순환을 피한다).
