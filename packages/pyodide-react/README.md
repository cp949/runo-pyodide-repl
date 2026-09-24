# @cp949/runo-pyodide-react

`@cp949/runo-pyodide-core`·`-terminal`·`-repl`을 React 컴포넌트(`PythonRunner`·`PythonRepl`)와 hook(`usePythonRunner`)으로 감싸는 패키지. private이며 배포는 `pnpm pack` tarball이다(`pnpm smoke:pack`이 설치·import·타입 해석을 확인한다). coincident에 의존하지 않는다(`src/package-boundary.test.ts`).

상태: 골격(RD-024 DELTA-01). 공개 export는 아직 없다.

## 의존

- dependencies: `@cp949/runo-pyodide-core`·`-terminal`·`-repl`(`workspace:*`), `@xterm/addon-fit`(0.11.0)
- peerDependencies: `react`·`react-dom`(`^19.0.0`), `@xterm/xterm`(`^6.0.0`)
- `xterm.css`는 패키지가 import하지 않는다. 소비자가 `@xterm/xterm/css/xterm.css`를 import한다.
