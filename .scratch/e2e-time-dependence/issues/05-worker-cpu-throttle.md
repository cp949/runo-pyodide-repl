# 05 `E2E_CPU_THROTTLE`이 pyodide worker에 적용되지 않아 worker 쪽 지연을 재현하지 못한다

Status: deferred
Type: research

## 현상

2026-09-26 실측(`apps/demo/e2e/measure/cpu-throttle-probe.mjs`, dev 서버, rate당 4회 실행·첫 회 버림·표본 3 중앙값). 페이지 세션의 `Emulation.setCPUThrottlingRate`는 rate 2/4/8에서 메인 스레드를 명목대로(2.04/4.07/8.28배) 늦추지만 pyodide worker는 1.01~1.03배로 그대로다(세 기준 일치: 페이지 시계 소요·Python 시계 소요·시간 한정 루프 반복 횟수). 표와 판정은 `.scratch/e2e-time-dependence/issues/03-cpu-throttle-probe.md` Comments.

그 결과 `E2E_CPU_THROTTLE`은 worker 쪽 지연(Python 실행·`call_later` 타이머·SIGINT 처리)을 재현하지 못한다. 이슈 02 대상 3곳(`checks/tab-check.mjs` C12·`checks/input-cancel-check.mjs` EC·`checks/stdin-input-check.mjs` TICK)은 이 감속에서 통과했지만 worker 경로는 시험되지 않았다.

## 미검증(후속 후보)

worker 타깃에 별도 CDP 세션을 붙여 같은 명령을 보내면 걸리는지 시험하지 않았다. 후보 경로(모두 미시험):

- Playwright `page.on("worker")`가 주는 `Worker` 객체는 CDP 세션 API가 없다. `browser.newBrowserCDPSession()`으로 `Target.setAutoAttach`(`flatten: true`)를 걸고 worker 타깃 세션에 `Emulation.setCPUThrottlingRate`를 보내는 방식이 가능한지.
- worker 타깃 세션이 `Emulation` 도메인을 지원하는지(지원하지 않으면 이 경로는 막힌다).

## 재개 조건

다음 중 하나가 충족되면 `open`으로 바꾸고 `## Comments`에 근거(로그 경로·수치)를 남긴다.

- worker 쪽 지연(타이머·SIGINT 처리·Python 실행)이 원인으로 보이는 시간 의존 거짓 실패가 결함 없는 코드에서 관찰될 때.
- 이슈 `01-absence-checks-after-fixed-wait`가 `open`으로 바뀌어 양성 대조에 worker 감속이 필요해질 때.

## 다음에 이어받을 때

1. 위 후보 경로가 worker에 감속을 거는지 `cpu-throttle-probe.mjs`에 대상 경로를 더해 rate별 worker 배율(rate 4에서 2배 이상이면 적용)로 판정한다. 판정 스크립트가 아니라 기록이다(`docs/design/09-testing.md` 9.7 6항).
2. 걸리면 `lib.mjs`의 `E2E_CPU_THROTTLE` 적용 경로에 합치고 `apps/demo/e2e/README.md`의 한계 서술을 고친다. 걸리지 않으면 이 이슈를 `wontfix`(사유: worker 감속 수단 없음)로 닫는다.
3. 검증 실행 예산: 프로브 1회와 이슈 02 대상 3곳의 `ONLY=` 실행(L1). 전체 `e2e:baseline`은 사용자 지시 때만(`docs/agents/rubber-workflow.md` "검증 실행 예산").

## 관련

- 이슈 `03-cpu-throttle-probe`: 프로브와 실측표.
- 이슈 `02-absolute-upper-bound-assertions`: 감속으로 시험한 3곳.
- `docs/traps/TRP-022`: 폴링 지연·페이지 시계.

## Comments

- 2026-09-26 등록: `deferred`(`docs/agents/issue-tracker.md` "등록·분류 기준": 미시험 도구 아이디어이고 worker 지연에서의 거짓 실패는 관찰하지 않았다). 사용자가 프로브·`E2E_CPU_THROTTLE`을 유지하고 한계를 문서화하기로 확정했다(이슈 03 Comments).
