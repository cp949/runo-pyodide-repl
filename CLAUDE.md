## Agent skills

### Issue tracker

이슈는 `.scratch/<feature-slug>/` 아래 로컬 마크다운 파일로 관리한다. See `docs/agents/issue-tracker.md`.

### Domain docs

멀티 컨텍스트 — 앱/패키지별 `CONTEXT.md`를 루트 `CONTEXT-MAP.md`가 가리킨다. See `docs/agents/domain.md`.

### 작업 실행 (rubber-workflow)

브레인스토밍으로 확정한 작업이나 `ROADMAP.md`의 RD 항목 하나를 실행할 때는
rubber-workflow(DELTA 단위, 탄력적 추가, `dev` 브랜치 + 재그룹화 병합)를 따른다. See
`docs/agents/rubber-workflow.md`.

### e2e·반복 측정 최소화

브라우저 e2e(전체 `e2e:baseline` 약 8분 이상)와 반복 측정은 필요한 만큼 돌릴 수 없다. 계획 단계에서
검증 실행 예산을 적는다: 전체 baseline은 작업 폴더 전체에서 1회 이하, RED는 기존 로그·브라우저 없는
하니스·개별 스크립트 순으로 가장 싼 수단, 수정 후엔 실패한 스크립트 하나만 재실행. 예산 초과는 실행 전
사용자 확인. See `docs/agents/rubber-workflow.md` "검증 실행 예산".

### 설계 문서

`DESIGN.md`가 색인이다. RD 항목을 시작하기 전에 `DESIGN.md`의 읽기 순서를 따라
`docs/design/00-architecture.md`, `01-protocols.md`, 해당 기능 절을 읽는다. 결정 기록은
`docs/adr/`, 용어는 `CONTEXT-MAP.md`. 이전 구현(`/work/cp949/pyodide-samples/apps/repl`)은
읽기 전용 참고이며 coincident 동기 브리지는 쓰지 않는다(ADR-0001).
