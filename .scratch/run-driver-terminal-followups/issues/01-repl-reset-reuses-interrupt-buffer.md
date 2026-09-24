# REPL `reset()`이 옛 worker와 같은 interrupt buffer를 재사용해 실행 중 리셋 직후 첫 Ctrl+C가 가로채일 수 있다

Status: done
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

- 2026-09-24 RD-022a 마무리 관찰: 이 결함은 REPL `runSource` 실행에도 해당한다. 실행 중(`{ source }`를 보낸 뒤 결말 도착 전) `reset()`은 결과를 `{ kind: "restarted" }`로 끝내고 옛 worker와 같은 interrupt buffer를 새 세션에 싣기 때문에, 그 직후 첫 Ctrl+C(재현 시나리오 3단계)가 옛 worker에 가로채일 수 있다. RD-022a는 이 이슈를 범위에서 제외했다(확정 14). 브라우저 확인 `run-source-check.mjs` S08은 `restarted` 뒤 REPL 명령만 돌리고 Ctrl+C 셀이 없어 이 경로에 닿지 않았고, 재현은 확인하지 않았다. 완료 기준 4의 문서 수정 대상에 `docs/design/02-console-core.md` 5.6.7("interrupt buffer 재사용")이 추가된다. 분류는 그대로 `open`.

- 2026-09-25 RD-024 관찰: `<PythonRepl>`(`@cp949/runo-pyodide-react`)의 handle `reset(options?)`는 살아 있는 `createRepl` 핸들의 `reset()`을 그대로 부르는 위임뿐이고 세션·interrupt buffer 배선을 갖지 않는다. 그래서 이 이슈의 결함은 컴포넌트를 거쳐도 같은 조건에서 그대로이고(재현 여부는 여전히 미확인), 수정은 repl 패키지만 고치면 컴포넌트에 전파된다. 분류는 그대로 `open`.

- 2026-09-25 종결(`Status: done`). 브라우저 재현 절 `ccafter`(`apps/demo/e2e/checks/session-reset-check.mjs`, 실행 중 삼키는 루프에서 `reset()` → 새 세션에서 `while True: pass` 후 곧바로 Ctrl+C, N=8)를 추가해 재현을 확인하고 고쳤다. 완료 기준 4개 결과:
  1. 재현(수정 전): **유실 1/8**(회차 5, 두 번째 Ctrl+C로 복구, 7/8 통과). 재현율은 core 폴백 프로브(수정 전 6/8)보다 낮다.
  2. 수정: `packages/pyodide-repl/src/session.ts`의 `startSession`이 세션마다 `createInterruptBuffer()`·`createInterruptSender()`를 만들고, `ReplSession.interrupt()`가 그 송신기로 보낸다. `index.ts`의 Ctrl+C 핸들러는 `session.interrupt()`를 부르고 `reset()`의 `Atomics.store(SIGNAL, 0)`은 없앴다. 수정 후 `ccafter` **0/8**, 2회 실행(단독 1회 + 전체 실행 안 1회) 총 16회 전부 통과.
  3. 회귀: `e2e:session-reset` 26/26(9절, `crash` 절 forced pageerror 1건은 등록된 예외), `e2e:ctrl-c` 10/10(pageErrors 0), REPL 단위 시험 143/143(`packages/pyodide-repl/src/index.test.ts`).
  4. 문서: `docs/design/03-ctrl-c.md` 2.4·2.6, `08-session.md` 8.1, `00-architecture.md` 3.4·4.1·4.2, `01-protocols.md` S7, `02-console-core.md` 5.6.7, `14-runner.md` 14.3.5, `09-testing.md`, `docs/traps/TRP-049`, `packages/pyodide-core/CONTEXT.md`, `docs/adr/0006`에서 "REPL은 buffer를 재사용한다" 서술을 "worker(세션)마다 새 buffer"로 통일했다. 리셋 순서(8.1)에서 `SIGNAL=0` 단계가 빠져 번호가 하나씩 당겨졌다.
- 단위 시험(`packages/pyodide-repl/src/index.test.ts`, `describe("reset()(RD-010)")`): RED→GREEN 확인(수정 전 코드에서 3 failed | 12 passed, 수정 후 143/143). 교체 2건과 신규 1건.
  - "reset은 cancelRead → rpc dispose(port.close) → worker.terminate 순서로 옛 세션을 끝내고, 새 buffer로 시작하며 옛 송신기도 멈춘다"(제목·단정 교체: 리셋이 `SIGNAL`을 지우지 않고 새 프레임의 buffer가 0으로 시작한다)
  - "reset은 새 interruptBuffer를 새 프레임에 싣고 createWorker를 다시 부르며, 옛 worker만 terminate된다"(제목·단정 교체: 같은 `SharedArrayBuffer` 단정 → 다른 buffer)
  - "리셋 뒤 Ctrl+C는 새 buffer에만 SIGINT를 쓰고 옛 buffer 슬롯은 리셋 시점 값 그대로다"(신규)
  - 변이 검사: 핸들(readline) 수명 buffer 재사용(수정 전 동작과 같다)으로 되돌리면 이 3건만 실패(3 failed | 140 passed).
- 한계(과장 없이): 수정 전 유실이 1/8이라 수정 후 0/8은 수정 전 통과 표본(7/8)과 모양이 같다. `ccafter` 하나로는 수정 효과를 통계적으로 입증하지 못한다. 인과는 (a) 위 단위 시험(리셋 뒤 눌림이 새 buffer에만 쓰인다), (b) core 폴백 프로브 선례(같은 원인에서 수정 전 6/8·수정 후 0/8)가 뒷받침한다. 표본을 늘리는 실행(N 증가)은 하지 않았다. 옛 buffer 슬롯을 브라우저에서 직접 관측하지도 않았다. `runSource` 경로(`reset()` → `restarted` → Ctrl+C)는 같은 `reset()`을 쓰지만 전용 브라우저 셀·단위 시험을 추가하지 않았다. `<PythonRepl>`은 이 핸들의 `reset()`을 위임하므로 수정이 전파된다.
- 검증 파일(로컬, `_works/`는 gitignore 대상): `_works/_completed/20260925-30-repl-reset-fresh-interrupt-buffer/verify/` 아래 `delta-01/`(수정 전 `console.log`, `results/session-reset-check-dev.json`, 서빙 본문 대조 `served-*.ts`), `delta-02/`(`red.txt`, `mutation.txt`), `delta-03/`(수정 후 `console-2-ccafter.log`·`console-3-session-reset.log`·`console-4-ctrl-c.log`, `results/run{2,3,4}-*.json`). 기준선 행은 `apps/demo/e2e/BASELINE.md`의 session-reset·ctrl-c 행.
- 이슈 02는 `deferred` 유지한다(같은 날 Comments 참고).
