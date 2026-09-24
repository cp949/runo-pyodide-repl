# `PythonRunner`·`PythonRepl` props 타입이 `children`을 허용하고 xterm이 붙는 div 안에 렌더한다

Status: deferred
Origin: RD-024 병합 전 리뷰(코드 읽기 추정).

## 현상

`python-runner.tsx`·`python-repl.tsx`의 props는 `Omit<ComponentPropsWithoutRef<"div">, keyof Options>`라 `children`이 타입에 남아 있고, 컴포넌트는 `<div {...divProps} ref={containerRef} />`로 나머지 props를 그대로 펼친다. `children`을 주면 React가 자식을 xterm이 `terminal.open(container)`로 DOM을 붙이는 같은 div에 렌더한다. React가 관리하는 자식과 xterm DOM이 같은 부모를 공유해 재렌더·언마운트에서 충돌할 수 있다.

관찰하지 않았다. 브라우저에서 `children`을 준 화면을 만들어 보지 않았고 코드 읽기로만 추정했다.

## 완료 기준

`children`을 타입에서 제외한다(`Omit<…, "children">`). `expectTypeOf`로 `children` 전달이 타입 오류인 것을 시험한다. 기존 시험·`pnpm smoke:pack` 통과.

## 재개 조건

소비자가 `children`을 넘기는 사례가 나오거나 패키지 공개 방침을 정할 때(타입 표면 정리와 함께). 그 전에는 조사하지 않는다.

## Comments

- 2026-09-25 등록 시점 분류: 코드 읽기 추정이고 재현한 사용자 시나리오가 없어 `deferred`(`docs/agents/issue-tracker.md` "등록·분류 기준").
