# 함정 색인

rubber-workflow의 "함정 → 장기 문서화" 기준(재발 조건 특정 가능, 성공처럼 보이는 신호, 재발 가능성)을 모두 만족해 승격한 항목이다. `docs/design/11-known-traps.md`는 이전 구현에서 이관한 목록이며 수정하지 않는다.

| ID                                                               | 제목                                                    | 상태   | 적용 조건                                                                                  |
| ---------------------------------------------------------------- | ------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------ |
| [TRP-001](./TRP-001-vite-dev-caches-failed-workspace-resolve.md) | vite dev가 워크스페이스 서브패스의 해석 실패를 캐시한다 | ACTIVE | `dist` 없는 클린 체크아웃의 `pnpm dev`, 새 패키지·서브패스 추가 시 `development` 조건 누락 |
| [TRP-002](./TRP-002-non-shared-view-breaks-sharing-silently.md) | 비공유 typed array를 postMessage로 넘기면 메모리 공유가 조용히 끊긴다 | ACTIVE | 초기화 프레임·`workerData`로 뷰를 넘길 때, 프레임에 SharedArrayBuffer 채널을 추가하거나 버퍼 생성 코드를 바꿀 때 |
| [TRP-003](./TRP-003-state-change-without-notify.md) | 상태를 되돌리는 쪽이 notify하지 않으면 반대편 대기가 영영 깨어나지 않는다 | ACTIVE | SharedArrayBuffer 상태를 양쪽이 `Atomics.wait`/`waitAsync`로 번갈아 기다리는 채널(메일박스)의 상태 전이를 추가·수정할 때 |
