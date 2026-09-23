# 02 절대 ms 상한 판정 3곳이 장비 성능에 따라 거짓 실패한다

Status: open

## 현상

2026-09-24 코드 읽기로 확인(실행 없음). 벽시계 ms 상한으로 실패를 던지는 곳:

| 위치 | 판정 | 재는 구간 | 측정 방식 |
| --- | --- | --- | --- |
| `checks/stdin-input-check.mjs:258` | `elapsed > 2500` 실패 | `call_later(2, print, 'TICK')` 뒤 TICK 출현 | Node `Date.now()` + `waitFor` 폴링 |
| `checks/input-cancel-check.mjs:324` | `elapsed > 500` 실패 | Ctrl+C → `KeyboardInterrupt` 출현 | Node `Date.now()` + 25ms 폴링 |
| `checks/tab-check.mjs:637` | `max > 200` 실패 | C12 Tab 후보 왕복(a.·빈 스템, 표본 20) | 스크립트 내 통계 |

하한 판정(`stdin-input-check.mjs:257` `< 1000`, `tla-check.mjs:119` `< 500`)은 느린 장비에서 더 빨라질 수 없어 해당 없음.

## 왜 문제인가

상한은 개발 장비 실측 기준이다. 느린 장비·CI에서는 제품 결함 없이 실패한다. 반대로 빠른 장비에서는 회귀가 있어도 상한 안에
들어갈 수 있다. 응답성 자체가 요구 사항(예: Ctrl+C 0.5초 내 중단)인 경우는 시간 판정을 없앨 수 없다.

Node 쪽 폴링은 추가로 과대 측정한다(`docs/traps/TRP-022`, 문턱 근처 5~8ms). `input-cancel-check.mjs`는 25ms 간격 폴링이라
오차가 더 크다.

## 제안(미검증)

- 측정을 페이지 안 `performance.now()`로 옮긴다. `measure/sleep-await-check.mjs:126-161`(`window.__ctrlCAt`·
  `__promptReadyAt`)이 선례다.
- 절대 상한 → 상대 상한: 같은 실행에서 기준 동작(예: `1+1` 왕복) 중앙값을 먼저 재고 "기준의 k배 이내"로 판정한다. 또는
  `E2E_TIME_SCALE` 배율 환경변수를 두고 기본 1.
- `stdin-input-check.mjs`의 TICK은 요구 사항이 "Enter 없이 나온다"이므로 상한을 정지 감지용(예: 10초)으로 풀고 하한만 판정으로
  남기는 안도 있다.

판정선 변경은 사용자 확인 대상이다.

## 다음에 이어받을 때

1. 세 곳 각각 요구 사항이 "응답성 수치"인지 "동작 발생 여부"인지 ROADMAP 해당 RD·`BASELINE.md`로 확인한다.
2. 응답성 수치면 상대 상한 또는 배율, 발생 여부면 상한을 정지 감지용으로 완화 — 안을 사용자에게 확인받는다.
3. 이슈 03의 CPU 감속 실행으로 수정 전 거짓 실패 재현 → 수정 후 통과를 확인한다. `ONLY=`로 해당 절만 실행한다.

## 관련

- `.scratch/e2e-baseline-drift/issues/02-sleep-await-median-over-30ms-reference.md`: `sleep-await-check.mjs` 30ms 판정선
  문제(스크립트는 단언하지 않는데 `BASELINE.md` 4절은 판정선으로 적음). 같은 뿌리지만 그 이슈에서 추적한다.
