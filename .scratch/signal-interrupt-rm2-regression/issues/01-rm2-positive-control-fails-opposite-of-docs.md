# 01 rd-008 양성 대조 RM2 셀이 문서와 반대로 FAIL — `boot.ts` `signalInterrupt` 관련 기능 회귀 의심

Status: open

## 현상

`apps/demo/e2e/positive-controls/rd-008.py` #2는 `boot.ts`의 `signalInterrupt` 주입을
`signalInterrupt(interruptBuffer)` 대신 seq를 올리지 않는 `Atomics.store(interruptBuffer, 0, 2)`로
바꾸는 변조다. 스크립트 주석(원본 문서)은 "세션 첫 눌림(RM2)은 핸들러의 `last_seq`와 값이 달라 정상
처리된다"고 명시하지만, RD-018 DELTA-04에서 실제로 변조를 적용해 실행하면 `RM2`가 `T35`와 함께 **둘 다
FAIL**했다(시간 초과 — `input()` 취소가 전혀 일어나지 않아 화면이 `>>>`로 돌아오지 않는다).

`find` 문자열 자체는 현재 소스와 일치했다(경로·내용 변경 없이 그대로 적용됨) — 즉 대조 스크립트가
낡아서 생긴 문제가 아니라, 변조 적용 결과와 문서의 기대가 어긋난 것이다.

## 의심 원인(조사하지 않음, 가설만)

RD-008 완료 시점 이후 `boot.ts`의 세션 초기화·`signalInterrupt` 배선이 RD-010(세션 추출) 등으로 바뀌었을
가능성이 있다. 구체적으로 어느 커밋/변경이 `last_seq` 비교 로직이나 세션 첫 눌림 처리 경로를 바꿨는지는
확인하지 않았다.

## 왜 지금 조사하지 않았나

RD-018 DELTA-04(양성 대조 드라이버를 저장소 `apps/demo/e2e/positive-controls/`로 이관하는 작업)의
스코프는 이관·배선 확인이지 회귀 원인 규명이 아니다. rubber-workflow "멈추는 지점"에 따라 대조 대상·기대
셀을 스스로 바꾸지 않고 사용자에게 보고했고, 사용자는 "기대값을 지금 바꾸지 않는다. 원인 조사도 지금 하지
않는다. 후속 이슈로 등록한다"로 확정했다(2026-09-23). 전체 근거는
`_works/20260923-18-rd-018-e2e-baseline/DELTA-04.md`의 "## 결정" 절(rd-008 #2 항목)에 있다.

## 다음에 이 이슈를 이어받을 때

1. `boot.ts`의 `signalInterrupt` 호출부(주입 지점)와 핸들러의 `last_seq` 비교 로직을 RD-008 완료 시점
   커밋과 현재를 `git log -p`/`git blame`으로 대조해 어떤 변경이 세션 첫 눌림(RM2) 경로를 바꿨는지 찾는다.
   RD-010(세션 추출) 커밋군이 유력한 출발점.
2. 원인을 찾으면 두 갈래로 갈린다:
   - 의도된 동작 변화(예: 세션 첫 눌림도 이제 `last_seq` 초기값과 일부러 겹치게 설계됨)라면 `rd-008.py`의
     주석·기대 셀(RM2)을 실측에 맞춰 갱신하고, `apps/demo/e2e/positive-controls/rd-008.md`도 함께 고친다.
   - 실제 회귀(세션 첫 입력 취소가 case에 따라 씹히는 버그)라면 별도 버그 티켓으로 승격하고 `boot.ts` 수정.
3. 재현 방법: 변조 적용(`Atomics.store(interruptBuffer, 0, 2)`로 `signalInterrupt` 호출 대체) →
   `pnpm --filter demo dev` 기동 → `python3 apps/demo/e2e/positive-controls/rd-008.py 2` 실행 → `RM2`·
   `T35` FAIL 확인 → `git checkout -- packages/pyodide-repl/src/...boot.ts`로 원복.

## 참고

- `_works/20260923-18-rd-018-e2e-baseline/DELTA-04.md` "## 결과"(rd-008 3건 중 2건 정상 확인 부분)·
  "## 결정"(rd-008 #2 항목, 1차 결과·선택지 (a)~(c) 전문).
- `apps/demo/e2e/positive-controls/rd-008.py`, `apps/demo/e2e/positive-controls/rd-008.md`.
