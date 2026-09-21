# 함정 색인

rubber-workflow의 "함정 → 장기 문서화" 기준(재발 조건 특정 가능, 성공처럼 보이는 신호, 재발 가능성)을 모두 만족해 승격한 항목이다. `docs/design/11-known-traps.md`는 이전 구현에서 이관한 목록이며 수정하지 않는다.

| ID                                                               | 제목                                                    | 상태   | 적용 조건                                                                                  |
| ---------------------------------------------------------------- | ------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------ |
| [TRP-001](./TRP-001-vite-dev-caches-failed-workspace-resolve.md) | vite dev가 워크스페이스 서브패스의 해석 실패를 캐시한다 | ACTIVE | `dist` 없는 클린 체크아웃의 `pnpm dev`, 새 패키지·서브패스 추가 시 `development` 조건 누락 |
| [TRP-002](./TRP-002-non-shared-view-breaks-sharing-silently.md) | 비공유 typed array를 postMessage로 넘기면 메모리 공유가 조용히 끊긴다 | ACTIVE | 초기화 프레임·`workerData`로 뷰를 넘길 때, 프레임에 SharedArrayBuffer 채널을 추가하거나 버퍼 생성 코드를 바꿀 때 |
| [TRP-003](./TRP-003-state-change-without-notify.md) | 상태를 되돌리는 쪽이 notify하지 않으면 반대편 대기가 영영 깨어나지 않는다 | ACTIVE | SharedArrayBuffer 상태를 양쪽이 `Atomics.wait`/`waitAsync`로 번갈아 기다리는 채널(메일박스)의 상태 전이를 추가·수정할 때 |
| [TRP-004](./TRP-004-xterm-write-callback-runs-after-dispose.md) | xterm write 콜백은 `term.dispose()` 뒤에도 실행되고, 그 안의 `buffer` 접근은 경고만 남긴다 | ACTIVE | `term.write(text, callback)` 콜백 안에서 `term`에 접근하는 코드를 추가·수정할 때, 마운트 직후 읽기를 시작하는 코드를 StrictMode 아래에서 쓸 때 |
| [TRP-005](./TRP-005-automation-input-before-prompt-is-dropped.md) | 자동화 입력은 새 프롬프트가 보인 뒤에 보내야 한다(활성 읽기 전 키는 버려진다) | ACTIVE | 브라우저 하니스가 Enter 뒤 이어서 키를 보낼 때, 읽기를 요청하는 코드(REPL 읽기, `input()`)를 추가하거나 읽기 시작 경로를 바꿀 때 |
| [TRP-006](./TRP-006-row-text-check-misses-extra-blank-line.md) | 화면 행 텍스트만 비교하면 출력 끝의 여분 빈 줄을 놓친다(커서 행을 봐야 한다) | ACTIVE | Playwright로 xterm 화면의 출력 뒤 개행 수를 확인하는 하니스, 배너·값 에코·트레이스백·stderr 뒤 "빈 줄 없음"을 검증할 때 |
