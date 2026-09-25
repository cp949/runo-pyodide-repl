# 07 core `runner-pyodide.test.ts`의 `stop() 폴백` 시험이 `expected 'stopped' to be 'restarted'`로 1회 실패했다

Status: deferred
Origin: RD-023 DELTA-02 L0(2026-09-25). 1회 관찰, 원인 미조사.

## 현상

루트 `pnpm test --force --concurrency=1` 2회차에서 `packages/pyodide-core/src/session/runner-pyodide.test.ts` > `재시작한 worker의 첫 interrupt(옛 worker가 종료 전까지 살아 있을 때)` > `stop() 폴백 뒤 새 worker의 interrupt()(Ctrl+C)는 옛 worker에 가로채이지 않는다`가 `expected 'stopped' to be 'restarted'`(`fallbackRestart`의 `stop()` 결과)로 실패했다. 같은 파일 단독 3회는 13/13 통과했고 이어진 3회차는 18/18이었다.

이 시험은 `test/roles/run-worker.ts`(`runWorker`를 쓰지 않고 `parseInitFrame` + `bootWorker` 직접 호출)를 쓰고 `plugins`가 없으면 `bootWorker`에 추가된 대기가 없으므로 당시 변경(core `plugins`·init 버퍼링)이 닿는 경로가 아니다(코드 읽기 근거). 같은 실행에서 repl `sigint-handler-sleep-slice`의 시간 판정도 별도 회차에 실패했다(04 Comments).

로그: `_works/_completed/20260925-32-rd-023-dom-bridge/verify/delta02/l0-test-force-concurrency1-rerun.log`(실패), `.../runner-pyodide-alone-x3.log`(단독 3회 통과), `.../l0-test-force-concurrency1-run3.log`(통과). 병합 뒤 이동 예정 경로.

## 재개 조건

같은 시험이 다시 실패하거나 같은 파일 단독 N=10에서 1회 이상 재현되면 `open`으로 바꾸고 로그 경로·수치를 `## Comments`에 남긴다. `stop()` 폴백이 `stopped`로 끝나는 조건(옛 worker 종료 시각과 폴백 타이머의 경쟁 등)은 추정이며 조사하지 않았다. 관련 규칙은 `docs/traps/TRP-049`. 그 전에는 조사하지 않는다(`docs/agents/issue-tracker.md` "등록·분류 기준").

## Comments

- 2026-09-25 등록 시점 분류: 1회 관찰·원인 불명 간헐 실패 → `deferred`.
