# 01 고정 대기 뒤 "없다"를 확인하는 판정이 느린 장비에서 결함을 놓친다

Status: deferred

## 현상

2026-09-24 코드 읽기로 확인(실행 없음). `apps/demo/e2e/checks/`·`measure/`에 `page.waitForTimeout(ms)`·`sleep(<숫자>)` 고정 대기
154곳(2026-09-26 정정: 이전 "145곳"은 `sleep(<숫자>)` grep이 Python 코드 문자열(`time.sleep(0.1)`·`asyncio.sleep(1)`)까지 센 오계수다. 집계 규칙은 아래 Comments 참고). 많은 곳: `tab-check.mjs` 42, `block-history-check.mjs` 23, `stdin-input-check.mjs` 20(전부 `settled()`), `ctrl-c-check.mjs` 9.

그중 "N ms 기다린 뒤 화면에 X가 없다/바뀌지 않았다"로 판정하는 형태가 있다. 예:

- `checks/tab-check.mjs:116-121` C2b — `Tab` → `sleep(500)` → 마지막 행이 `>>> os.path` 그대로인지 확인.
- `checks/tab-check.mjs:122-124` C2b — 같은 대기 뒤 `os.pathsep`이 화면에 없는지 확인.

`lib.mjs:330` `settled(quietMs = 200)`도 "200ms 동안 화면이 안 바뀌었다"를 완료로 본다 — 같은 부류다.

## 왜 문제인가

결과 도착이 대기 시간보다 늦으면(느린 장비·CI·부하) 결함이 있어도 **통과**한다. 실패가 아니라 검출력 상실이라 로그에 남지
않는다. 대기 시간은 개발 장비 실측으로 정한 값이다.

반대로 고정 대기 뒤 "있다"를 확인하는 곳은 느린 장비에서 거짓 실패가 난다(간헐 실패 원인 후보).

## 제안(미검증)

- **부재 확인 → 마커 배리어**: 대상 동작 뒤 결과가 결정된 입력(예: `print('MARK')`)을 보내고 `MARK` 출현을 `waitFor`로
  기다린 뒤 부재를 판정한다. 입력이 FIFO로 처리되면 마커 도착 = 앞선 처리 완료라 장비 속도와 무관하다.
  - 가정: 마커가 대상과 같은 경로(예: Tab 완성이면 worker 왕복)를 지나야 성립한다. 검사별로 확인한다.
  - 마커 입력이 화면·히스토리·세션 상태를 바꾸므로 뒤 단계 기대값에 영향이 없는지 확인한다(RD-013 세션 상태 누수 함정).
- **존재 확인 → 조건 대기**: 고정 대기를 `lib.mjs:148` `waitFor(check, description, timeoutMs)`로 바꾼다. timeout은 판정선이
  아니라 정지 감지용으로 넉넉히 둔다.
- `settled()`: 제품 쪽에 재그리기 완료 신호가 있으면 그것으로 바꾸고, 없으면 유지하되 사용처를 목록화한다.

## 다음에 이어받을 때

1. ~~154곳을 "부재 확인 / 존재 확인 / 입력 간격 / 정리용" 네 부류로 분류한 표를 Comments에 남긴다.~~ 2026-09-26 Comments에
   기록됐다. 입력 간격 부류는 측정 대상 자체라 바꾸지 않는다.
2. 부재 확인 부류부터 스크립트 단위로 고친다. 고친 스크립트마다 양성 대조(해당 결함을 넣으면 실패하는지)로 검출력을 확인한다.
3. 검증 실행 예산: 고친 스크립트만 `ONLY=`로 실행(L1), 전체 `e2e:baseline`은 사용자 지시 때만
   (`docs/agents/rubber-workflow.md` "검증 실행 예산").

## 관련

- 이슈 `03-cpu-throttle-probe`: 느린 장비 재현 수단. 단, 부재 확인 부류는 감속해도 **통과**하므로 이 방법으로 찾을 수 없다.
- `docs/traps/TRP-011`(마커 대기 시 입력 행이 마커를 포함해 즉시 통과) — 배리어 구현 시 같은 함정을 피한다.

## Comments

- 2026-09-24 재분류: `deferred`(`docs/agents/issue-tracker.md` "등록·분류 기준"). 코드 읽기 추정이고 검출력 상실을 아직 관찰하지 않았다. 새로 쓰거나 고치는 스크립트는 `docs/design/09-testing.md` 9.7 규칙으로 흡수했다(기존 145곳은 그 스크립트를 고칠 때 바꾼다). 재개 조건: 부재 확인 판정이 결함을 놓치는 것이 양성 대조로 확인되면 `open`.

- 2026-09-26 분류표(`e2e-time-dependence` 작업). 코드 읽기 분류이고 실행하지 않았다. 감속 4(메인 스레드만)로 이슈 02 대상 3곳만 돌렸고 (B) 거짓 실패는 0건이라 Status는 `deferred`를 유지한다(재개 조건은 위 2026-09-24 항목 그대로).

  **집계 규칙(재현 가능)**: `apps/demo/e2e/`에서 아래 두 grep의 줄 수를 합한다. Python 코드 문자열 안의 `sleep`은 이 규칙이 세지 않도록 `[^_.a-zA-Z]sleep\(`로 접두를 걸렀고, 그래도 걸리는 `checks/tla-check.mjs:118` 주석 1줄만 뺐다.

  ```sh
  grep -nE "waitForTimeout\(|[^_.a-zA-Z]sleep\(" checks/*.mjs measure/*.mjs   # 123줄 - tla-check.mjs:118 주석 1줄 = 122
  grep -nE "[^a-zA-Z]settled\(" checks/*.mjs measure/*.mjs                      # 32줄(`lib.mjs:363` 정의 줄은 제외, 정의까지 세면 33)
  ```

  총계 **154**(고정 대기 122 + `settled()` 32). `lib.mjs` 내부 폴링 대기(`waitFor`·`settled` 본문의 `waitForTimeout`), `node/`·`pty/`·`positive-controls/`, `boot-press.mjs:39`의 `setTimeout`(라우트 지연 주입)은 이 규칙 밖이다. 줄 번호는 2026-09-26 작업 트리 기준이다(이슈 02 수정으로 `tab-check.mjs`·`input-cancel-check.mjs`·`stdin-input-check.mjs`의 줄이 옛 표기와 다르다). 호출 수로 세면 `ctrl-c-check.mjs`의 `interruptAfter(ms)` 호출 7곳이 늘어 160이다.

  **부류 정의**: (A) 부재 — 기다린 뒤 "X가 없다·바뀌지 않았다"를 판정. (B) 존재 — 기다린 뒤 "X가 있다·값이 이렇다"를 판정하거나 그 결과에 기대는 다음 동작(느린 장비에서 거짓 실패 후보). (C) 간격 — 입력 간격·눌림 시각·실행 시작 여유처럼 시나리오의 시간 배치 자체. (D) 정리 — 판정과 무관한 정착·정리 루프·타임아웃 경쟁. `settled()`는 화면이 `quietMs` 동안 안 바뀌면 끝나는 대기라 같은 표에 넣었다(9.7 5항이 부재 확인 부류로 본다).

  **이전 수치와의 차이**: 2026-09-25 그릴링은 총 154를 (A) 30 · (B) 53 · (C) 21 · (D) 50으로 분류했다고 확정했으나 곳별 목록이 저장되지 않아 이번에 처음부터 다시 분류했다. 총계는 같고 실측 부류는 (A) 28 · (B) 66 · (C) 18 · (D) 42다. 부류별 차이의 원인은 확인하지 않았다(그릴링 당시 곳별 배정을 복원할 수 없다). 이 표의 개수를 기준으로 삼는다.

  **파일별 개수**(고정 대기 + `settled()`):

  | 파일                                 | (A) 부재 | (B) 존재 | (C) 간격 | (D) 정리 |    합계 |   애매 |
  | ------------------------------------ | -------: | -------: | -------: | -------: | ------: | -----: |
  | `checks/tab-check.mjs`               |        7 |       23 |        1 |       11 |      42 |      1 |
  | `checks/block-history-check.mjs`     |        2 |       18 |        0 |        3 |      23 |        |
  | `checks/stdin-input-check.mjs`       |        0 |       15 |        0 |        5 |      20 |        |
  | `checks/ctrl-c-check.mjs`            |        0 |        2 |        3 |        4 |       9 |      2 |
  | `checks/selection-copy-check.mjs`    |        6 |        0 |        1 |        1 |       8 |      2 |
  | `checks/prompt-cancel-check.mjs`     |        2 |        0 |        1 |        5 |       8 |      3 |
  | `checks/input-cancel-check.mjs`      |        2 |        2 |        2 |        2 |       8 |      4 |
  | `checks/auto-indent-check.mjs`       |        0 |        5 |        1 |        1 |       7 |      1 |
  | `measure/sleep-await-check.mjs`      |        0 |        0 |        3 |        3 |       6 |      1 |
  | `checks/repl-check.mjs`              |        4 |        0 |        0 |        0 |       4 |        |
  | `checks/session-reset-check.mjs`     |        2 |        0 |        0 |        2 |       4 |        |
  | `measure/keys-after-enter-probe.mjs` |        0 |        1 |        1 |        1 |       3 |        |
  | `checks/bg-input-guard-probe.mjs`    |        0 |        0 |        0 |        3 |       3 |        |
  | `checks/tla-check.mjs`               |        1 |        0 |        0 |        1 |       2 |        |
  | `measure/burst-matrix.mjs`           |        0 |        0 |        2 |        0 |       2 |      2 |
  | `measure/boot-press.mjs`             |        0 |        0 |        2 |        0 |       2 |        |
  | `checks/carryover-check.mjs`         |        1 |        0 |        0 |        0 |       1 |        |
  | `measure/press-loss.mjs`             |        0 |        0 |        1 |        0 |       1 |        |
  | `measure/input-burst-matrix.mjs`     |        1 |        0 |        0 |        0 |       1 |      1 |
  | **합계**                             |   **28** |   **66** |   **18** |   **42** | **154** | **17** |

  "애매" 열은 아래 "애매" 절의 17곳이다. (D)에는 `tab-check.mjs:59` `sleep` 헬퍼 정의 줄 1개(대기가 아니라 grep 줄 기준 합계에 든 것)와 `sleep(15000)` 정지 감지 경쟁 3곳(`tab-check.mjs:381`·`:418`·`:453`)이 들어 있다.

  **(A) 부재 확인 28곳 전수**(고정 대기 25 + `settled()` 3):

  - `checks/tab-check.mjs:120` 500ms — C2b Tab 뒤 입력줄이 `>>> os.path` 그대로
  - `checks/tab-check.mjs:135` 400ms — C3a 첫 Tab 뒤 목록(`a.attr_one`)이 없다
  - `checks/tab-check.mjs:220` 600ms — C3f 끼어든 키 뒤 Tab에 목록(`os.pardir`)이 없다
  - `checks/tab-check.mjs:236` 500ms — C4 후보 없음 뒤 입력줄 무변화
  - `checks/tab-check.mjs:526` 600ms — C10b 예외 객체 Tab 뒤 입력줄 무변화
  - `checks/tab-check.mjs:716` 300ms — C13 큐 오배선이면 나타날 두 번째 목록이 없다
  - `checks/tab-check.mjs:870` 600ms — C11b 종료 뒤 Tab에 목록이 없다
  - `checks/block-history-check.mjs:137` 300ms — `...` 줄에서 ↑ 뒤 줄이 그대로 `...`
  - `checks/block-history-check.mjs:150` 300ms — Ctrl+U 뒤 ↑에도 줄이 그대로 `...`
  - `checks/selection-copy-check.mjs:77` 2800ms — 토스트 소멸(2.8초 뒤 1회 확인) (애매)
  - `checks/selection-copy-check.mjs:123` 300ms — 선택 Ctrl+C 뒤 입력줄 불변·`^C` 없음
  - `checks/selection-copy-check.mjs:147` 300ms — Ctrl+Shift+C 뒤 입력줄 불변·`^C` 없음
  - `checks/selection-copy-check.mjs:169` 300ms — `input()` 중 선택 Ctrl+C 뒤 취소 없음
  - `checks/selection-copy-check.mjs:235` 300ms — 체크박스 해제 뒤 클립보드 불변
  - `checks/selection-copy-check.mjs:282` 300ms — 새로고침 뒤 클립보드 불변
  - `checks/prompt-cancel-check.mjs:237` 120ms — H1 ↑ 30회(120ms 간격) 동안 취소한 `abc`가 안 돌아온다 (애매)
  - `checks/input-cancel-check.mjs:201` 120ms — E2 ↑ 30회(120ms 간격) 동안 취소한 `secret-h`가 안 돌아온다 (애매)
  - `checks/repl-check.mjs:188` 800ms — 종료 뒤 새 프롬프트·추가 출력이 없다
  - `checks/repl-check.mjs:199` 800ms — 종료 뒤 입력에 화면이 변하지 않는다
  - `checks/repl-check.mjs:246` 500ms — CDN 실패 뒤 프롬프트가 없다
  - `checks/repl-check.mjs:281` 1500ms — CDN 실패 뒤 worker 0개
  - `checks/session-reset-check.mjs:157` 100ms — ↑ 뒤 미제출 `abc`가 안 보인다
  - `checks/session-reset-check.mjs:357` 500ms — terminated 뒤 입력에 화면 불변
  - `checks/tla-check.mjs:179` 100ms — ↑ 뒤 프롬프트에 취소된 글자가 없다
  - `checks/carryover-check.mjs:96` 800ms — `gc.collect()` 뒤 추가 출력이 없다
  - `measure/input-burst-matrix.mjs:104` settled — 연타 뒤 `^C` 0 확인 전 정착(`.catch`로 실패 무시) (애매)
  - `checks/prompt-cancel-check.mjs:253` settled — 연타 뒤 `^C` 0 확인 전 정착(`.catch`로 실패 무시) (애매)
  - `checks/input-cancel-check.mjs:219` settled — 연타 뒤 트레이스백 1개 확인 전 정착(`.catch`로 실패 무시) (애매)

  **(B) 존재 확인 중 대기 ≤500ms인 거짓 실패 위험 46곳**(고정 대기 (B) 49곳 중 500ms 초과는 `tab-check.mjs:865`(1500)·`block-history-check.mjs:304`(800)·`input-cancel-check.mjs:308`(1200) 3곳). 이 목록은 코드 읽기 후보이고 실측된 거짓 실패는 없다(감속 4는 메인 스레드만 늦추고 worker에는 걸리지 않았다, 이슈 03):

  - `checks/tab-check.mjs`: 149(200), 159(400), 183(400), 201(500), 215(400), 252(200), 261(200), 269(200), 277(200), 333(400), 349(400), 356(400), 402(300), 436(500), 447(300), 480(500), 491(500), 516(400), 548(400), 568(300), 592(400), 630(300)
  - `checks/block-history-check.mjs`: 76(300), 82(300), 88(300), 114(300), 158(300), 178(300), 196(300), 214(300), 237(300), 253(300), 271(300), 294(300), 310(250), 332(300), 358(300), 381(300), 385(300)
  - `checks/input-cancel-check.mjs`: 290(150)
  - `checks/auto-indent-check.mjs`: 122(300), 158(300), 233(300), 374(300), 377(300)
  - `measure/keys-after-enter-probe.mjs`: 49(250)

  **`settled()` 호출 32곳과 판정 사용 여부**(정의 `lib.mjs:363`까지 세면 33곳). "판정 사용"은 `settled()` 직후 읽은 화면 값으로 판정하는 곳이다. 20곳이 판정에 쓰이고 12곳은 정착·기록 전 대기다.

| 파일                              | 호출 수 | 판정 사용 | 판정 사용 줄                                                           | 그 밖(정착·기록 전) 줄 |
| --------------------------------- | ------: | --------: | ---------------------------------------------------------------------- | ---------------------- |
| `checks/stdin-input-check.mjs`    |      19 |        15 | 65, 79, 92, 101, 113, 122, 131, 140, 156, 169, 179, 188, 197, 211, 238 | 28, 209, 236, 257      |
| `checks/ctrl-c-check.mjs`         |       3 |         2 | 151, 182                                                               | 180                    |
| `checks/bg-input-guard-probe.mjs` |       3 |         0 | -                                                                      | 42, 52, 59             |
| `checks/session-reset-check.mjs`  |       2 |         0 | -                                                                      | 211, 228               |
| `measure/sleep-await-check.mjs`   |       1 |         0 | -                                                                      | 357                    |
| `measure/input-burst-matrix.mjs`  |       1 |         1 | 104                                                                    | -                      |
| `checks/tla-check.mjs`            |       1 |         0 | -                                                                      | 177                    |
| `checks/prompt-cancel-check.mjs`  |       1 |         1 | 253                                                                    | -                      |
| `checks/input-cancel-check.mjs`   |       1 |         1 | 219                                                                    | -                      |
| **합계**                          |  **32** |    **20** |                                                                        |                        |

**애매 17곳**(부류를 확정하지 않고 열로 표시한 것, 이번에 재분류하지 않는다. 실행으로 검증하지 않은 코드 읽기 판단이다):

- `checks/selection-copy-check.mjs:77`(A로 배정) — 토스트가 2.8초 뒤 사라졌는지 1회 확인. 소멸 확인이라 부재이나 토스트 수명(1.5초)에 묶인 시간이 판정 근거다.
- `checks/prompt-cancel-check.mjs:237`·`checks/input-cancel-check.mjs:201`(A로 배정) — ↑ 30회를 120ms 간격으로 누르며 재호출 값을 모은 뒤, 첫 값(존재)과 취소한 글자의 부재를 함께 본다. 존재와 부재가 섞여 있다.
- `measure/sleep-await-check.mjs:357`(D로 배정)·`measure/input-burst-matrix.mjs:104`(A로 배정) — `settled()` 뒤 값을 읽는 측정. 앞은 판정이 없고 뒤는 `.catch(() => {})`로 정착 실패를 삼킨다.
- `checks/prompt-cancel-check.mjs:253`·`checks/input-cancel-check.mjs:219`(A로 배정) — 위 `input-burst-matrix.mjs:104`와 같은 형태(`settled(250).catch(() => {})` 뒤 `^C` 0·트레이스백 1개 판정). 이번 분류에서 같은 이유로 애매에 더했다.
- **실행 시작 여유 후 Ctrl+C 계열**(C로 배정) — 고정 대기 뒤 `Ctrl+C`를 눌러 실행이 시작됐다고 가정한다. 여유가 짧으면 눌림이 실행 시작보다 앞서 다른 경로를 탄다. 시나리오의 시간 배치(C)인지 시작 대기(B)인지 갈린다. 해당 줄: `tab-check.mjs:916`, `selection-copy-check.mjs:190`, `prompt-cancel-check.mjs:214`, `input-cancel-check.mjs:241`·`:334`, `auto-indent-check.mjs:285`, `ctrl-c-check.mjs:31`(`interruptAfter` 본문, 호출 7곳: 300ms 6곳·1200ms 1곳)·`:211`, `burst-matrix.mjs:61`·`:68` — 10줄이다(그릴링 당시 "6곳"은 곳별 목록이 없어 대조하지 못했다).
