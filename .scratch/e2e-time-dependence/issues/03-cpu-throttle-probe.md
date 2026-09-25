# 03 CPU 감속 실행으로 시간 의존 판정을 찾는 수단을 만든다

Status: done
Type: research

## 목적

이슈 01·02의 "느린 장비에서 결과가 바뀐다"는 코드 읽기 추정이다. 개발 장비에서 느린 장비를 재현해 실제로 어느 판정이 바뀌는지
확인할 수단이 없다.

## 제안(미검증)

Playwright CDP 세션으로 CPU를 감속한다.

```js
const cdp = await page.context().newCDPSession(page);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
```

- `lib.mjs` `open()`에 `E2E_CPU_THROTTLE=<배율>` 환경변수로 켜는 선택지를 둔다(기본 꺼짐).
- 가정: `setCPUThrottlingRate`가 Web Worker(pyodide 실행 스레드)에도 적용되는지 확인되지 않았다. 적용되지 않으면 메인 스레드
  (xterm 렌더·입력)만 느려진다 — 첫 단계에서 worker 안 바쁜 루프 시간을 감속 전후로 재서 확인한다.

## 한계

- 감속 시 **실패**로 드러나는 것은 상한 판정(이슈 02)과 고정 대기 뒤 존재 확인이다.
- 고정 대기 뒤 부재 확인(이슈 01)은 감속하면 오히려 **통과**한다. 이 부류는 양성 대조(결함 주입 + 감속 → 여전히 실패하는지)로만
  검출력 상실을 드러낼 수 있다.

## 다음에 이어받을 때

1. worker 적용 여부 확인(위 가정).
2. 이슈 02의 세 스크립트만 `rate: 4`로 `ONLY=` 실행해 결과를 이 파일 Comments에 기록한다. 전체 `e2e:baseline` 감속 실행은
   하지 않는다(검증 실행 예산, `docs/agents/rubber-workflow.md`).

## Comments

- 2026-09-24 재분류: `deferred`(`docs/agents/issue-tracker.md` "등록·분류 기준"). 이슈 01·02의 보조 수단이라 둘이 `open`이 될 때 함께 재개한다.
- 2026-09-26 worker 적용 여부 실측(`apps/demo/e2e/measure/cpu-throttle-probe.mjs`, `pnpm --filter demo e2e:cpu-throttle`, dev 서버, rate당 4회 실행·첫 회 버림·표본 3 중앙값, 결과 JSON·원시 로그는 작업 폴더 `verify/`): **메인 적용 ○ (rate에 비례) / worker 적용 ×.**

  | rate | 메인 고정 작업(ms) | worker 고정 작업, 페이지 시계(ms) | worker 고정, Python 시계(ms) | worker 시간 한정 반복 횟수 |
  | ---- | ------------------ | --------------------------------- | ---------------------------- | -------------------------- |
  | 1    | 199.8 (1)          | 310.1 (1)                         | 297.7 (1)                    | 4,062,170 (1)              |
  | 2    | 406.9 (2.04)       | 313.6 (1.01)                      | 300.4 (1.01)                 | 4,067,768 (1)              |
  | 4    | 812.3 (4.07)       | 313.8 (1.01)                      | 302.3 (1.02)                 | 3,957,870 (1.03)           |
  | 8    | 1653.9 (8.28)      | 314.6 (1.01)                      | 300.2 (1.01)                 | 4,032,725 (1.01)           |

  괄호는 rate 1 대비 배율. 메인 스레드는 명목 배율대로 늦어지고 worker는 rate 8에서도 1.01배다(세 기준 일치). 시간에 묶인 루프(`while time.time()-t<0.5`)의 벽시계 소요는 507.6~522.3ms로 rate와 무관해서, 소요만 재면 적용 여부를 못 가리므로 고정 작업량과 반복 횟수를 함께 쟀다. 소요 시계는 페이지 `performance.now()`. 결론: `E2E_CPU_THROTTLE`은 xterm 렌더·입력(메인 스레드)만 늦추고 worker(Python 실행·`call_later` 타이머·SIGINT 처리)는 늦추지 못한다. 확정 4에 따라 대체 부하 주입은 하지 않았다. 남은 가정("worker 타깃에 별도 CDP 세션을 붙이면 걸리는가")은 시험하지 않았다. 1회 실행·dev 서버라 반복 편차는 재지 않았다. Status는 이 작업 DELTA-05에서 바꾼다.

- 2026-09-26 완료(`done`), 한계 문서화. 결정(사용자 확정 2026-09-26): 프로브 `measure/cpu-throttle-probe.mjs`(`e2e:cpu-throttle`)와 `E2E_CPU_THROTTLE`(`lib.mjs`, 기본 1)을 유지하고 아래 한계를 `apps/demo/e2e/README.md`에 적는다.
  - 감속은 **메인 스레드(xterm 렌더·입력)만** 늦춘다. rate 4에서 메인 4.07배, worker 1.01배(rate 2/4/8 모두 worker 1.01~1.03배, 위 표).
  - **worker(Python 실행·`call_later` 타이머·SIGINT 처리)에는 적용되지 않는다.**
  - **감속 통과는 판정선 견고성의 증거가 아니다.** 이슈 02 대상 3곳을 `E2E_CPU_THROTTLE=4`로 수정 전(`ONLY=C12`·`EC`·`TICK`)·수정 후 각 1회 돌려 모두 통과했다(RED 0건). worker 쪽 지연은 시험되지 않았다.
  - 등록한 완료 조건 대비: "worker 적용 여부가 수치로 판정된다"는 위 rate별 표(메인 ○·worker ×, 세 기준 일치)로 충족한다. 이 이슈가 예상한 "감속 시 실패로 드러나는 것"은 이번 3곳에서는 나오지 않았다.
  - 남은 가정("worker 타깃에 별도 CDP 세션을 붙이면 `Emulation.setCPUThrottlingRate`가 걸리는가")은 시험하지 않았고 후속 이슈 `05-worker-cpu-throttle.md`(`deferred`)로 등록했다.
