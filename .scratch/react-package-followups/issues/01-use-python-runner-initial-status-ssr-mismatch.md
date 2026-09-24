# `usePythonRunner` 첫 렌더 `status`가 `crossOriginIsolated`에 의존해 SSR 하이드레이션이 어긋난다

Status: open
Origin: RD-024 병합 전 리뷰. `renderToString`으로 재현(2026-09-25).

## 현상

`usePythonRunner`의 `status` 초기값이 `initialRunnerStatus()`(`packages/pyodide-react/src/use-lifecycle.ts`)이고 `globalThis.crossOriginIsolated === true`면 `"loading"`, 아니면 `"not-isolated"`다(`use-python-runner.ts`의 `useState(initialRunnerStatus)`). Node 서버에는 `crossOriginIsolated`가 없어 서버 렌더는 `"not-isolated"`, 격리된 브라우저의 하이드레이션 첫 렌더는 `"loading"`이다. `status`를 화면에 그리면 React가 하이드레이션 불일치를 보고한다.

재현: `// @vitest-environment node`에서 `renderToString(<V />)`(`V`는 `usePythonRunner`의 `status`를 `<span>`에 그림)을 `crossOriginIsolated` 미정의와 `true`에서 각각 호출하면 결과 문자열이 다르다(서버 `not-isolated`, 격리 클라이언트 `loading`). 임시 시험이었고 저장소에는 없다.

`docs/design/15-react.md`는 SSR 시험을 하지 않는다고 적고 있다(범위 밖). 컴포넌트(`PythonRunner`·`PythonRepl`)는 `status`를 렌더에 쓰지 않아 영향이 없고 hook 반환값을 그리는 소비자만 해당한다.

## 완료 기준

서버 렌더와 격리된 클라이언트의 첫 렌더가 같은 `status`를 돌려준다(`renderToString`과 `hydrateRoot` 시험 또는 같은 문자열 단정). 마운트 뒤 `status`는 지금처럼 `crossOriginIsolated`에 맞는 값(`loading`·`not-isolated`)으로 바뀐다. 기존 `use-python-runner.test.tsx` 통과.

## 제안

`useSyncExternalStore`의 `getServerSnapshot`을 고정값(`"loading"` 또는 `"not-isolated"`)으로 하거나, 초기값을 고정하고 마운트 effect의 첫 `onStatus`(또는 마운트 직후 `runner.status` 읽기)가 덮어쓰게 한다. 어느 쪽이든 고정 초기값이 어느 상태여야 깜빡임이 덜한지 결정이 필요하다.

## Comments

- 2026-09-25 등록: 재현 가능한 코드 결함(SSR 소비자)과 관찰 가능한 완료 기준이 있어 `open`. SSR은 RD-024 범위 밖이라 우선순위는 낮다.
