# `fitNow`가 addon-fit 예외를 삼키지 않아 마운트 시 컴포넌트가 실패하거나 rAF 경로에서 uncaught가 된다

Status: deferred
Origin: RD-024 병합 전 리뷰. `TRP-062`의 원문 표현("오류 없이 무동작")이 실제 코드와 달라 정정하며 발견.

## 현상

`packages/pyodide-react/src/terminal-view.ts`의 `fitNow()`는 `addon.fit()`을 try/catch 없이 부른다. `@xterm/addon-fit` 0.11.0의 `fit()`·`proposeDimensions()`도 비공개 경로(`terminal._core._renderService`)를 검사 없이 읽는다. 그 경로가 사라지면(xterm·addon-fit 버전 변경 등) `TypeError`가 난다.

- 마운트 때 첫 `fitNow()`: `mountTerminalView`가 만든 `Terminal`을 dispose하고 다시 던진다. 컴포넌트의 마운트 effect가 실패하므로 오류 경계가 없으면 트리 전체가 언마운트된다.
- `ResizeObserver` → rAF 경로: rAF 콜백의 uncaught 예외(`pageerror`)가 되고 `fit`만 동작하지 않는다.

코드 읽기로 유도했다. 경로를 지운 xterm으로 재현하지는 않았다(현재 xterm 6.0.0 + addon-fit 0.11.0은 경로가 있고 `e2e:react-fit` 12/12 통과).

## 완료 기준

정책을 정한다: (a) 예외를 삼키고 `fit`을 끈 채 80×24로 동작(콘솔 경고 1회), (b) 지금처럼 던짐(버전 올릴 때 `e2e:react-fit`이 잡음, `TRP-062`). (a)를 고르면 addon 예외를 주입한 시험(마운트 시·rAF 경로)이 컴포넌트가 실패하지 않는 것을 확인한다.

## 재개 조건

`@xterm/xterm`·`@xterm/addon-fit` 버전을 올릴 때, 또는 `fit` 실패가 소비자 화면 전체를 깨뜨린 사례가 나올 때. 그 전에는 조사하지 않는다.

## Comments

- 2026-09-25 등록 시점 분류: 정책 결정이 선행돼야 하고 실제 실패를 관찰하지 않아 `deferred`. `docs/traps/TRP-062`와 `15-react.md` 15.5를 실제 동작에 맞게 정정했다.
