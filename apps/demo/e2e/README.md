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

## 도우미(RD-012)

- `waitStatus(values, label, timeout)`: `[data-testid=status]` 텍스트가 `values` 중 하나가 될 때까지 기다린다.
- `setTopLevelAwait(on)`: top-level await 체크박스를 `on`에 맞춘다(같으면 무동작, 다르면 클릭 뒤 리셋 완료까지 기다린다).

## 도우미(RD-017, 선택 복사)

`open()`이 반환하는 핸들의 메서드가 아니라 `page`를 첫 인자로 받는 독립 함수다(`open` 자체와 같은 형태).

- `selectRows(page, fromRow, fromCol, toRow, toCol, { endOutside })`: 행·열 좌표(`.xterm-rows > div`의
  `getBoundingClientRect()`)로 마우스 드래그 선택을 만든다. `endOutside: true`면 같은 행의 y를 유지한 채
  `.xterm` 요소 오른쪽 바깥(뷰포트 안, `.xterm-screen`보다 오른쪽)에서 뗀다. mouseup이 `.xterm` 밖에서
  일어나 document 리스너 경로를 확인한다. 단, 이 좌표에서는 xterm이 열 좌표를 그 행 끝으로 **clamp**한다
  (실측, DELTA-04 2차 정정) — `toCol`은 무시되고 "`fromCol`부터 그 행 끝까지"가 선택된다. "행 전체/행
  끝까지"를 확인하고 싶을 때만 써라(정확한 부분 문자열 검증에는 쓰지 마라). 터미널 위쪽으로 떼면(예: y가
  작은 값) xterm이 선택 방향을 뒤집어 드래그한 텍스트 자체가 선택에서 빠지므로 쓰지 않는다. 전제: 뷰포트
  폭이 `.xterm-screen` 오른쪽 경계보다 충분히 넓어야 한다(기본 1280×720이면 안전, 좁으면 mouseup이
  `.xterm` 안에서 일어나 document 리스너 경로가 검증되지 않는다 — `selectRows`가 이 경우 에러를 던진다).
- `dblclickCell(page, row, col)`: 해당 칸을 더블클릭한다(단어 선택).
- `readClipboard(page)`: `navigator.clipboard.readText()`.
- `seedClipboard(page, text)`: 시험 전 클립보드에 사전 값을 넣는다.
- `setCopyOnSelect(page, on)`: "선택 시 자동 복사" 체크박스를 `on`에 맞춘다(리셋이 없어 대기 없이 클릭만 한다).
- `toastText(page)`: 복사 토스트(`data-testid=copy-toast`) 텍스트, 없으면 `null`.
