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

## Comments

- 판정(2026-09-23, 그릴링 13건 확정, 구현은 다른 에이전트): **회귀가 아니다. 문서(드라이버 docstring) 오류다.**
  위 "의심 원인"의 RD-010 가설은 근거 없음 — `boot.ts`의 `signalInterrupt`·`seq` 배선, `interrupt-protocol.ts`의
  `signalInterrupt`, `sigint-handler.py`의 `last_seq = seq()`/`if s == last_seq: return`은 RD-007 `40f559d` 도입
  이래 RD-008 완료 커밋 `8c282d1`과 HEAD `5fdd12d` 사이에 불변이고, `stdin-callback.ts`는 RD-008 이후 커밋 0건이다.
  RD-010이 리셋 간 같은 `interruptBuffer`를 재사용하고 `SIGNAL`만 지우는 것은 설계다(`docs/design/03-ctrl-c.md`
  65~66행, ROADMAP RD-010 인계). 첫 세션의 RM2·T35에는 무관하다.

- 근거 1(실측): RD-008 자체의 로그 `_works/_completed/20260922-08-rd-008-prompt-and-input-cancel/verify/results/positive-control-2.log`
  (2026-09-22 15:23)가 변조 시 `T35`·`RM2` **둘 다** 시간 초과 FAIL, 원복 후 둘 다 PASS 2/2를 기록한다. RD-018
  DELTA-04의 관찰과 문자 그대로 같다. 즉 "RD-008 시점에는 주석대로 동작했다"는 이 이슈의 전제가 틀렸다.

- 근거 2(당시 정정): 같은 RD-008 `DELTA-05.md` "발견/처리" 절이 "계획의 결정 '양성 대조 ②에서 RM2는 통과한다'는
  틀렸다 … 번호를 올리지 않는 전송은 세션의 첫 취소부터 재전송으로 오인돼 버려진다"로 정정했고, ROADMAP RD-008
  인계(143행)와 `stdin-callback.test.ts`의 TRP-035 시험 주석도 그때 고쳤다. 정정에서 빠진 곳이 둘이다:
  (1) 드라이버 `verify/positive-controls.py` docstring #2(mtime 15:10, 실측 로그 15:23보다 앞) — 이것이 RD-018
  `7aab112`로 `apps/demo/e2e/positive-controls/rd-008.py` 12~13행에 그대로 복사됐다.
  (2) `DELTA-05.md` "## 결정" 첫 항목(105행, "세션의 첫 취소는 … 항상 다르므로 번호를 올리지 않아도 처리된다") —
  같은 절 네 번째 항목(108행)과 모순.

- 근거 3(기전, 왜 EOFError가 아니라 시간 초과인가): `stdin-callback.ts` 43~53행은 `wait()`가 null이면
  `signalInterrupt()`(정상: `SEQ+1` 후 `SIGNAL=2`) → `checkInterrupt()`. pyodide 314.0.7 `checkInterrupt`는 GIL이
  풀린 stdin 콜백에서 seq와 무관하게 `buf[0]===2`이면 EINTR을 던지고, CPython(PEP 475)이 신호를 폴링해 Python
  핸들러를 부른다. 변조는 `SEQ`를 안 올리므로 부팅 시 `last_seq`(0)와 같아 핸들러가 예외 없이 `return` →
  CPython이 읽기를 재시도 → 콜백 재진입 `requestInput(true)` → 프롬프트 없이 대기 → 하니스 `waitPromptTail(15000)`
  시간 초과. RD-008 `DELTA-05.md` 19행·`stdin-callback.test.ts` TRP-035 시험(`countWaits === 2`, ack 불변)·
  `docs/design/09-testing.md` 82행이 이미 이 기전을 기록한다. 정상 경로는 `signalInterrupt`가 항상 `SEQ+1`이라
  세션 첫 Ctrl+C가 씹힐 구조가 없다(기준선 `BASELINE.md` 46행 `RM2,EC` 3/3 통과).

- 결정(그릴링 확정 13건 요약): 작업 폴더·ROADMAP 등록 없음, `dev`에서 `docs:` 커밋으로 처리. `rd-008.py` #2는
  실행 목록(T35·RM2) 유지하고 docstring만 실측대로. 완료 아카이브는 원문 보존 + 정정 덧붙임. 허용 예외 목록에서
  rd-008 #2 제거(예외 1건 = rd-007 #3). 디렉터리 이름 유지. 검증은 `rd-008.py 2` 1회 재실행. TRP 등록.
  `.scratch/sigint-test-isolation/` 01·02는 범위 밖(원인 겹침 없음).

### 정정 목록(구현 에이전트용, 파일·행 기준은 dev `5fdd12d`)

1. `apps/demo/e2e/positive-controls/rd-008.py` 12~13행 docstring #2:
   현재 "ONLY=T35 실패(…), ONLY=RM2는 통과(세션 첫 눌림은 핸들러 last_seq와 달라 처리된다 — T35를 따로 두는 이유)"
   → "ONLY=T35·ONLY=RM2 **둘 다** 실패(시간 초과 — 핸들러가 설치 시점 번호 0을 last_seq로 잡아 번호를 올리지
   않는 전송은 세션 첫 취소부터 재전송으로 오인, CPython이 읽기를 재시도해 프롬프트로 안 돌아온다). 이 대조는
   검출력 증명만 하고 국소성 증명은 #1·#3이 맡는다. T35는 '번호가 0→1 이후에도 전진해야 한다'를 고정하려 남긴다."
   `CONTROLS["2"]["scripts"]`는 손대지 않는다(T35·RM2 유지, 드라이버는 실패 셀을 단언하지 않고 보고만 한다).
2. `_works/_completed/20260922-08-rd-008-prompt-and-input-cancel/DELTA-05.md` 105행("## 결정" 첫 항목): 원문
   삭제 없이 항목 끝에 `[정정 2026-09-23: 계획 단계 문장. 실측은 RM2도 실패 — 같은 절 네 번째 항목·"발견/처리"
   참조. .scratch/signal-interrupt-rm2-regression/issues/01]` 덧붙임.
3. `apps/demo/e2e/BASELINE.md` 101~112행 "양성 대조(positive-controls) 허용 예외 2건": 제목을 "허용 예외 1건"으로,
   rd-008 #2 항목(109~112행)을 예외에서 빼고 같은 절에 "rd-008.py #2는 docstring 오류였다(T35·RM2 동시 실패가 정상
   검출, 이 이슈 파일 참조). 정정 뒤 재실행 로그는 아래 Comments." 한 줄로 대체. 102~104행 "이 둘을 예외로 확정" →
   "이 1건을 예외로 확정".
4. `ROADMAP.md` 603~606행 RD-018 완료 문장: "양성 대조 허용 예외 2건(rd-007.py #3 …, rd-008.py #2는 … 후속 이슈
   등록 — `.scratch/…`)" → "양성 대조 허용 예외 1건(rd-007.py #3 …). rd-008.py #2의 RM2 셀은 docstring 오류로
   판정돼 정정(`.scratch/signal-interrupt-rm2-regression/issues/01`)". 이슈 경로 링크는 유지.
5. `_works/_completed/20260923-18-rd-018-e2e-baseline/checklist.md` 195~198행(각주 `[^pc-exceptions]`)과
   217~219행(rd-008.py #2 항목): 원문 보존, 각각 끝에 `[정정 2026-09-23: docstring 오류로 판정, 예외 아님 —
   .scratch/signal-interrupt-rm2-regression/issues/01]` 덧붙임.
6. `docs/traps/TRP-029-<slug>.md` 신설 + `docs/traps/INDEX.md` 행 추가(TRP-028 형식 그대로: 제목, 상태 ACTIVE,
   적용 조건, "## 오해하기 쉬운 신호", "## 원인", "## 탐지/회피"). 내용: 계획 단계에 쓴 양성 대조 드라이버
   docstring(기대 실패·통과 셀)이 실측 뒤 정정 목록(ROADMAP 인계·시험 주석)에서 빠져 다음 RD로 그대로 이관됐다.
   적용 조건: 양성 대조 드라이버를 쓰거나 이관할 때. 탐지: 대조 실행 직후 docstring의 기대 셀과 `[변조]` 로그의
   PASS/FAIL을 셀 단위로 대조, 이관 시 원본 `results/positive-control-N.log`와 docstring 대조. 회피: 실측 뒤 정정
   대상에 드라이버 docstring과 DELTA "## 결정" 절을 포함, 결정 절의 계획 문장이 실측과 어긋나면 삭제하지 말고
   정정 표시.
7. 이 이슈 파일: 검증(아래 8) 뒤 `Status: done`으로 바꾸고 `rd-008.py 2` 재실행 로그의 `[변조]`·`[원복]` 4줄을
   Comments에 인용.
8. 검증: 깨끗한 트리(`git status --short` 빈 출력)에서 `python3 apps/demo/e2e/positive-controls/rd-008.py 2` 1회.
   기대: `[변조] … ONLY=T35: PASS 1, FAIL 1`, `[변조] … ONLY=RM2: PASS 1, FAIL 1`(둘 다 "시간 초과"), `[원복] …`
   둘 다 `PASS 2, FAIL 0`, "원복(git checkout) 후 깨끗함: True". 끝나면 dev 서버가 하나 남는다(TRP-007). 이
   드라이버는 1과 3, `input-cancel-check` 전체, `e2e:baseline`은 돌리지 않는다(실행 코드 불변, 사용자 확정).
   재실행 결과가 기대와 다르면 정정을 멈추고 보고한다(그 경우 이 판정이 틀린 것이다).
9. 커밋: `dev` 브랜치, `docs:` 접두, 한글, 정정 1~7을 한 커밋 또는 (문서 정정 / TRP 신설) 두 커밋. 실행 코드
   변경 0건이어야 한다(`git diff --stat`에 `packages/` 없음).

### 완료 조건

- 위 1~7 반영, 8의 기대 로그 4줄이 이 파일에 인용됨, 9의 커밋이 `dev`에 있음.
- `grep -rn "원인 미상\|원인은 조사하지 않았\|원인 미조사" apps/demo/e2e/BASELINE.md ROADMAP.md`가 rd-008 #2에
  대해 0건.
