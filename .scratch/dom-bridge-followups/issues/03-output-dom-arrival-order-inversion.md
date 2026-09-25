# dom-bridge에서 출력과 DOM 효과의 main 도착 순서가 역전되는 원인이 확인되지 않았다

Status: deferred
Origin: RD-023 DELTA-04 L1(2026-09-25). 판정 기준은 사용자가 "기록만, 필수는 누락 0·모든 `ok`"로 확정했다.

## 현상

dom-bridge에서 Python이 `print(..., flush=True)` 직후 동기 DOM 효과를 반복할 때, 출력(core RPC 알림, core `MessagePort`)과 DOM 효과(coincident 동기 호출 채널)가 main에 도착하는 순서는 **보장되지 않는다**. 두 채널이 서로 다르기 때문이다. `pnpm --filter demo e2e:dom-bridge`의 S6이 경로(core `createRunner` 직접·`<PythonRunner>` + terminal)와 DOM 효과 방식(C: `document.title` 대입 + `MutationObserver`, Ag: guarded `window`로 main 함수 호출, Ar: 가드 없는 창으로 호출)별로 5회 × 20쌍(100쌍)씩 역전 수(DOM 효과가 출력보다 먼저 도착한 쌍)를 판정 없이 기록한다.

관측(100쌍당 역전, `native: true`, Chromium dev, 누락 0·모든 실행 `ok`):

| 경로                        | C(title 대입)                                                     | Ag  | Ar  |
| --------------------------- | ----------------------------------------------------------------- | --- | --- |
| core `createRunner` 직접    | 0~5(진단 프로브 0, 새 기준 재실행 5: 실행별 2·0·2·0·1)            | 0   | 0   |
| `<PythonRunner>` + terminal | 60~90(첫 실행 60·진단 프로브 90·전체 재실행 60·새 기준 재실행 69) | 0   | 0   |

값은 실행마다 변동한다. RD-023 착수 조건 스파이크(core `createRunner` 직접, DOM 효과 `window` 함수 호출 방식)는 500쌍 중 0이었다. **이번 core 직접 5/100과 스파이크 0/500의 차이, view 경로에서 방식 C만 역전이 큰 이유는 원인을 확인하지 않았다.** 가설(검증하지 않았다): view 경로는 main이 xterm 렌더로 바빠 출력 알림 처리가 늦어질 수 있다. 원인 분리 프로브에서 역전은 view 경로와 방식 C가 함께일 때만 컸고(view + Ag/Ar 0, core + C 0), guard 유무(Ag 대 Ar)는 영향이 없었다.

이 상태는 기존 결정 "출력(비동기)·DOM(동기) 순서 역전은 허용하고 문서화한다"와 일치하고, 문서(`docs/design/16-dom-bridge.md` 16.9)는 "순서를 보장하지 않는다"고만 적는다. "0을 보장한다"고 쓰지 않는다.

## 재개 조건

- 출력과 DOM 호출의 도착 순서에 의존하는 소비자 요구가 생길 때.
- terminal 렌더 지연·채널 간 순서 가설을 검증해야 할 때. 검증하려면 view 경로에서 대입 방식을 바꿔 보거나 이벤트에 `performance.now()`를 더해 도착 시각을 비교하는 추가 프로브가 필요하다(브라우저 L1 예산 소모).

## Comments

- 2026-09-25 등록: `deferred`(`docs/agents/issue-tracker.md` "등록·분류 기준": 측정값이 참고값에서 벗어난 것 + 원인 불명). 원시 자료: `_works/_completed/20260925-32-rd-023-dom-bridge/verify/delta04/{probe,run2,run3,run4,fix4}/`(병합 뒤 이동 예정 경로).
