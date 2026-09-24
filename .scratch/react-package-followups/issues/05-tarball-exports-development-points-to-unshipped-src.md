# tarball의 `exports["."].development`가 배포되지 않은 `./src`를 가리킨다

Status: deferred
Origin: RD-024 사후 리뷰(2026-09-25). react 패키지에서 발견했으나 RD-024 전부터 core·terminal·repl·xterm-readline에도 같은 형태로 있다.

## 현상

`packages/{xterm-readline,pyodide-core,pyodide-terminal,pyodide-repl,pyodide-react}/package.json`의 `exports` 각 진입점에 `"development": "./src/…ts"` 조건이 있다. `files`는 `["dist"]`(xterm-readline은 `LICENSE-MIT` 추가)라서 `pnpm pack` tarball에는 `src/`가 없다. `publishConfig`로 `exports`를 바꾸지 않으므로 tarball의 `package.json`도 `development` 조건을 그대로 담는다.

- `pnpm smoke:pack`은 Node ESM과 `tsc` `NodeNext`로 검사한다. 둘 다 `development` 조건을 쓰지 않아 통과한다.
- Vite dev는 기본 해석 조건에 `development`를 넣는다. 그래서 tarball을 설치한 Vite 소비자(`runo-pyodide-canvas`·`runo-lab`)의 dev 서버는 없는 `./src/index.ts`로 해석할 수 있다. 이 부분은 코드 읽기로 추정한 것이고 재현하지 않았다.
- `09-testing.md` 9.8의 "번들러(Vite)의 `development` 조건은 검사하지 않는다(데모 빌드가 덮는다)"는 작업공간 소스를 쓰는 데모에만 맞고 tarball 소비자에는 맞지 않는다.

## 완료 기준

tarball을 설치한 Vite 소비자에서 `vite`(dev)로 `@cp949/runo-pyodide-react`(또는 core)를 import해 해석 결과를 확인한다. 재현되면 tarball에서 `development` 조건을 빼는 방법을 정한다. 후보는 `publishConfig.exports`와 pack 뒤 매니페스트 치환이다. 결정한 방법은 `pnpm smoke:pack`에 "tarball `exports`에 배포 파일에 없는 대상이 없음" 검사로 넣는다.

## 재개 조건

소비자 저장소가 tarball을 Vite dev로 처음 쓸 때, 또는 `smoke:pack`에 Vite 소비자 단계를 더할 때. 그 전에는 조사하지 않는다.

## Comments

- 2026-09-25 등록 시점 분류: 실측이 없는 코드 읽기 추정이고 RD-024 범위 밖(5개 패키지 공통)이라 `deferred`.
