# 02 `measure/sleep-await-check.mjs` 일부 셀 중앙값이 `BASELINE.md` 30ms 판정선을 넘는다

Status: done

## 현상

2026-09-24, chromium, N=20, 변형마다 새로 띄운 dev 서버, `apps/demo/e2e/measure/sleep-await-check.mjs` 16셀:

- 이슈 `sigint-test-isolation/02` 수정 코드 16셀 측정 2회: 30ms 초과 셀이 회차마다 다르다. 원인 A만 고친 코드에서
  `runsync5` 31.34ms, 최종 코드에서 `sleep-0.1` 30.43ms·`sleep-burst` 30.78ms. 최종 코드의 `runsync5`는 26.23ms.
- 수정 전 `dev` 코드와 최종 코드 교대 측정(N=20×2): `sleep-burst` 수정 전 31.91·33.66ms / 수정 후 30.99·32.82ms, `sleep-0.1`
  수정 전 24.37·27.04ms / 수정 후 27.64·27.30ms, `runsync5` 수정 전 27.32·25.95ms / 수정 후 25.54·29.37ms.
- 형식 판정 320/320, `pageerror` 0. 스크립트는 30ms를 단언하지 않는다(`ok: true`).

`apps/demo/e2e/BASELINE.md` 4절은 "12셀 전부 복귀·중앙값 30ms 이내"를 판정선으로 적고, RD-009/009a 실측도 `sleep-0.01`
29.61ms·`runsync5` 29.98ms로 판정선에 붙어 있다.

## 왜 지금 안 보이나

스크립트가 30ms를 단언하지 않아 `ok: true`로 끝난다. 사람이 결과 JSON과 `BASELINE.md` 표를 대조할 때만 드러난다.

## 판단 근거

- 2026-09-24 사용자 확정: 이슈 `sigint-test-isolation/02` 작업에서는 30ms 초과를 환경 편차로 수용하고 `BASELINE.md` 판정선은
  바꾸지 않는다. 현상은 이 이슈로 추적한다.
- 수정 전 코드에서도 초과가 나고(`sleep-burst` 31.91·33.66ms), 같은 코드의 N=20 중앙값이 회차 간 2~3ms 흔들린다. 판정선이
  측정 잡음 폭 안에 있어 30ms가 합격/불합격을 판별하지 못한다.
- 정할 것: 30ms를 판정선으로 유지할지(측정 N·반복 횟수·환경 조건을 명시하고 "M회 중 중앙값의 중앙값" 같은 통계로 바꿀지)
  참고값으로 내릴지. 판정선 변경은 사용자 확인 대상이다.
- 참고: 지연은 이미 페이지 안 `performance.now()`(`window.__ctrlCAt`·`__promptReadyAt`)로 잰다. Node 쪽 폴링 과대 측정
  (`docs/traps/TRP-022-node-side-polling-inflates-browser-latency.md`)은 원인 후보가 아니다.

## Comments

- 2026-09-24 종료: 이 이슈의 "정할 것"(30ms를 판정선으로 유지할지 참고값으로 내릴지)을 사용자가 **참고값**으로 확정했다. `BASELINE.md` 4절 문구 변경, 규칙은 `docs/design/09-testing.md` 9.7 6항.
