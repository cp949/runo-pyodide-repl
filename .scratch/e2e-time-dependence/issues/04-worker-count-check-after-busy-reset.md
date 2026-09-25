# 04 유휴가 아닌 worker를 terminate한 뒤 `page.workers().length === 1`로 판정하면 잔존 약 2초 동안 간헐 실패할 수 있다

Status: deferred

## 현상

2026-09-25 RD-023 착수 조건 스파이크(Chromium 1243 헤드리스, WSL2)의 측정 사실이다. core 단독(coincident 없음)에서 유휴가 아닌
worker(`input()` 대기·`time.sleep(30)`·`while True: pass`)를 `reset()`으로 terminate하면 옛 worker가 CDP `Target.getTargets`에
1998~2004ms 남았다(12/12회). 유휴 worker는 3ms 이하로 사라졌다(4/4회). 새 worker `ready`는 약 0.8~0.9초라 `ready` 시점에 worker가
2개(드물게 3개) 보인다. 근거·함정 요약은 `docs/traps/TRP-049`.

## 현재 영향

**거짓 실패는 아직 관찰하지 않았다.** 코드 읽기로만 추정한 문제이고, 현재 시험이 리셋·종료를 어떤 worker 상태에서 하는지는 읽지
않았다(미확인). 유휴에서만 하면 잔존이 없어 통과한다.

worker 수를 세는 위치(2026-09-25 코드 읽기, 실행 없음):

- `apps/demo/e2e/checks/session-reset-check.mjs:396-404` — strict 단계에서 `resetAndWait()`(`:63-72`, `ready`·프롬프트까지 대기) 뒤
  `page.workers().length !== 1`. 리셋 직전 worker 상태는 미확인.
- `apps/demo/e2e/checks/repl-check.mjs:76`(`waitFor`로 `=== 1`, 조건 대기), `:205`(종료 뒤 `!== 1`), `:282`(`!== 0`, 1500ms 고정 대기 뒤).
- `apps/demo/e2e/checks/runner-check.mjs:115`(`waitFor`로 `=== 1`), `:388`(`!== 0`, not-isolated).

`page.workers()`가 Playwright 종료 이벤트 기준이라 CDP 목록과 같은 시점에 줄어드는지도 확인하지 않았다(`TRP-061` 참고).

## 재개 조건

다음 중 하나가 충족되면 `open`으로 바꾸고 `## Comments`에 근거(로그 경로·수치)를 남긴다.

- busy(`input()` 대기·실행 중·`time.sleep`) 상태에서 `reset()`·`stop()` 폴백·`dispose()`한 뒤 worker 수를 세는 시험을 추가할 때.
- 위 세 스크립트(`session-reset-check`·`repl-check`·`runner-check`)의 worker 수 판정이 간헐 실패할 때(원시 로그 위치를 함께 기록).
- RD-023 구현 착수 시(재시작 직후 worker 2개 동시 존재를 전제로 하는 시험을 추가하므로 함께 확인).

## 다음에 이어받을 때

1. 위 위치들이 terminate 시점에 worker가 유휴인지 아닌지 읽어 분류한다.
2. 유휴가 아닌 경우만 판정을 "옛 targetId 소멸까지 조건 대기(`lib.mjs` `waitFor`, 정지 감지 상한은 잔존 약 2.0초의 몇 배)"와
   "최종 1개"로 나눈다. 고정 대기·ms 상한 금지(`docs/design/09-testing.md` 9.7).
3. 검증 실행 예산: 고친 스크립트만 `ONLY=`로 실행(L1). 전체 `e2e:baseline`은 사용자 지시 때만
   (`docs/agents/rubber-workflow.md` "검증 실행 예산").

## Comments

- 2026-09-25 등록: `deferred`(`docs/agents/issue-tracker.md` "등록·분류 기준": 코드 읽기로만 추정한 테스트 도구 문제, 거짓 결과 미관찰).
- 2026-09-26 재개 조건 3 판정(RD-023 완료 뒤 확인, 코드 읽기): **`deferred` 유지**. (1) RD-023이 더한 busy 종료 판정은 `apps/demo/e2e/checks/dom-bridge-check.mjs:480`의 `waitFor(() => page.workers().length === 1, "옛 worker 소멸", BOOT_TIMEOUT_MS)`이고, `stop()` 폴백(slow 호출 중 = busy) 직후를 조건 대기로 본다 — 이 이슈가 우려한 "즉시·고정 대기 판정"이 아니다. (2) 즉시 판정 2곳(`session-reset-check.mjs:396`·`:403`)은 strict 절이고 리셋 직전이 유휴(로드 직후·`resetAndWait()`는 `ready`+프롬프트까지 대기)라 2초 잔존 조건에 걸리지 않는다. (3) `repl-check.mjs:76`·`runner-check.mjs:115`는 `waitFor`, `repl-check.mjs:282`는 CDN 실패(worker 생성 없음) 경로다. 거짓 실패 관찰은 여전히 0건이다. 남은 재개 조건: busy 상태에서 worker 수를 **즉시** 세는 시험이 새로 생기거나, 위 판정이 간헐 실패할 때.
