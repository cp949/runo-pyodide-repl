# 01 `measure/burst-matrix.mjs`의 b5·b20·b50·c 셀이 `BASELINE.md` 4절 판정선과 다르게 실패한다

Status: deferred

## 현상

2026-09-24, chromium, 매번 새로 띄운 dev 서버, `apps/demo/e2e/measure/burst-matrix.mjs`:

| 코드                                           | 조건                      | a     | b1    | b5          | b20     | b50     | c       | d2    | d5    | warm-a |
| ---------------------------------------------- | ------------------------- | ----- | ----- | ----------- | ------- | ------- | ------- | ----- | ----- | ------ |
| `dev`(이슈 `sigint-test-isolation/02` 수정 전) | `N=10 COMBOS=b1,b5,b20,c` | —     | 10/10 | 5/10(DIRTY) | ABORTED | —       | ABORTED | —     | —     | —      |
| 이슈 `sigint-test-isolation/02` 수정 후        | `N=20` 9셀                | 20/20 | 19/20 | 12/20       | ABORTED | ABORTED | ABORTED | 20/20 | 20/20 | 20/20  |

- ABORTED 메시지: `시간 초과: Ctrl+L 뒤 첫 행의 >>> — 화면 끝 ["KeyboardInterrupt",">>>"]`.
- 실패 시행은 화면이 `KeyboardInterrupt` / `>>>` 반복이고 `tracebacks: 0, redraws: 0`. 대상 `pageerror` 0.
- `apps/demo/e2e/BASELINE.md` 4절 판정선: 9콤보 각 N=20, 180시행 전부 OK(RD-007 시점). 같은 절이 "재측정하지 않았다"고 적고
  있어 기준선 문서와 현재 결과가 어긋난다.

## 왜 지금 안 보이나

- `burst-matrix.mjs`는 `measure` 세트라 `run.mjs baseline`에 들어가지 않는다. 회귀 확인에서 돌리지 않으면 드러나지 않는다.
- 이슈 `sigint-test-isolation/02` 수정 전 코드에서도 같은 형태로 실패해 그 수정의 회귀가 아니다. 실패 셀은 바쁜 루프(핸들러
  규칙 ①) 경로다.

## 가설(미검증)

하니스는 실행이 끝난 뒤의 눌림이 활성 읽기에서 `>>> ^C` 한 행으로 다시 그려진다고 가정한다(`burst-matrix.mjs`의 `redraws`
주석). RD-007 뒤 프롬프트의 Ctrl+C 표시(`KeyboardInterrupt` + 새 `>>>`)가 바뀌었는데 하니스의 `redraws` 판정·`Ctrl+L` 뒤
첫 행 대기가 따라가지 않았을 수 있다. 이 경우 제품 결함이 아니라 하니스 기대 불일치다.

## 판단 근거

기준선 문서(`BASELINE.md` 4절)가 현재 동작을 반영하지 않아, 다음에 이 스크립트로 회귀를 판정하면 기존 실패를 새 회귀로
오판한다. 이슈 `sigint-test-isolation/02`의 범위(규칙 ③·`run_sync` 래퍼) 밖이라 여기 등록한다.

다음에 이어받을 때:

1. `dev`에서 `N=5 COMBOS=b5,b20,c`로 재현하고 실패 시행의 화면 전체를 저장한다.
2. 프롬프트 Ctrl+C 표시가 바뀐 RD를 `git log -- apps/demo packages/xterm-readline`로 찾아, 하니스 가정과 대조한다.
3. 하니스 기대 불일치면 `burst-matrix.mjs` 판정을 고치고 `BASELINE.md` 4절을 재측정값으로 갱신한다(판정선 변경은 사용자
   확인 대상). 제품 결함이면 별도 이슈로 나눈다.

## Comments

- 2026-09-24 재분류: `deferred`(`docs/agents/issue-tracker.md` "등록·분류 기준"). `burst-matrix.mjs`는 `measure` 세트(L3, 사용자 지시 때만)이고 `BASELINE.md` 4절은 참고값으로 바뀌어 게이트가 아니다. 하니스 기대 불일치인지 제품 결함인지 미확인. 재개 조건: 사용자가 `measure` 실행을 지시하거나, 수동으로 `while True: pass` 실행 중 Ctrl+C 5회 연타 뒤 프롬프트가 입력을 받지 않으면 `open`.
