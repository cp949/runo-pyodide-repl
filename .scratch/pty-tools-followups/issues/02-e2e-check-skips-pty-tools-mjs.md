# `pnpm --filter demo e2e:check`가 `apps/demo/e2e/pty/tools/*.mjs`를 검사하지 않는다

Status: deferred
Origin: RD-025 DELTA-02(2026-09-26). 검사 범위가 좁다는 사실만 확인했고 이 때문에 놓친 결함은 아직 없다.

## 현상

`e2e:check`(`apps/demo/e2e/run.mjs check`)는 `checks/`·`measure/` 등 등록된 폴더의 스크립트만 `node --check`한다. `pty/tools/`의 `.mjs` 4개(`resolve_pyodide.mjs`·`pyodide_complete.mjs`·`gate_js.mjs`·`pyodide_zip_patch_check.mjs`)는 대상 밖이다. 이식 당시 `node --check`를 직접 돌려 통과를 확인했다(2026-09-26).

## 재개 조건

`pty/tools/*.mjs`에 구문 오류가 들어간 채 병합된 사례가 나올 때. 그 전에는 `run.mjs`를 고치지 않는다.

## 후보 조치(미검증)

`run.mjs`의 `check` 대상 폴더 목록에 `pty/tools`를 더한다. 제품 코드가 아니다.

## Comments
