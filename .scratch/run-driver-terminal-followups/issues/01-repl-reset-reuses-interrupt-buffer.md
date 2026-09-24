# REPL `reset()`이 옛 worker와 같은 interrupt buffer를 재사용해 실행 중 리셋 직후 첫 Ctrl+C가 가로채일 수 있다

Status: open
Origin: RD-022 마무리(core `createRunner`의 같은 결함을 고치며 발견). 사용자 결정(2026-09-24): 후속 이슈로 등록한다.

## 현상

core `createRunner`는 폴백·`reset()`으로 재생성한 worker에서 첫 interrupt가 유실되는 결함이 있었다. 원인은 옛 worker가 `terminate()` 뒤에도 Chromium에서 최대 약 2초 살아 같은 interrupt buffer를 폴링하며 눌림 하나를 소비·ack하고 `KeyboardInterrupt`를 삼키는 것이다(`docs/traps/TRP-049`). core는 worker(세션)마다 새 buffer·송신기를 만들도록 고쳤다(`docs/design/14-runner.md` 14.3.5).

`packages/pyodide-repl/src/index.ts`의 `reset()`·`spawnSession()`(113~155행 부근)은 `createRepl` 생성 시 한 번 만든 `interruptBuffer`·`interruptSender`를 새 세션에도 그대로 싣고 `Atomics.store(interruptBuffer, SIGNAL, 0)`으로만 지운다. Python이 실행 중(예: `KeyboardInterrupt`를 삼키는 루프, `while True: pass`)일 때 `reset()`하면 옛 worker가 종료 전까지 새 세션의 첫 Ctrl+C를 소비할 수 있다. core 통합 시험 "실행 중 reset()으로 만든 worker의 interrupt()는 옛 worker에 가로채이지 않는다"(`packages/pyodide-core/src/session/runner-pyodide.test.ts`)가 같은 경로에서 수정 전 코드로 RED였다. **REPL에서 실제로 재현되는지는 확인하지 않았다**(RD-022는 REPL 수정 금지 범위였고 REPL L1을 이 경로로 돌리지 않았다).

재현 시나리오(브라우저, REPL): (1) `while True:` + `try/except KeyboardInterrupt: pass` 루프를 실행한다 (2) 실행 중 세션 리셋 (3) 새 세션에서 `while True: pass`를 실행하고 리셋 후 약 2초 안에 Ctrl+C.

## 완료 기준

1. 재현 확인: 위 시나리오를 N회(예: 8) 반복하는 브라우저 프로브로 유실 횟수를 측정해 `## Comments`에 남긴다(수정 전). 재현되지 않으면 사유(REPL 리셋이 옛 worker를 먼저 종료시키는 순서 등)와 함께 `wontfix` 또는 문서 한 줄로 닫는다.
2. 재현되면 REPL도 세션마다 buffer·송신기를 새로 만들고(Ctrl+C 핸들러가 현재 송신기를 늦게 읽게 한다) `reset()`의 `Atomics.store(SIGNAL, 0)`을 없앤다. 같은 프로브의 유실이 0이다.
3. 회귀: `e2e:session-reset` 25/25, Ctrl+C 계열 L1(`e2e:ctrl-c` 10/10 등 `BASELINE.md`)과 REPL 단위 시험이 그대로 통과한다.
4. 문서: `docs/design/03-ctrl-c.md` 2절("세션 리셋 뒤 같은 버퍼를 재사용해도")·`docs/design/08-session.md` 8.1의 2번, `docs/design/14-runner.md` 14.3.5의 "REPL은 재사용한다" 문구를 함께 고친다.

## 참고

- 프로브 스크립트(core runner용): `_works/_completed/20260924-26-rd-022-run-driver-terminal/verify/probe-fallback-ctrlc-delta03a.mjs`(REPL 화면에는 그대로 쓸 수 없고 시나리오를 옮겨야 한다). 브라우저 확인 전에는 vite dev 서버를 재시작하고 `curl`로 서빙 본문을 대조한다(`docs/traps/TRP-007`).
- RD-010(세션 리셋)·RD-007~009(Ctrl+C) 회귀가 걸린다. 배선 중복(`02`)과 함께 다루면 공통 도우미로 뽑을 기회이다.

## Comments

- 2026-09-24 등록 시점 분류: 제품 결함 후보로 사용자 시나리오·완료 기준은 있으나 REPL 재현은 미확인이다. 사용자가 후속 이슈로 등록하기로 확정해 `open`으로 둔다(`docs/agents/issue-tracker.md` "등록·분류 기준"의 1회 관찰·원인 불명 `deferred` 규칙보다 사용자 확정이 우선). 착수 첫 단계가 재현 프로브(완료 기준 1)다.
