# BASELINE — apps/demo/e2e 기준선

RD-018이 `_works/_completed/*/verify/`에 흩어져 있던 RD-005~017 브라우저 확인 스크립트·측정
스크립트·pty 기준 데이터·양성 대조 드라이버·node 통계를 `apps/demo/e2e/`로 모으면서(DELTA-01~05)
"시나리오 ID별 현재 기대 결과"를 이 문서 하나로 정리한다. 기준선은 **이전 통과 건수가 아니라
지금 재현되는 결과**다(ROADMAP.md RD-018 완료 기준).

## 1. 실행법 요약·판정 규칙

- `pnpm --filter demo e2e:baseline` — 서버 3개(5173 dev · 4173 preview · 4174 비격리 정적)를
  이 실행기가 비어 있으면 스스로 기동하고(이미 떠 있으면 "기존 사용"으로 표기하고 그대로 쓰며 종료
  시에도 내리지 않는다) 판정 19종의 dev 전부 + preview 부분 + `boot-press` N=30을 순서대로 돌린 뒤
  `apps/demo/e2e/results/summary.json`을 쓰고 이 실행기가 띄운 서버만 정리한다.
- 판정 규칙: `summary.json`의 `failed`(`baseline.json`의 `deviations`·`unrun` 접두어에 해당하는
  이름은 제외) **0건** + 총 `pageerror`(`pageErrors` 필드, `expectedPageErrors`에 등록된 의도적
  forced 오류는 뺀 값) **0** + `ok: true`. "미실행"(`unrun`)은 실패가 아니다 — 담당 RD가
  아직 없어 그 확인 코드 자체가 스크립트에 없다는 뜻이다(2026-09-24 RD-016 완료로 현재 목록은 비어 있다).
- `pnpm --filter demo e2e:<이름>` 단독 실행은 서버(주로 5173)가 이미 떠 있어야 한다
  (`e2e/README.md` "실행 전제", 29항목 목록은 같은 문서).
- `pnpm --filter demo e2e:measure` — dev만 기동, 측정 5종(`boot-press` 제외, 참고값은 4절,
  이 실행기는 exit code만 본다).
- `e2e:baseline`·`e2e:measure`는 사용자가 지시할 때만 돌린다(`docs/agents/rubber-workflow.md` "검증 실행 예산").
- `pnpm --filter demo e2e:check` — `checks/`·`measure/`·`node/`의 `.mjs`를 `node --check`로 정적
  구문 검사만 한다(eslint·tsc는 계속 `e2e/**`를 무시한다, `apps/demo/eslint.config.js`·
  `tsconfig.json`).

## 2. `baseline` 세트 표

숫자는 `apps/demo/e2e/results/*.json`(`checks` 맵의 항목 수 = `total` 필드, DELTA-05가
`pnpm --filter demo e2e:baseline`을 서버 미기동 상태에서 1회 전체 실행해 만든 실측 결과. 로그는
`node run.mjs baseline` 표준출력의 `PASS`/`FAIL` 줄)에서 그대로 옮겼다. `repl-check.mjs`는
세 모드를 각각 별도 프로세스로 돌려 결과 파일 이름이 겹친다(`pending-issues/04.md`) — dev의
`normal`·`cdn-blocked` 개수는 파일이 아니라 실행 로그의 `PASS` 줄 수로 확인했다(아래 각주).

| 스크립트 | dev 절(ID 접두어)·확인 수 | preview 재실행 절 | 기대 |
| --- | --- | --- | --- |
| `repl-check.mjs normal` | ①~⑦(1+1·빈Enter·자동들여쓰기 블록·SyntaxError·트레이스백 내부프레임 없음·꼬리 echo·`exit()`) 15개[^repl-log] | 전부(normal만) 15/15 | 통과 |
| `repl-check.mjs cdn-blocked` | CDN 차단 5개[^repl-log] | 미실행(RD-005 인계 — preview는 normal만) | 통과 |
| `repl-check.mjs not-isolated`(4174 비격리 정적) | 비격리 경고·상태 4개[^repl-log] | 미실행(정적 서버 전용) | 통과 |
| `prompt-join-check.mjs` | T1·U1·W1·W3~W5·X1·Y1~Y4·Z1·Z2·AA(5변형)·AB1·AB2·AD 21개(20 + DELTA-03 추가 AD 1) | 미실행(RD-005 인계) | 통과 20 + 허용 편차 1(AD) |
| `trailing-newline-check.mjs` | S01~S13 등 13개(RD-011a 이식) | 미실행(RD-005 인계) | 통과 |
| `carryover-check.mjs` | 이월 시나리오 4개 | 미실행(RD-005 인계) | 통과 |
| `stdin-input-check.mjs` | E1·K1~K3·L1·M1·M2·N1~N3·O1·O2·P1~P9·R1·U1·RM1·TICK 19개 | `RM1·L1·O1·M1·M2·O2·TICK` 8/8 | 통과 |
| `bg-input-guard-probe.mjs` | 배경 `input()` 가드 3개 | 전부 3/3 | 통과. RD-022b DELTA-04(2026-09-24): 선택지 C로 `bg> `가 REPL 줄에서 곧바로 떼어져 화면 신호가 없으므로 중간 대기를 "화면에 `bg>` 행"에서 "main이 `readInput` 알림을 처리함"(`lib.mjs` `installRpcTap`)으로 바꿨다(최종 `ORDER`·`waitLastEndsWith("bg>")` 불변). dev L1 1회 3/3(`pageErrors` 0, `problemLogs` 0), preview 재측정 안 함(L2) |
| `ctrl-c-check.mjs` | RM1~RM3·G1·G2·S1a·S1·S08(다단 중첩 포함) 10개 | 전부 10/10 | 통과. 2026-09-24 RD-022a DELTA-05 dev L1 전체 1회 10/10(`pageErrors` 0) |
| `prompt-cancel-check.mjs` | A1~A4·B0~B2·W2·C1·C2·D1~D3·E1·E2·F1·F2·H1·I1~I3 등 23개 | `RM1,B0` 3/3 | 통과. 2026-09-24 RD-022a DELTA-05 dev L1 전체 1회 23/23(`pageErrors` 0) |
| `input-cancel-check.mjs` | RM2/A1~A5·B1~B3·C1·C2·D1·E1·E2·F1~F3·G1~G3·H1·H2·Q1·EC·T35 26개 | `RM2,EC` 3/3 | 통과 |
| `session-reset-check.mjs` | reset·cursor·ctrll·carry·ccreset·exit·crash·strict 8절 25개 | `reset·exit·crash` 4/4 | 통과(단, `crash` 절의 forced pageerror 1건은 의도됨 — 3절 참고). 2026-09-24 RD-022a DELTA-05 dev L1 전체 1회 25/25, `pageErrors`는 등록된 forced 1건(`Error: forced`)뿐 |
| `multiline-check.mjs` | paste·tab·parse 등 18개 | `paste·tab·parse` 4/4 | 통과 |
| `tla-check.mjs` | scenario·smoke·arun·toggle-off·sticky 5절 16개 | `초기,scenario` 4/4 | 통과(단, `sticky` 절의 forced pageerror 1건은 의도됨 — 3절 참고) |
| `auto-indent-check.mjs` | prefill·shift·unit·history 등 26개(`history E1`은 DELTA-03이 RD-014 동작에 맞게 갱신[^e1]) | `초기,prefill,shift,unit` 9/9 | 통과. 2026-09-24 RD-022a DELTA-05 dev L1 전체 1회 26/26(`pageErrors` 0) |
| `block-history-check.mjs` | A·B·C·X 절 29개 | `초기,A,B,C` 11/11 | 통과 |
| `tab-check.mjs` | C1~C15(C12 왕복 지연 포함) 76개 = 기존 C1~C14 68개 + RD-016 C15 8개(a·b·c·d×2·e×2·f) | `C1·C3·C8·C11` 30/30 | 통과. RD-016(2026-09-24): C15 절 8개 추가, C9c를 `from os import pa` → `path` 채움으로 재정의, C5e 제목 정정(왕복 + 큐), C12에 `import os.pa` 지연 기록 추가(판정 없음, 웜 N=20 중앙값·최대는 결과 JSON `notes`). dev `ONLY=C5,C9,C12,C15` 20/20(C15 8개 포함, `pageErrors` 0)만 실측했고 76개 전체 재실행은 하지 않았다(L2). 편차 22 해소(2026-09-24)로 C11a에 `"sys" in globals()` False 단언 1개를 더했다(dev `ONLY=C11` 7/7, 총 개수는 그대로 68). preview 30/30은 재측정하지 않았다(L2). **2026-09-24 RD-022a DELTA-05 dev L1 전체 1회 76/76**(`pageErrors` 0, 위 부분 실행 기록에 이어 전체 결과를 처음 남긴다) |
| `selection-copy-check.mjs` | S01~S12 등 14개 | `S01,S02,S05,S07` 4/4 | 통과 |
| `type-ahead-check.mjs` | 초기·T01~T09(T08·T09a·T09b 포함, T10 제외)·T11·T12·콘솔/`pageerror` 확인 14개(T10 상한 4096은 벤더 단위 시험이 고정해 브라우저 셀 없음) | 미실행(dev 전용) | 통과 13/13(2026-09-24 RD-019 dev L1 1회, `pageErrors` 0. T11은 Tab이 마지막 키인 입력만 판정 — Tab 뒤 이어진 키는 응답 적용 조건으로 완성이 버려진다). T12(실행 중 `if 1:`+Shift+Enter+`pass` → `>>> if 1:` / `    pass`, 커서 열 8)는 2026-09-24 L1 `ONLY=T12` 1회만 통과 2/2(초기 포함, `pageErrors` 0. 나머지 셀은 위 RD-019 기록 유지). 2026-09-24 RD-022a DELTA-05 dev L1 전체 1회 **14/14**(T12 포함, `pageErrors` 0, `problemLogs` 0) |
| `run-source-check.mjs`(REPL 화면, `runSource(code)`) | 초기 1개(프롬프트·요소 3종·xterm 1개·`window` 전역 노출 없음) + S01~S10 10개 + 끝 콘솔·pageerror 1개 = 12개. S01 `pri` 입력 중 호출 → 행 `1`·마지막 행 `>>> pri`·`ok`, 이어서 `x` → `1`, S02 `1/0` → `error`·`ZeroDivisionError`·트레이스백 행(빨강), S03 블록 입력 중 → `busy`·화면 무변경, S04 REPL 실행 중 → `busy`·Ctrl+C 정리, S05 실행 → Ctrl+C → `interrupted`(`^CTraceback` 형태, 평소 명령 실행과 같다), S06 `input("n: ")` 경유, S07 `sys.exit(3)`·`exit()` → `exit` 뒤 세션 유지·`input()`, S08 실행 중 `reset` → `restarted`, S09 커서 `p\|ri` 복원 → `X` → `pXri`, S10 꼬리 `a>>> pri` 보존 | 미실행(dev 전용) | **통과 12/12**(2026-09-24 RD-022a DELTA-05 dev L1 전체 1회, `pageErrors` 0, `problemLogs` 0) |
| `bg-output-check.mjs`(REPL 화면, 열린 읽기 위 배경 출력, RD-022b) | 초기 1개(Python BroadcastChannel 수신기 설치 + 빈 `>>>` 위 `B00T` 행) + B01~B07 7개 + 끝 콘솔·pageerror 1개 = 9개. B01 `pri` 입력 중 `B01T` 행 → `B01T` / `>>> pri`(열 7), B02 Backspace 2회 → `B02T` / `>>> p`, B03 개행 없는 조각 → `B03T>>> pri` → Backspace·편집·Enter → `B03T>>> print(3)` / `3` / `>>>`, B04 `input("x: ")` 중 합성 `write` 알림 → `B04T` / `x: ab` → `got ab`, B05 배경 행 뒤 `runSource("print(5)")` → `B05T` / `5` / `>>> pri`, B06 맨 아래 행에서 1행·2행 출력(스크롤) → 입력줄이 맨 아래 행에 하나, B07 `\r`로 끝나는 진행률 조각 `B07 50%\r`·`B07 100%\r` → `B07 100%>>> pri` → `\n` → `B07 100%` / `>>> pri` | 미실행(dev 전용) | **통과 9/9**(2026-09-25 RD-022b 리뷰 반영 dev L1 1회, `pageErrors` 0, `problemLogs` 0. 이전 2026-09-24 DELTA-04 8/8) |
| `runner-check.mjs normal`(실행창 `?view=runner`) | 초기 3개(격리·ready 빈 화면·터미널/worker 1개) + R01~R13 13개 = 16개. R01 `input("이름: ")`, R02 Ctrl+C `interrupted`, R03 `stop` `interrupted`, R04 삼키는 루프 + `stop` → `restarted`·`restarting` → `ready`, R05 실행 중 `run` → `busy`, R06 실행 중 키·붙여넣기 폐기(다음 `input()`에도 없음), R07 `ready` Ctrl+C 무동작, R08 드래그 복사, R09 `sys.exit(3)`, R10 `1/0` 트레이스백, R11 두 번째 run `NameError`·`__main__`, R12 미종결 줄 뒤 새 줄, R13 콘솔 무결 | 미실행(dev 전용) | **통과 16/16**(2026-09-24 RD-022 DELTA-07 L1 전체 1회, `pageErrors` 0, `problemLogs` 0). R04→R05→R06 순서 의존(R04가 `stop()` 폴백으로 재시작한 worker에서 R05·R06이 첫 interrupt를 보낸다)을 포함한다 |
| `runner-check.mjs not-isolated`(4174 비격리 정적) | N01~N05 5개(경고 문구·노랑·상태 `not-isolated`·`run` → `unavailable`·worker 없음) | 미실행(정적 서버 전용) | 통과 5/5(2026-09-24 DELTA-07 L1 1회, `pageErrors` 0) |
| `measure/boot-press.mjs`(baseline 세트 소속, DELTA-05가 배선) | 부팅 중 Ctrl+C N=30 | 미실행(baseline dev 전용) | 통과 30/30 |

[^repl-log]: `repl-check.mjs`는 dev에서 `normal`·`cdn-blocked`·`not-isolated`(4174) 세 모드를 각각
    별도 프로세스로 실행하고, 결과 파일은 모드별 `repl-check-<mode>-dev.json`으로 남는다(2026-09-24
    정정 전에는 `repl-check-dev.json` 하나를 마지막 모드가 덮어썼다). 기준 개수: normal 15/15,
    cdn-blocked 5/5, not-isolated 4/4(2026-09-23 표준출력 `PASS` 줄 집계, 2026-09-24 모드별 결과 파일로
    같은 값 확인).
[^e1]: "history E1"은 RD-013 시점 기대(마지막 본문 줄만 재호출)에서 RD-014 `block-history`가
    도입한 실제 동작(블록 전체 재호출)으로 DELTA-03이 갱신했다(사용자 확정,
    `_works/20260923-18-rd-018-e2e-baseline/DELTA-03.md` "## 결정").

## 3. 허용 편차·미실행 확인 목록

원본은 `apps/demo/e2e/baseline.json`(`run.mjs`가 직접 읽는 기계용 사본)이다 — 아래는 그 내용에 대한
설명이고 숫자·목록 자체는 그 파일이 원본이다(이중 유지 금지).

```json
{
  "deviations": ["AD"],
  "unrun": [],
  "absorbed": [{ "id": "I", "by": "EC" }],
  "expectedPageErrors": [
    { "file": "session-reset-check-dev.json", "count": 1 },
    { "file": "session-reset-check-preview.json", "count": 1 },
    { "file": "tla-check-dev.json", "count": 1 }
  ]
}
```

- **`deviations: ["AD"]`** — 꼬리가 든 프롬프트(`t>>> `)에서 입력 중인 줄을 두고 Ctrl+L을 누르면
  우리 화면은 꼬리를 지우지 않고 `t>>> foo` 한 행만 남기는데(행 목록 `["t>>> foo"]`, 커서 0),
  3.14는 꼬리까지 지워 `>>> foo`만 남긴다. `docs/design/10-parity-deviations.md` 44절에 등록,
  실측은 DELTA-03(`prompt-join-check.mjs`의 `AD` 절 1건이 이 값을 기대값으로 고정해 회귀를
  감시한다).
- **`unrun: []`** — 미실행 확인이 없다. 이전에는 `[{ prefix: "C12 import os.pa", rd: "RD-016" }]`(`tab-check.mjs`에
  `import os.pa` 지연 측정이 코드로 없었다)이 있었으나 RD-016 DELTA-04가 그 측정을 `tab-check.mjs` C12에 더하고
  항목을 지웠다. 새 미실행 확인이 생기면 `{ prefix, rd }`로 다시 등록한다(`run.mjs`가 접두어 일치 실패를 제외한다).
- **`absorbed: [{ id: "I", by: "EC" }]`** — RD-006b 관찰 항목 `I`(`except`로 취소를 잡은 뒤 이어지는
  계산 중 Ctrl+C가 막히는 한계 관찰)는 `input-cancel-check.mjs`의 `EC` 절이 흡수했다(별도 확인으로
  남지 않는다).
- **`expectedPageErrors`** — `session-reset-check.mjs`의 `crash` 절(dev·preview 각 1건)과
  `tla-check.mjs`의 `sticky` 절(dev 1건)은 각각 강제로 낸 `pageerror`를 스크립트 자신의 "forced
  1건만, 나머지 0" 확인이 이미 PASS로 검증한다(`pending-issues/05.md`). `run.mjs`의 `writeSummary()`가
  이 3건을 총 `pageerror` 집계에서 빼므로(그 이상 나오면 초과분은 그대로 잡힌다) 총 `pageerror` 0은
  "각 스크립트 자체가 의도된 forced crash를 걸러내는 것을 포함"하는 뜻이다.
- **400토큰 스크롤백 꼬리 관찰**: 판정 밖(새 데모에 `window.__term`이 없어 RD-005도 옮기지 않았다).

### 양성 대조(positive-controls) 허용 예외 1건

`baseline`·`measure` 세트가 아니라 `apps/demo/e2e/positive-controls/rd-0NN.py` 대조 드라이버 소속
(DELTA-04). 완료 조건([^pc-exceptions], `checklist.md`)이 이 1건을 예외로 확정했다.

- **`rd-007.py` #3**(`sigint-handler.py` 프레임 필터 변조): `burst-matrix.mjs COMBOS=a`에서 검출력이
  없음을 실측 확인했다 — 무해한 회귀로 기록만 하고 재조사하지 않는다(사용자 확정,
  `_works/20260923-18-rd-018-e2e-baseline/DELTA-04.md` "## 결정", `pending-issues/07.md`).
- `rd-008.py` #2는 docstring 오류였다(T35·RM2 동시 실패가 정상 검출, 이 이슈 파일 참조). 정정 뒤
  재실행 로그는 아래 Comments.

## 4. `measure` 세트 표

이 표의 값은 **참고값**이다(2026-09-24 사용자 확정, `docs/design/09-testing.md` 9.7). 각 RD 완료 시점(기본 N)의
실측 기록이고 DELTA-04·05는 재측정하지 않았다(배선·축소 N 확인만, `checklist.md` "허용 편차" 절). 결과가 참고값을
벗어나도 회귀 판정이 아니며 `deferred` 이슈 대상이다(`docs/agents/issue-tracker.md` "등록·분류 기준"). 스크립트
exit code(형식 판정·`pageerror`)는 그대로 보고되지만 `measure` 세트는 L3이라 사용자 지시 때만 돌린다. 예외:
`boot-press.mjs`는 `baseline` 세트 소속이고 판정(30/30 OK)은 시간이 아니라 결과 분류다.

| 스크립트 | 셀 | 참고값(실측 당시, 중앙값·최대·N) | 근거 |
| --- | --- | --- | --- |
| `measure/press-loss.mjs` | 눌림 소실(브라우저) | HANG 0(기본 N=200). node 쪽 별도 통계(`node/rd-007/press-loss.mjs`)는 N=3000 소실 0, 재전송 복구 지연 p50 5.2ms·max 10.3ms(기준 20ms 안팎) | ROADMAP.md RD-007 135행 |
| `measure/burst-matrix.mjs` | 9콤보(`a`·`b1`·`b5`·`b20`·`b50`·`c`·`d2`·`d5`·`warm-a`) | 각 N=20, 180시행 전부 프롬프트 복귀(OK), 대상 `pageerror` 0(판정 CRASH>HANG>DIRTY>OK) | ROADMAP.md RD-007 136행 |
| `measure/boot-press.mjs`(**baseline 세트 소속**, N=30 판정) | 부팅 중 Ctrl+C | dev N=30·preview N=10 전부 정상(시행당 60~64회가 부팅 중 진입) | ROADMAP.md RD-007 137행. DELTA-05 재실행: dev N=30 **30/30 OK** |
| `measure/input-burst-matrix.mjs` | 8콤보(`a`·`b`·`c`·`lp5`·`sp5`·`pa`·`pb`·`pc`) | 각 N=20, 160시행 전부 OK, 대상 `pageerror` 0 | ROADMAP.md RD-008 163행 |
| `measure/sleep-await-check.mjs` | 12셀(RD-009/009a) + TLA 4셀(RD-012) = 16셀 | 각 N=20, 320시행. 12셀 전부 복귀·중앙값 30ms 안팎(아래 표, 참고값), 형식 판정 12/12. TLA 4셀도 전부 통과(`tla-burst` 중앙값 57.88ms는 30회 연타라 허용 편차). 총 `pageerror` 0 | ROADMAP.md RD-009 178~197행, RD-012 360~369행 |
| `measure/keys-after-enter-probe.mjs` | Enter 직후 지연 0/5/10/20/50/100/200ms | 판정선 없음(측정 전용). RD-019 이전에는 편차 32(읽기 없는 구간의 키 소실)를 기록했고, RD-019 뒤에는 키가 쌓여 재생되므로 전 지연에서 N/N 유입이 기대값이다(재측정은 L3, 실행하지 않음) | `keys-after-enter-probe.mjs` 머리 주석 |

### `sleep-await-check.mjs` 12셀 중앙값·최대(ms) — RD-009/009a 실측(참고값, 스크립트 판정은 형식 판정만)

| 셀 | 중앙값 | 최대 |
| --- | --- | --- |
| sleep-0.01 | 29.61 | 33.76 |
| sleep-0.1 | 26.36 | 34.03 |
| sleep-1 | 27.61 | 33.94 |
| sleep5 | 28.67 | 33.44 |
| arun5 | 25.47 | 35.04 |
| ruc5 | 26.39 | 34.08 |
| runsync5 | 29.98 | 34.27 |
| arun-sleep | 26.23 | 34.34 |
| catch3j | 22.19 | 34.21 |
| arun-loop | 23.25 | 38.44 |
| runsync-sleep | 27.12 | 33.89 |
| sleep-burst | 28.47 | 37.47 |

TLA 4셀(RD-012, N=20): `await5` 27.28ms, `awaitloop` 25.03ms, `tla-sleep-0.1` 24.58ms,
`tla-burst` 57.88ms(허용 편차, 30회 연타라 5회 연타 기준 30.23ms보다 측정 구간이 길다).

## 5. 74개 복원 표

RD-006b(옛 구현 `browser-check.mjs`) 원본 브라우저 시나리오 ID가 지금 어느 스크립트·절에서 도는지
정리한다. 원본:
`_works/_completed/20260922-06-rd-006-stdin-input/verify/skipped-ids.md`(가장 이른 시점의 선언,
"아래 세 표(1~3절)를 합치면 원본 ID 전부가 한 번씩 나온다")이고, RD-007·RD-008 판(각각
`20260922-07-.../verify/skipped-ids.md`, `20260922-08-.../verify/skipped-ids.md`)이 1·2절을
"변동 없음"으로 유지한 채 3절(건너뜀)만 갱신했다.

**재집계 결과 73개**(1절 23 + 2절 20 + 3절 30)다 — ROADMAP.md 593행의 "RD-006b 74/74"(옛 구현
자체의 통과 건수, 합격 조건 아님·이력용)와 1건 차이가 난다. 원인은 조사하지 않았다: 옛 구현의
"74"는 개별 assert 수일 수 있고 이 ID 그룹핑과 1:1이 아닐 수 있다. 아래 표는 `skipped-ids.md`에
실제로 나열된 ID를 그대로 센 것이며 74로 맞추기 위해 항목을 지어내지 않았다. RD-006 판 1절의
"(신규) RM1·TICK·가드 프로브", RD-007 판 0절의 "(신규) RM1~RM3", RD-008 판의 "(신규) B0·B3·EC·T35",
그리고 RD-012b/RD-012c 고유 ID("RD-012b G1", "RD-012b J1·J2" — RD-006b 원본이 아니라 별개
upstream 참고 구현의 ID)는 RD-006b 원본이 아니라 표 끝의 "원본 밖 추가분"에 별도로 적었다.

| 원본 ID | 내용(요약) | 실행 스크립트·절 | 상태 |
| --- | --- | --- | --- |
| E1 | 정상 `input()` 값 반환, 다음 프롬프트 앞 빈 줄 없음 | `stdin-input-check.mjs` § E1 | 실행 |
| K1·K2·K3 | `input("x: ")` → `x: abc`, Enter 뒤 `kv` → `'abc'` | `stdin-input-check.mjs` § K1 | 실행 |
| L1 | 인자 없는 `input()`은 프롬프트 없이 입력만 | `stdin-input-check.mjs` § L1 | 실행 |
| M1·M2 | 개행 없는 출력 뒤 `input()`/`input("p: ")` | `stdin-input-check.mjs` § M1·M2 | 실행 |
| N1·N2·N3 | 색 프롬프트(초록), 입력은 초록 아님 | `stdin-input-check.mjs` § N1 | 실행 |
| O1·O2 | `sys.stdin.readline()` 프롬프트 없음/꼬리 뒤 | `stdin-input-check.mjs` § O1·O2 | 실행 |
| P1~P9 | 130·200·80·70자·전각45자 프롬프트, 앞 행 중복 없음 | `stdin-input-check.mjs` § P1/P5/P7/P8/P9 | 실행 |
| R1 | 한 문장에서 `input()` 두 번 | `stdin-input-check.mjs` § R1 | 실행 |
| U1(원형) | `t>>>` 뒤 `input("p: ")`, 꼬리 미상속 | `stdin-input-check.mjs` § U1 | 실행 |
| T1 | `t>>>` 형 프롬프트 이어치기 | `prompt-join-check.mjs` § T1 | 실행 |
| U1(pass형) | `pass` 뒤 이어치기 | `prompt-join-check.mjs` § U1 | 실행 |
| W1·W3·W4·W5 | 프롬프트 이어치기 변형 4종 | `prompt-join-check.mjs` § W1·W3·W4·W5 | 실행 |
| X1 | 프롬프트 이어치기 변형 | `prompt-join-check.mjs` § X1 | 실행 |
| Y1·Y2 | 프롬프트 이어치기 변형 | `prompt-join-check.mjs` § Y1·Y2 | 실행 |
| Y3·Y4 | 프롬프트 이어치기 변형 | `prompt-join-check.mjs` § Y3·Y4 | 실행 |
| Z1·Z2 | 프롬프트 이어치기 변형 | `prompt-join-check.mjs` § Z1·Z2 | 실행 |
| AA×5 | 100·130·200·80자·전각 꼬리 프롬프트 | `prompt-join-check.mjs` § AA(5변형) | 실행 |
| AB1·AB2 | 130자 미제출 입력 변형 | `prompt-join-check.mjs` § AB1·AB2 | 실행 |
| A1~A5 | `input()` 중 Ctrl+C: 트레이스백·`^C`없음·빨강·대입없음·이후정상 | `input-cancel-check.mjs` § RM2/A1·A2·A3·A4·A5 | 실행(RD-008 복원) |
| B1·B2 | `except KeyboardInterrupt`/`except Exception` 구분 | `input-cancel-check.mjs` § B1·B2 | 실행(RD-008 복원) |
| C1·C2 | 함수 프레임, `input("in f: ")` 취소 | `input-cancel-check.mjs` § C1·C2 | 실행(RD-008 복원) |
| D1 | `sys.stdin.readline()` 중 Ctrl+C | `input-cancel-check.mjs` § D1 | 실행(RD-008 복원) |
| E2 | 취소한 입력은 history에 없음 | `input-cancel-check.mjs` § E2 | 실행(RD-008 복원) |
| H1·H2 | 블록 안 두 번째 `input()` 취소, 블록 history 잔존 | `input-cancel-check.mjs` § H1·H2 | 실행(RD-008 복원, H2는 줄 단위 history로 충족) |
| Q1 | 프롬프트 인자 있는 `input()` 중 Ctrl+C | `input-cancel-check.mjs` § Q1 | 실행(RD-008 복원) |
| G3 | `t>>> abc`에서 REPL 프롬프트 Ctrl+C | `prompt-cancel-check.mjs` § B1/G3 | 실행(RD-008 복원) |
| W2 | 꼬리 든 프롬프트에서도 REPL Ctrl+C 동일 | `prompt-cancel-check.mjs` § W2 | 실행(RD-008 복원) |
| F×5(F1·F2·F3·V1·V2) | Ctrl+C 연타 뒤 잔류 SIGINT 없음 | `measure/input-burst-matrix.mjs` 셀 a·b·c·lp5·sp5 | 실행(RD-008 복원, measure 세트) |
| G1·G2 | 실행 중 Ctrl+C 트레이스백, 중단 뒤 정상 실행 | `ctrl-c-check.mjs` § G1·G2 | 실행(RD-007 복원) |
| S1 | `except`로 잡은 `^C` 에코가 다음 `input()`에 남음 | `ctrl-c-check.mjs` § S1 | 실행(RD-007 복원) |
| J1·J2 | 세션 리셋 뒤 `input()` Ctrl+C 트레이스백, 취소 다음 `print(1)` | `session-reset-check.mjs` § carry | 실행(RD-010 복원, 2026-09-22) |
| J3 | 세션 리셋 뒤 `input("x: ")` → `x: abc` | `session-reset-check.mjs` § carry | 실행(RD-010 복원, 2026-09-22) |
| AC1 | 세션 리셋 뒤 새 프롬프트가 이전 꼬리를 물려받지 않음 | `session-reset-check.mjs` § carry | 실행(RD-010 복원, 2026-09-22) |
| X2·X3 | 블록 history 재호출·재실행 `012>>>` | `block-history-check.mjs` § X | 실행(RD-014 복원, 2026-09-23) |

### 원본 74개(실측 73개) 밖의 추가분(참고, 위 집계에 포함 안 함)

| ID | 내용 | 실행 스크립트·절 | 비고 |
| --- | --- | --- | --- |
| RM1·TICK(신규) | ROADMAP 기본 `input()` 시나리오, `call_later` 출력 | `stdin-input-check.mjs` § RM1·TICK | RD-006 판이 "(신규)"로 명시 |
| 가드 프로브(신규) | 배경 `input()` 가드 | `bg-input-guard-probe.mjs` | 〃 |
| RM1·RM2·RM3(신규) | ROADMAP 기본 Ctrl+C 시나리오 | `ctrl-c-check.mjs` § RM1·RM2·RM3 | RD-007 판이 "(신규)"로 명시 |
| RD-012b G1 | 2칸 블록 취소 뒤 다음 블록 프리필 2칸 | `auto-indent-check.mjs` § cancel(C1 등) | RD-012b 원본(RD-006b 아님), RD-013 복원 |
| RD-012b J1·J2 | 세션 리셋 뒤 `... ` Ctrl+C 취소 | `session-reset-check.mjs` § carry | RD-012b 원본(RD-006b 아님), RD-010 복원 |
| B0·B3·EC·T35(신규) | RD-008이 추가한 확인 | `prompt-cancel-check.mjs`/`input-cancel-check.mjs` | RD-008 판이 "(신규)"로 명시 |

## 6. 기준 인터프리터

- 로컬 pty 대조 기준: **CPython 3.14.4**.
- 브라우저에서 실제로 실행되는 인터프리터: **pyodide 번들 3.14.2**(패키지 버전 표기 `314.0.7`).
- 두 버전의 구체적 동작 차이(예: 편차 40·44의 Ctrl+L 화면 지우기 범위)는
  `docs/design/10-parity-deviations.md`에 편차 번호로 등록되어 있다.
