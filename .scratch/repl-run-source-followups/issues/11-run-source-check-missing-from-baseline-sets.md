# `run-source-check.mjs`가 `apps/demo/e2e/run.mjs` baseline 목록(`SETS`)에 없다

Status: done
Origin: RD-022b 브라우저 스크립트(`bg-output-check.mjs`)를 `SETS`에 더하며 코드 읽기로 확인.

## 현상

RD-022a는 `run-source-check.mjs`의 `package.json` 스크립트(`e2e:run-source`)·`BASELINE.md` 행·README 명령 표 행을 더했지만 `apps/demo/e2e/run.mjs` `SETS`에는 넣지 않았다. 그래서 L2 `pnpm --filter demo e2e:baseline`은 `run-source-check`를 돌리지 않는다. 판정 스크립트 수 문구는 현재 `SETS`(판정 19종: RD-018 9 + 7, type-ahead, runner-check, bg-output)에 맞췄다(`apps/demo/e2e/README.md`·`BASELINE.md`, RD-022b). `run-source-check`를 넣으면 20종이 된다.

## 완료 기준

`SETS`에 `{ file: "checks/run-source-check.mjs", server: "dev" }`가 있고 판정 종 수 문구가 `SETS`와 맞는다. 결과 파일 이름이 다른 항목과 겹치지 않는지 확인한다(README "run.mjs baseline" 절). L0 `pnpm --filter demo e2e:check`로 끝나는 변경이다.

## 재개 조건

사용자가 L2(`e2e:baseline`)를 지시하기 전, 또는 `run.mjs` `SETS`를 고치는 다음 작업.

## Comments

- 2026-09-24 등록 시점 분류: 거짓 결과를 관찰하지 않은 테스트 도구 공백(코드 읽기)이라 `deferred`(`docs/agents/issue-tracker.md` "등록·분류 기준"). 이 작업은 e2e 코드를 바꾸지 않는 단계라 `SETS`는 고치지 않았다.
- 2026-09-26 재개 조건 충족 판정: 재개 조건 "사용자가 L2(`e2e:baseline`)를 지시하기 전"이 이미 지나갔다. 2026-09-25 RD-026 병합 뒤 사용자 지시로 L2를 1회 돌렸고(47개 스크립트 통과) 그 실행에 `run-source-check`가 빠져 있었다. `deferred` → `open` → 같은 작업에서 처리.
- 2026-09-26 해결: `apps/demo/e2e/run.mjs` `SETS`에 `{ file: "checks/run-source-check.mjs", server: "dev" }`를 RD-022b `bg-output-check` 앞에 넣었다. 결과 파일은 `run-source-check-dev.json`으로 기존 47개와 겹치지 않는다(`results/` 목록 대조). 판정 종 수 문구는 `SETS`의 `checks/` 중복 없는 파일 수 실측값 **23**으로 맞췄다(`apps/demo/e2e/README.md` 표·`BASELINE.md` 1절). 이전 문구 `20`은 RD-023에서 19→20으로 올린 뒤 RD-024가 더한 `react-strictmode-check`·`react-fit-check` 2종을 반영하지 않은 값이다(`git log -S"판정 20종"` = `a1c5563`). 집계 규칙을 `BASELINE.md` 1절에 한 줄로 적었다. `baseline.json`은 스크립트 목록을 담지 않으므로(`deviations`·`unrun`·`absorbed`·`expectedPageErrors` 4키) 대조 기대값 변경은 없다. `pnpm --filter demo e2e:check` 35개 중 0개 실패. 브라우저 실행은 하지 않았다(L2는 사용자 지시 때만) — 다음 L2가 이 셀을 처음 돌린다.
