# `sys`가 REPL 전역에 새는 편차 22 제거

Status: done
Origin: RD-004 그릴링(2026-09-21). `docs/design/10-parity-deviations.md` 22.

## 현상

worker가 `sys.ps1`/`sys.ps2`를 `pyodide.runPython("import sys\nsys.ps1 = ...")`로 `pyodide.globals`(= `__main__`)에서 실행해 `sys`가 사용자 네임스페이스에 남는다. 새 세션에서 `s` Tab 후보에 `sys`가 섞인다(3.14 pty의 새 REPL에는 없다).

## 후보

- `pyodide.pyimport("sys")` 프록시에 JS에서 대입(`sysModule.ps1 = ">>> "`)하면 전역이 오염되지 않는다. 두 줄 변경.

## 완료 기준(관찰 가능)

- 새 세션에서 `pyodide.runPython("'sys' in globals()")`가 `False`.
- RD-016 브라우저 기준선(58·129 시나리오)에서 `s` Tab 후보 기대값을 갱신해도 다른 실패가 늘지 않는다.
- `10-parity-deviations.md`에서 22를 지우고 `DESIGN.md`의 편차 건수를 맞춘다.

## 등록 시점

RD-016(Tab 완성) 착수 시 함께 처리한다. 기준선 비교 규칙("변경하려면 ROADMAP 항목으로 등록")에 따라 RD-004에서는 바꾸지 않았다.

## Comments

- 2026-09-24 재분류: `open` 유지(`docs/agents/issue-tracker.md` "등록·분류 기준"). 사용자에게 보이는 차이(새 세션 `s` Tab 후보에 `sys`)이고 관찰 가능한 완료 기준이 있다.
- 2026-09-24 완료(`dev`, 수정 `03605ed`). 수정: `worker/console.ts`의 `PROMPT_SETUP`(`runPython("import sys ...")`)을 `setPrompts()`로 교체 — `pyodide.pyimport("sys")` proxy에 JS에서 `ps1`/`ps2`를 대입하고 `finally`에서 `destroy()`. 이 방식을 고른 이유: `runPython`을 안 거치므로 `__main__`을 건드리지 않고, 임시 dict 대안보다 dict 생성·파괴가 없어 짧으며, `sys.ps1/ps2` 시험(`import sys; (sys.ps1, sys.ps2)`)이 그대로 통과해 동작이 확인됐다(임시 dict 대안은 시도하지 않았다). `createConsole`은 부팅과 세션 리셋(새 worker, `08-session.md`) 양쪽이 같은 경로라 리셋 뒤에도 해소된다.
- 검증(RED→GREEN): `pnpm exec vitest run src/worker/console.test.ts -t "사용자 전역에 남지"`(`packages/pyodide-repl`) 수정 전 `AssertionError: expected true to be false` 실패, 수정 뒤 `console.test.ts` 33/33 통과.
- L0: `pnpm check-types && pnpm lint && pnpm test` 통과(vitest 41파일 943/943), `pnpm build` 통과. 사용자 코드에서 `import sys` 없이 `sys.`를 쓰던 시험은 깨지지 않아 시험 수정 없음.
- L1: `apps/demo/e2e/checks/tab-check.mjs`의 관찰 단계를 `C11a 새 세션 "sys" in globals()가 False(편차 22 해소)` 단언으로 바꿨다(시간 판정 없음, `submit()`이 새 프롬프트를 기다린 뒤 출력 행을 읽는다, 9.7). `ONLY=C11 node e2e/checks/tab-check.mjs http://localhost:5173`(apps/demo에서) 7/7 통과, `finalRows` 첫 행 `False`, pageErrors 0. 첫 실행은 `open()`의 `page.goto` 직후 `Execution context was destroyed`로 판정 전에 종료했다(직전 `pnpm build`가 vite dev 서버를 재로드시킨 것으로 추정, 미조사) — 판정에 도달하지 못했으므로 같은 명령을 1회 다시 돌린 결과가 위 7/7이다. `pnpm --filter demo e2e:check` 27개 중 0개 실패.
- e2e에서 `sys.`를 쓰는 4개 스크립트는 코드로 확인해 실행하지 않았다: `input-cancel`(D1)·`stdin-input`(O1·O2)·`prompt-join`은 같은 입력 줄에 `import sys;`가 앞서고, `trailing-newline`은 46행 `import sys, warnings` 뒤 103행에서 사용하며 그 사이 세션 리셋·페이지 재로드가 없다.
- `s` Tab 후보에 `sys`가 섞임을 기대하는 e2e 단계는 없었다(`tab-check.mjs`의 `sys` 언급은 위 단계 하나).
- 문서: `10-parity-deviations.md` 22에 "(해소, 2026-09-24, `03605ed`)" 표시(번호 유지, 28·32와 같은 방식). `DESIGN.md` 건수는 `37건`이 RD-008 시점 최댓값 그대로 갱신되지 않아 있었으므로(RD-009~018이 28~44를 등록) `44건 등록: 해소 22·28과 동등 항목 23 포함`으로 정의를 적어 맞췄다. `BASELINE.md` 2절 `tab-check.mjs` 행 갱신.
- 정정 메모: 이슈 본문 "RD-016 브라우저 기준선(58·129 시나리오)"은 이전 구현(`pyodide-samples`)의 ID다. 현재 저장소의 대응은 `apps/demo/e2e/checks/tab-check.mjs`(C1~C14)와 `BASELINE.md` 2절 표다. 전체 기준선 대조(L2)는 돌리지 않았다(사용자 지시 때만).
