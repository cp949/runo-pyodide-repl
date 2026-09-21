# Context Map

## Contexts

- [pyodide-repl](./packages/pyodide-repl/CONTEXT.md): REPL 코어. main 쪽(터미널·읽기·인터럽트 송신)과 worker 쪽(pyodide·콘솔·SIGINT 핸들러), 둘을 잇는 프로토콜의 용어.
- xterm-readline (`packages/xterm-readline`): 벤더링한 줄 편집기. 용어는 원본(`Readline`, `History`, `State`, `Tty`, `InputType`)을 그대로 쓰고 별도 `CONTEXT.md`를 두지 않는다.
- demo (`apps/demo`): 데모 셸. 고유 용어가 없고 pyodide-repl의 용어를 그대로 쓴다.

## Relationships

- **demo → pyodide-repl**: `createRepl()`을 호출하고 `ReplHandle`·상태 콜백만 다룬다. 프로토콜과 터미널 내부에 접근하지 않는다.
- **pyodide-repl → xterm-readline**: export된 공개 API만 사용한다. private 멤버 래핑은 하지 않는다([ADR-0003](./docs/adr/0003-vendor-xterm-readline.md)).
- **main ↔ worker (pyodide-repl 내부)**: `docs/design/01-protocols.md`의 채널 3종으로만 통신한다.
