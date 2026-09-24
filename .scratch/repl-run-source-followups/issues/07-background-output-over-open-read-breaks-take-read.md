# 프롬프트가 열린 채 배경 출력이 오면 `takeRead()`가 프롬프트 행을 지우지 못한다

Status: promoted (RD-022b)
Origin: RD-022a 사후 리뷰(2026-09-24, 독립 second-opinion). 뿌리는 기존 결함이다.

## 현상

`>>> pri` 읽기가 열린 채 asyncio 배경 task가 `print("tick")`하면 sink가 벤더를 거치지 않고 터미널에 직접 써서 화면이 `>>> pritick` + 빈 새 행이 된다. 이때 `runSource()`를 부르면 벤더 `Tty.eraseLine`(`packages/xterm-readline/src/tty.ts`)은 `layout.cursor.row`만 믿고 현재(빈) 행만 지운다. `>>> pritick` 행이 남아 5.6.3 "스크롤백에 흔적이 남지 않는다"를 어긴다. 복원한 줄은 출력 아래에 정상으로 그려진다.

재현: 리뷰 가설 시험 H4(jsdom, `run-source.test.ts` 하니스 복사본, 세션 스크래치패드 — 저장소에 없음). 수정 전후 모두 화면 `">>> pritick"`.

평소 편집 재그리기(`refreshLine`)도 같은 이유로 어긋난다 — `runSource`만의 문제가 아니다.

## 완료 기준

열린 읽기 중 sink 출력이 `printAbove` 경로(또는 같은 조율)를 거쳐 벤더 레이아웃이 커서 이동을 안다. 위 시나리오에서 `runSource` 뒤 화면에 `>>> pri`·`tick` 흔적 행이 없고 `tick`은 출력으로 남는다는 jsdom 시험. RD 규모(출력 경로 변경)라 별도 계획이 필요하다.

## Comments

- 2026-09-24 조사·그릴링(3라운드 Q1~Q11 전부 추천안)으로 `ROADMAP.md` RD-022b로 승격. 이후 추적은 RD-022b. 조사에서 본문보다 심각한 증상을 확인했다: 개행 없는 배경 출력은 Backspace·Enter에, 감긴 줄 뒤 배경 출력은 Backspace에 **지워진다**(jsdom 프로브 P2·P4·P7). 원인: sink 출력(`readline.print` → `term.write`)이 벤더 `State` 레이아웃(`layout.cursor`·`anchorRow`)을 거치지 않아 `refresh()`·`eraseLine()`이 물리 커서 위치를 잘못 안다. 계획서 `_works/20260924-28-rd-022b-bg-output-above-read/`.
