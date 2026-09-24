# repl `dist/index.d.mts`가 `CopyResult`를 terminal `./internal`에서 import한다

Status: deferred
Origin: RD-022 부품 이동(repl → terminal). repl 공개 export `CopyResult`의 정의가 terminal로 옮겨졌다.

## 현상

repl 공개 export 이름 diff는 0이고 `pnpm smoke:pack`(소비자 `tsc`, `skipLibCheck: false`)이 통과한다. 다만 repl `dist/index.d.mts`가 `import { CopyResult } from "@cp949/runo-pyodide-terminal/internal"`를 갖는다. terminal `./internal`은 repl 전용이고 안정성을 보장하지 않는 서브패스(lockstep)라, repl 소비자에게 그 타입 import가 새어 나간다. repl 소비자는 terminal 패키지도 설치해야 한다(repl `dependencies`라 자동 설치된다).

## 완료 기준

repl이 `CopyResult`를 자체 정의하거나 terminal `.`(공개 진입점)에서 export해 repl `.d.mts`가 `./internal`을 참조하지 않는다. `dist/index.d.mts`의 `./internal` import 0건, repl 공개 export 이름 diff 0, `pnpm smoke:pack` 통과.

## 재개 조건

RD-023 이후 패키지 공개 방침(npm 배포 여부·`./internal` 노출 범위)을 정할 때, 또는 repl을 terminal 없이 단독 배포해야 할 때. 그 전에는 조사하지 않는다.

## Comments

- 2026-09-24 등록 시점 분류: 소비자에게 보이는 결함이 관찰되지 않았고(스모크 통과) 방침 결정이 선행돼야 해 `deferred`.
- 2026-09-25 RD-024 관찰: `pnpm smoke:pack`에 react tarball을 더한 뒤(5개 tarball, 소비자 `tsc --noEmit` `skipLibCheck: false`) 통과했다(2026-09-25 마지막 통합, 진입점 import 8개·설치 트리에 coincident·reflected-ffi 없음). repl `dist/index.d.mts`는 여전히 `CopyResult`를 `@cp949/runo-pyodide-terminal/internal`에서 import한다(react `dist/index.d.mts`는 terminal `.`에서 import). 소비자가 결함으로 관찰한 것은 없어 `deferred` 유지.
