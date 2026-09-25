# tarball의 `exports["."].development`가 배포되지 않은 `./src`를 가리킨다

Status: done
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
- 2026-09-25 재분류·종결(RD-023 DELTA-01): `deferred` → `done`. RD-023이 새 패키지(dom-bridge)를 같은 형태로 만들기 전에 결함을 고쳤다(RD-023 첫 DELTA 후보였다).
- **재현됨**(위 "현상"의 Vite 추정이 사실로 확인됐다): tarball 설치본에 대해 `smoke:pack`에 넣은 Vite 해석 검사(vite `8.3.0` = demo와 같은 버전, `createServer` middleware 모드 client 환경 `pluginContainer.resolveId`)가 공개 진입점 8개 전부에서 `null`("해석 실패")을 돌려줬고 `./package.json` 5개만 통과했다. 정적 검사(tarball `exports`의 모든 대상이 tarball 파일 목록에 있는지)는 5개 패키지에서 실패했다(없는 대상: xterm-readline 1/4, core 2/7, terminal 2/7, repl 2/7, react 1/4, 전부 `development` → `./src/…ts`). 추가 사실: Vite는 `development` 조건의 대상 파일이 없어도 다음 조건(`types`·`default`)으로 넘어가지 않고 오류 없이 `null`을 돌려준다. 같은 위치에 빈 `src/index.ts`를 두면 그 파일로 해석된다(`development`가 먼저 선택됨).
- **방법**: `publishConfig.exports`(후보 중 pack 뒤 매니페스트 치환은 쓰지 않았다). 6개 패키지(xterm-readline·core·terminal·repl·react와 새 dom-bridge)의 `package.json`이 `development`를 뺀 `exports`를 `publishConfig.exports`에 둔다. `pnpm pack`(pnpm 11.25.0)이 이것을 tarball `package.json`의 `exports`로 쓰고 `development`·`publishConfig` 필드는 남지 않는다(직접 추출 확인). 작업공간 해석(demo·vitest)은 기존 `exports`를 그대로 쓴다(`pnpm --filter demo build` 통과).
- **검사**: 루트 `pnpm smoke:pack`이 두 단계를 상시로 돈다. (a) tarball `exports` 정적 검사(6개 패키지, 대상 없음 0), (b) 소비자 임시 폴더에서 Vite dev 해석(주 소비자 8개 진입점, dom-bridge 소비자 6건, 해석된 파일이 설치본에 존재). 수정 전 (a) RED·(b) 재현, 수정 후 둘 다 통과를 확인했다. 규칙은 `docs/design/09-testing.md` 9.8.3, `docs/design/00-architecture.md` 4.4.
- 남은 한계(별도 이슈로 만들지 않았다): Vite 해석은 client 환경 한 가지다(SSR `ssr.resolve.conditions`·`optimizeDeps` 사전 번들 경로는 보지 않는다). 진입점을 추가할 때 `exports`·`publishConfig.exports`·`scripts/pack-smoke.mjs`를 손으로 맞춘다: `.scratch/dom-bridge-followups/issues/02-smoke-pack-entry-points-manual-sync.md`(`deferred`).
