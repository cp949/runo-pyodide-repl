# core `stdin-callback.ts`의 로그 접두어가 `[repl.worker]`로 남아 있다

Status: done
Origin: RD-020 마무리(코드 이동 뒤 관찰). demo worker 번들에 `[repl.worker]` 문자열이 3곳 남아 있다.

## 현상

core로 옮긴 worker 커널의 로그는 접두어를 `[worker]`로 바꿨으나 `packages/pyodide-core/src/worker/stdin-callback.ts:50`의 `console.warn`은
`[repl.worker] checkInterrupt가 SIGINT를 소비하지 않아 입력 취소를 EOF로 처리한다`를 그대로 쓴다. `docs/design/04-stdin-input.md` 3.1도 코드 그대로 `[repl.worker]`로 적혀 있다.
`packages/pyodide-repl/src/worker/repl-driver.ts`(`루프 오류`)·`repl-loop.ts`(`readLine 실패`)의 `[repl.worker]`는 REPL 쪽 로그라 맞다.
core를 REPL 없이 쓰는 소비자(RD-022 실행 driver)가 콘솔에서 `repl.worker`를 보게 된다. 동작에는 영향이 없다(브라우저 콘솔 문구만).

## 완료 기준

`grep -rn "\[repl.worker\]" packages/pyodide-core/src` 출력이 없다. 시험(`stdin-callback.test.ts`)·`04-stdin-input.md` 3.1의 문구가 함께 바뀐다.

## 재개 조건

RD-022가 core 로그 문구를 손대거나 core를 REPL 없이 쓰는 실행창이 생겨 접두어가 혼란을 줄 때. 문구만 바뀌므로 그 전에는 조사하지 않는다.

## Comments

- 2026-09-24 등록 시점 분류: 재현 가능한 사용자 시나리오·오작동이 없는 외관 문제라 `deferred`(`docs/agents/issue-tracker.md` "등록·분류 기준").
- 2026-09-26 재개 조건 충족 판정: 재개 조건 "core를 REPL 없이 쓰는 실행창이 생겨 접두어가 혼란을 줄 때"가 충족됐다. RD-022 `pyodide-terminal` 실행창·RD-024 `<PythonRunner>`가 core `boot.ts`를 쓰고 `boot.ts`가 `createStdinCallback`을 주입하므로(`packages/pyodide-core/src/worker/boot.ts:29`), REPL 없는 소비자도 이 경고를 본다. `deferred` → `open` → 같은 작업에서 처리.
- 2026-09-26 해결: 접두어를 `[worker]`로 바꿨다(`packages/pyodide-core/src/worker/stdin-callback.ts`, `docs/design/04-stdin-input.md` 3.1). `grep -rn "\[repl.worker\]" packages/pyodide-core/src` 0건(시험 파일 주석의 규칙 설명 1줄만 남는다). 이슈가 적은 시험 파일 `stdin-callback.test.ts`는 존재하지 않았으므로 새로 만들었다(시험 3개: 한 줄 반환·취소 전파·EOF 폴백 경고 문구). 문구 단언 시험은 수정 전 RED(`expected "[worker] …", received "[repl.worker] …"`) → 수정 후 3/3 GREEN이다. repl 쪽 `[repl.worker]` 로그 2곳(`repl-driver.ts` `루프 오류`·`repl-loop.ts` `readLine 실패`)은 REPL 로그라 그대로 둔다.
