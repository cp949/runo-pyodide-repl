# 접두 안의 SGR 아닌 제어 문자(BS·BEL 등)가 벤더 폭 계산과 편집 재그리기를 어긋나게 한다

Status: done
Origin: RD-022b 독립 second-opinion 리뷰(가설 SO-V4a·SO-V4b), 벤더 jsdom 재현(BS는 실제 xterm처럼 커서 왼쪽으로 해석하게 한 스텁). 브라우저 미관찰.

## 현상

꼬리 규칙(`packages/pyodide-core/src/terminal/output-tail.ts`)은 SGR이 아닌 제어 문자·시퀀스를 본문에 남기고, 벤더 폭 계산(`packages/xterm-readline/src/tty.ts` `width`)은 BS·BEL·OSC를 모른다. 읽기 시작 꼬리(`repl-reader`가 합성한 프롬프트)에도 있던 기존 한계이며, RD-022b로 배경 출력이 같은 접두 경로에 들어오면서 빈도가 늘었다.

- BS 스피너(SO-V4a): 접두 `|\b/`(`print("|", end="")` 뒤 `print("\b/", end="")`), 입력 `xy`. 실제 화면 `/> xy`인데 커서 `[0, 6]`, 기대 `[0, 5]`(실제 글자 끝).
- BEL(SO-V4b): 접두 `\x07`, 입력 `abc` 뒤 Backspace 2회. 실제 BEL 2번 재출력, 기대 0번.

## 완료 기준

접두·꼬리에서 SGR 외 제어 문자를 제거하거나 폭 계산에 반영해 위 두 재현이 기대값으로 통과하는 jsdom 시험. 또는 문서화만 유지한다.

## 재개 조건

배경 스피너(BS)·BEL 출력 중 입력줄 커서 어긋남이나 반복 BEL이 사용자 시나리오에서 관찰될 때.

## Comments

- 2026-09-25 등록 시점 분류: 기존 꼬리 규칙 한계의 확대이고 jsdom 재현뿐 → `deferred`.
- 2026-09-25 second-opinion 2차(가설 SO2-S4) 새 진입 경로: `\r`로 끝나는 조각 예외(보이는 마지막 `\r` 구간을 접두로 보관)가 SGR 아닌 CSI를
  품은 구간도 접두로 만든다. 열린 읽기(`> abc`, 40열)에서 `write("\x1b[?25l50%\r")` → 접두 `\x1b[?25l50%`, 화면 `50%> abc`, 커서 열 11
  (기대 8). 벤더 `tty.ts` `width`가 `\x1b[?`의 `?`에서 시퀀스를 끝내 뒤 `25l`을 3칸으로 센다. 대조: 개행·`\r` 없는 `\x1b[?25l50%`도 같은
  열 11(기존 한계). 새로 생긴 것은 경로다 — 이전에는 `\r`로 끝나면 접두가 `""`였다. 진행률 표시(커서 숨김 `\x1b[?25l` + `\r`)가 해당한다.
  수정 후보: `width`가 CSI 사설 접두(`?`·`>` 등)를 파라미터로 받게 하면 두 경로가 함께 해결된다(코드 읽기). 분류 `deferred` 유지(jsdom 재현뿐).
- 2026-09-25 재분류 `deferred` → `open` (RD-026 승격): 진행률·스피너(`\x1b[?25l`+`\r`, `\b`)는 흔한 Python 출력 패턴이고 벤더 폭 계산이 순수 함수라 브라우저에서도 같은 값이 나온다 — L1 확인 셀로 관찰할 수 있어 `open` 조건(재현 가능한 사용자 시나리오)을 그대로 충족한다. 추적은 `ROADMAP.md` RD-026.

## 해결

- 결과: 코드 수정 완료(RD-026). 재현 3건(커서 숨김 진행률 `\x1b[?25l50%`, BS 스피너 `|\b/`, BEL)이 기대값으로 통과한다.
- 원인: (1) 벤더 `Tty`의 폭 계산 `width()`가 CSI에서 `;`·숫자가 아닌 문자를 만나면 시퀀스를 끊어 `\x1b[?25l`의 `25l`을 3칸으로 셌다(커서 열 11, 기대 8). (2) 꼬리 규칙이 BS·BEL을 본문에 그대로 남겨 BS는 폭을 어긋나게 하고 BEL은 편집 재그리기마다 다시 울렸다.
- 수정: (1) `packages/xterm-readline/src/tty.ts` `width()`가 CSI를 ECMA-48대로 읽는다(파라미터 바이트 0x30–0x3F·중간 바이트 0x20–0x2F를 이어가고 그 밖에서 폭 0으로 종료). (2) `packages/pyodide-core/src/terminal/output-tail.ts`가 BS는 본문 마지막 글자를 지우고(적용) BEL·나머지 C0·DEL은 제거한다. 접두(`splitAboveRead`)와 읽기 시작 꼬리가 같은 추적기라 둘 다 맞는다. 설계: `docs/design/05-output.md` 4.4 "접두 안의 제어 문자와 폭", `docs/design/10-parity-deviations.md` 편차 4.
- 시험(jsdom): 벤더 `tty.test.ts` "CSI 시퀀스는 폭 0이다", 벤더 `print-above-raw.test.ts` "접두의 CSI 사설 시퀀스 폭(결함 15)", core `output-tail.test.ts` "제어 문자 정규화(BS 적용, BEL·나머지 C0 제거)", terminal `sinks.test.ts` "열린 읽기 위 접두의 제어 문자 정규화(결함 15, 실제 `Readline` 경로)". 수정 전 RED(벤더 12건·core 19건·terminal 3건 실패), 수정 후 GREEN.
- 브라우저 L1: `apps/demo/e2e/checks/bg-output-check.mjs` B08(`\x1b[?25lB08 50%\r` → 커서 열 14, 어긋나면 17). 수정 전 코드에서 열 14 대기가 시간 초과로 실패(양성 대조), 수정 후 `pnpm --filter demo e2e:bg-output` 기본 10/10 통과(`pageErrors` 0).
- 변이 검사: 폭 사설 접두 분기 원복·최종 바이트 판정 반전·BS 적용 제거·BEL 제거 생략 4건 + 보조 2건 전부 killed.
- 한계: BS를 "마지막 글자 삭제"로 모사하므로 `ab\b`는 실제 터미널이 `ab`로 남기지만 접두는 `a`가 된다(편차 4에 기록). VT·FF 등 나머지 C0의 커서 이동, OSC·DCS 등 CSI 밖 시퀀스의 폭, 8비트 C1은 처리하지 않는다.
- 사후 리뷰 수정(2026-09-25): 정규화가 두 곳에서 어긋났다. (1) BEL 제거가 OSC 종료자까지 지워 `\x1b]0;title\x07`가 열린 채 본문에 남았다(터미널이 뒤따르는 프롬프트·입력을 삼킨다) — `output-tail.ts`가 문자열 시퀀스(OSC·DCS·SOS·PM·APC) 안은 종료자(BEL·ST)까지 손대지 않는다. (2) `sinks.ts`의 보이는 글자 판정(`hasVisibleText`)이 정규화로 사라지는 제어 문자를 글자로 세어 `50%\r\x07` 조각에서 접두가 `""`이 되고 화면의 `50%`가 사라졌다 — 판정을 core `leavesVisibleText`로 옮겨 정규화와 같은 기준으로 맞췄다. 시험: core `output-tail.test.ts` "문자열 시퀀스(OSC·DCS)는 정규화하지 않는다" 8건·"정규화 뒤 남는 글자 판정(`leavesVisibleText`)" 15건, terminal `sinks.test.ts` "열린 읽기 중 `\r`로 끝나는 조각(진행률)" 4건 추가. RED `verify/review-red-osc.log`·`review-red-visible.log`, GREEN `review-green-*.log`, 변이 6/6 killed(`review-mutation-core.log`).
