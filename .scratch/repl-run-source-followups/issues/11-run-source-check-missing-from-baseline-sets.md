# `run-source-check.mjs`가 `apps/demo/e2e/run.mjs` baseline 목록(`SETS`)에 없다

Status: deferred
Origin: RD-022b 브라우저 스크립트(`bg-output-check.mjs`)를 `SETS`에 더하며 코드 읽기로 확인.

## 현상

RD-022a는 `run-source-check.mjs`의 `package.json` 스크립트(`e2e:run-source`)·`BASELINE.md` 행·README 명령 표 행을 더했지만 `apps/demo/e2e/run.mjs` `SETS`에는 넣지 않았다. 그래서 L2 `pnpm --filter demo e2e:baseline`은 `run-source-check`를 돌리지 않는다. 판정 스크립트 수 문구는 현재 `SETS`(판정 19종: RD-018 9 + 7, type-ahead, runner-check, bg-output)에 맞췄다(`apps/demo/e2e/README.md`·`BASELINE.md`, RD-022b). `run-source-check`를 넣으면 20종이 된다.

## 완료 기준

`SETS`에 `{ file: "checks/run-source-check.mjs", server: "dev" }`가 있고 판정 종 수 문구가 `SETS`와 맞는다. 결과 파일 이름이 다른 항목과 겹치지 않는지 확인한다(README "run.mjs baseline" 절). L0 `pnpm --filter demo e2e:check`로 끝나는 변경이다.

## 재개 조건

사용자가 L2(`e2e:baseline`)를 지시하기 전, 또는 `run.mjs` `SETS`를 고치는 다음 작업.

## Comments

- 2026-09-24 등록 시점 분류: 거짓 결과를 관찰하지 않은 테스트 도구 공백(코드 읽기)이라 `deferred`(`docs/agents/issue-tracker.md` "등록·분류 기준"). 이 작업은 e2e 코드를 바꾸지 않는 단계라 `SETS`는 고치지 않았다.
