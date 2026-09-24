# 프롬프트가 열린 채 배경 출력이 오면 `takeRead()`가 프롬프트 행을 지우지 못한다

Status: done
Origin: RD-022a 사후 리뷰(2026-09-24, 독립 second-opinion). 뿌리는 기존 결함이다.

## 현상

`>>> pri` 읽기가 열린 채 asyncio 배경 task가 `print("tick")`하면 sink가 벤더를 거치지 않고 터미널에 직접 써서 화면이 `>>> pritick` + 빈 새 행이 된다. 이때 `runSource()`를 부르면 벤더 `Tty.eraseLine`(`packages/xterm-readline/src/tty.ts`)은 `layout.cursor.row`만 믿고 현재(빈) 행만 지운다. `>>> pritick` 행이 남아 5.6.3 "스크롤백에 흔적이 남지 않는다"를 어긴다. 복원한 줄은 출력 아래에 정상으로 그려진다.

재현: 리뷰 가설 시험 H4(jsdom, `run-source.test.ts` 하니스 복사본, 세션 스크래치패드 — 저장소에 없음). 수정 전후 모두 화면 `">>> pritick"`.

평소 편집 재그리기(`refreshLine`)도 같은 이유로 어긋난다 — `runSource`만의 문제가 아니다.

## 완료 기준

열린 읽기 중 sink 출력이 `printAbove` 경로(또는 같은 조율)를 거쳐 벤더 레이아웃이 커서 이동을 안다. 위 시나리오에서 `runSource` 뒤 화면에 `>>> pri`·`tick` 흔적 행이 없고 `tick`은 출력으로 남는다는 jsdom 시험. RD 규모(출력 경로 변경)라 별도 계획이 필요하다.

## Comments

- 2026-09-24 조사·그릴링(3라운드 Q1~Q11 전부 추천안)으로 `ROADMAP.md` RD-022b로 승격. 이후 추적은 RD-022b. 조사에서 본문보다 심각한 증상을 확인했다: 개행 없는 배경 출력은 Backspace·Enter에, 감긴 줄 뒤 배경 출력은 Backspace에 **지워진다**(jsdom 프로브 P2·P4·P7). 원인: sink 출력(`readline.print` → `term.write`)이 벤더 `State` 레이아웃(`layout.cursor`·`anchorRow`)을 거치지 않아 `refresh()`·`eraseLine()`이 물리 커서 위치를 잘못 안다. 계획서 `_works/20260924-28-rd-022b-bg-output-above-read/`.
- 2026-09-24 RD-022b 구현으로 종결(`Status: done`). 열린 읽기 중 sink 출력이 벤더 `Readline.printAboveRaw(lines, prefix)`로 가서 입력줄을 지우고 출력을 쓴 뒤 write 콜백에서 앵커를 새 커서 행으로 옮기고 같은 읽기를 다시 그린다(벤더 레이아웃이 커서 이동을 안다). 개행 없는 조각은 프롬프트 앞 접두(`tick>>> pri`)이고 꼬리 추적기에 먹이지 않는다. `runSource` 브리지는 `takeRead()` 직전 `abovePrefix()`를 읽어 `접두\x1b[0m꼬리\x1b[0m\r\n`으로 복원한다. 설계: `docs/design/05-output.md` 4.4, `02-console-core.md` 5.6.3(5.6.7의 이 항목은 삭제하고 "그리기 전 창" 경계로 바꿈), `06-editing.md` 6.1, 편차 4 개정·54·55.
  - 완료 기준 시험: `packages/pyodide-repl/src/run-source.test.ts` "H4 배경 출력 행이 온 뒤 runSource하면 >>> pritick 흔적 없이 tick 행을 남기고 출력 뒤 >>> pri를 복원한다"(동기·비동기 write 두 모드). 배경 `tick\n` 직후 화면 `tick\n>>> pri`, 정착 뒤 `tick\n1\n>>> pri`. 같은 파일 "열린 읽기 위 배경 출력" describe 2개에 조사 프로브 P1·P2·P4·P5·P7 회귀 시험, 개행 없는 접두 + `runSource`, 색 경계 바이트, REPL `input('x: ')` 등 28개.
  - RED: 수정 전 코드(벤더·sink 변경 전)에서 새 시험 26개 + H4 원본 탐침 1개 = 27/27 실패, H4 화면 `>>> pritick`(`{ before: ">>> pritick", after: ">>> pritick" }`) — `_works/_completed/20260924-28-rd-022b-bg-output-above-read/verify/red-delta03.log`.
  - GREEN·L0: repl 1103/1103(`_works/_completed/20260924-28-rd-022b-bg-output-above-read/verify/l0-delta03-repl-test.log`). 루트 `pnpm test --concurrency=1` 15/15 태스크·2062 시험(`_works/_completed/20260924-28-rd-022b-bg-output-above-read/verify/l0-delta05-test.log`).
  - 변이: 벤더 27/31 killed·동등 4(`_works/_completed/20260924-28-rd-022b-bg-output-above-read/verify/mutations-delta01.log`), sink 13/13(`mutations-delta02.log`), read-guard·driver 6/6(`mutations-delta02-repl.log`), 브리지·교차 10/10(`mutations-delta03.log`).
  - 브라우저 L1(dev 1회): `e2e:bg-output` 8/8, 이 이슈 시나리오는 B05(`B05T` / `5` / `>>> pri`, 옛 입력줄 흔적 없음) — `_works/_completed/20260924-28-rd-022b-bg-output-above-read/verify/l1-bg-output.log`. 영향 스크립트 `stdin-input`(`ONLY=TICK`) 2/2·`tab` 76/76·`run-source` 12/12·`type-ahead` 14/14·`prompt-join` 21/21·`runner-check` normal 16/16·`bg-input-guard` 3/3, 모두 `pageErrors` 0.
  - 남은 경계: 그리기 전 창의 개행 없는 조각은 [09](./09-background-fragment-lost-before-prompt-drawn.md)(`deferred`). 재그리기 대기 중 공개 편집 API는 [10](./10-public-edit-api-draws-during-redraw-wait.md)(`deferred`).
