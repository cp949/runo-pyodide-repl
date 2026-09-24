# pyodide-react

React 컴포넌트·hook으로 core·terminal·repl을 감싸는 패키지(RD-024). 골격 단계이며 공개 export는 아직 없다. 컴포넌트가 xterm `Terminal` 생성·`FitAddon` 리사이즈·dispose·StrictMode 이중 마운트를 처리한다. coincident에 의존하지 않는다. main·worker·세션·읽기·인터럽트 용어는 `packages/pyodide-repl/CONTEXT.md`, runner·실행창은 `packages/pyodide-terminal/CONTEXT.md`, driver·core 세션은 `packages/pyodide-core/CONTEXT.md`를 따른다. 규칙 본문은 `docs/design/15-react.md`(작성 예정).

## Language

용어는 컴포넌트·hook 구현(DELTA-02~04)과 함께 채운다.
