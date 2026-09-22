# apps/demo/e2e

실제 xterm 6 + 실제 브라우저(chromium)로 데모를 조작하는 Playwright 하니스.
`lib.mjs` 하나만 저장소에 둔다. 각 RD의 확인 스크립트 자체는 `_works/<작업>/verify/`에 두고
`import { open, ... } from "<repo>/apps/demo/e2e/lib.mjs"`로 이 파일만 가져온다(복사 금지).

## 실행 전제

- `pnpm --filter demo dev`(포트 5173) 또는 `pnpm --filter demo build && pnpm --filter demo preview`가 떠 있어야 한다.
- `pnpm exec playwright install chromium`이 끝나 있어야 한다(devDependency `playwright`, `apps/demo/package.json`).

## 스크립트 위치 규칙

- `apps/demo/e2e/lib.mjs`: 공용 하니스(화면 읽기·입력·대기·pageerror 계수). eslint·tsc 대상 밖
  (`apps/demo/eslint.config.js`의 `ignores: ["e2e/**"]`, `tsconfig.json`의 `include`가 `src`뿐).
- `_works/<yyyyMMdd>-NN-<작업>/verify/*.mjs`: RD별 확인 스크립트. 저장소에 커밋되지 않는다
  (`_works/`는 `.gitignore` 대상).
