# `run-source-check.mjs` 양성 대조(소스 변조 → 셀 실패) 미수행

Status: deferred
Origin: RD-022a 마무리. 검증 공백 기록.

## 현상

앞선 RD(005~019)는 브라우저 확인 스크립트의 검출력을 `positive-controls/`의 변조 기록으로 남겼지만 RD-022a는 L1 예산(`run-source` 1회 + 실패 셀만 `ONLY=`) 안에서 변조·dev 서버 재시작·재실행이 추가 L1이라 하지 않았다. `run-source-check.mjs` S01~S10(12셀)이 결함을 실제로 잡는다는 브라우저 근거가 없다. 검출력의 근거는 L0 변이 검사(repl `run-source.test.ts` 변이 25 killed / 1 동등)와 셀의 정확일치 판정(`tail` 정확 목록, 커서 열)뿐이다.

## 완료 기준

`apps/demo/e2e/positive-controls/`에 변조 2~3개의 실행 기록(예: `rd-022a.md`)을 남긴다. 후보: `takeRead` 뒤 꼬리 다시 쓰기 제거 → S10 실패, `prefillCursor` 무시 → S09 실패, 정착 시점을 결말 도착 즉시로 → S01 실패. 변조마다 dev 서버를 재시작한다(`docs/traps/TRP-007`).

## 재개 조건

사용자가 L3(브라우저 양성 대조)를 지시할 때, 또는 `run-source-check` 셀이 거짓 통과·거짓 실패로 의심되는 관찰이 있을 때.

## Comments

- 2026-09-24 등록 시점 분류: 검출력 상실을 실측하지 않았고 L3 범위(사용자 지시 때만)라 `deferred`.
