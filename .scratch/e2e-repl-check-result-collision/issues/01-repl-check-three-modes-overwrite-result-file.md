# 01 repl-check.mjs 세 모드가 `run.mjs baseline`에서 같은 결과 파일을 덮어쓴다

Status: open

## 현상

`apps/demo/e2e/run.mjs`의 `baseline` 세트는 `apps/demo/e2e/checks/repl-check.mjs`를 dev(5173)에서
세 모드(`normal`·`cdn-blocked`·`not-isolated`)로 **각각 별도 자식 프로세스**로 실행한다.
`apps/demo/e2e/lib.mjs`의 `resultFileName()` 중복 카운터는 모듈 스코프라 프로세스 하나당 하나만
존재하는데, 세 모드가 서로 다른 프로세스라 카운터가 매번 1부터 다시 시작한다. `not-isolated`는
4174(비격리 정적 서버)로 열지만 결과 파일 label은 "dev"로 잡힌다(모드 구분 없이 `label: "dev" | "preview"`만
있음). 그 결과 세 모드 전부 같은 파일 이름 `repl-check-dev.json`을 쓰게 되어, `SETS` 순서상 마지막에
실행되는 모드(현재 `not-isolated`)의 결과만 남고 `normal`·`cdn-blocked`의 결과 파일은 덮어써진다.

## 영향

- `results/summary.json`의 스크립트별 통과/실패 집계가 `repl-check`의 `normal`·`cdn-blocked` 결과를
  누락한다. RD-018 완료 시점엔 셋 다 우연히 통과라 실패 오탐은 없었지만, `normal`이나 `cdn-blocked`만
  깨지고 `not-isolated`가 통과하면 `summary.json`은 그 실패를 **못 본다** — 조용한 거짓 양성 위험.
- `apps/demo/e2e/BASELINE.md`가 `summary.json`과 절 단위로 대조할 때 이 셋을 구분할 방법이 없다.
- 현재 `apps/demo/e2e/README.md`(112행 근처)에 "알려진 제약"으로만 적혀 있고 고치는 작업은 없다.

## 왜 지금 고치지 않았나

RD-018(브라우저 회귀 하니스를 `_works/_completed/` → `apps/demo/e2e/`로 이관)의 스코프는 이관·배선
확인이었다. 개별 모드를 직접 실행하면 각각 올바른 결과 파일을 남기므로(문제는 `run.mjs`가 같은
스크립트를 모드별로 나눠 돌릴 때만 생긴다) RD-018의 완료 조건(수치 재현)은 개별 실행으로 전부
확인했고, `run.mjs`의 결과 파일 집계 방식 자체는 RD-018 DELTA-01이 만든 기존 구조라 변경 범위 밖으로
남겨뒀다.

## 다음에 이 이슈를 이어받을 때

`apps/demo/e2e/lib.mjs`의 `resultFileName()`을 프로세스 간에도 안정적으로 구분되게 고치거나(예: 모드를
label에 포함해 `repl-check-normal-dev.json`처럼 만들기), `apps/demo/e2e/run.mjs`가 `SETS`의 각 항목에
결과 파일 이름 힌트를 넘기게 한다(`finish({ label, suffix: "normal" })` 같은 추가 인자). `finish()`의
동작 불변 전제를 벗어나는 변경이니 고칠 때 `apps/demo/e2e/README.md`의 "알려진 제약" 문단도 함께
지우거나 갱신한다.

재현 방법: 서버 미기동 상태에서 `node apps/demo/e2e/run.mjs baseline` 실행 → `apps/demo/e2e/results/repl-check-dev.json`이
`not-isolated`(4/4)의 결과만 담고 있는지 확인.

## 참고

- `_works/_completed/20260923-18-rd-018-e2e-baseline/DELTA-02.md`(pending-issues/04.md 원문, 최초 발견).
- `apps/demo/e2e/run.mjs`(`SETS`), `apps/demo/e2e/lib.mjs`(`finish()`·`resultFileName()`).
