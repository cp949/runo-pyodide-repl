# TRP-023 하니스의 알림 이름 목록에 새 ntf를 안 넣으면 조용히 버려진다

- 상태: ACTIVE
- 적용 조건: `worker/boot.test.ts` 스타일 하니스(`createMainSide()`가 알림 핸들러를 문자열 목록으로 만드는 것)에 새 RPC 알림(ntf)을 추가할 때. `boot.ts`·`session.ts` 등 실제 배선에는 새 ntf 이름을 넣었는데 하니스의 이름 목록은 고치지 않았을 때.

## 오해하기 쉬운 신호

- `waitFor(() => events.some(...))`가 5초 뒤 "기다리던 알림이 오지 않았다"로 실패한다. 원인이 "알림을 안 보냈다"(배선 결함)가 아니라 "하니스가 그 알림 이름을 모른다"(시험 코드 문제)인데, 타임아웃 메시지만으로는 구별이 안 돼 postMessage 스파이·타이밍 문제부터 의심하게 된다.
- worker 쪽 로그(`console.error` 등)도 없다 — 알림은 실제로 나갔다.

## 원인

`createMainSide()`의 `NOTIFICATIONS` 목록이 하드코딩돼 있어 새 ntf를 추가할 때 실제 배선과 별개로 이 목록도 직접 고쳐야 한다. 컴파일 타임에 안 잡힌다(핸들러 객체 타입이 `Record<string, ...>`라 이름이 타입으로 강제되지 않는다). worker가 `rpc.notify("crashed", ...)`를 불러도, main 쪽 `rpc.ts`의 `Object.hasOwn(handlers, name)` 검사가 걸리면 응답 없이 조용히 버린다 — 오류도 타임아웃 메시지도 없다.

## 탐지/회피

- 회피: 새 ntf를 추가하는 DELTA의 체크리스트에 "하니스 `NOTIFICATIONS`(또는 동급 목록) 갱신"을 명시적으로 넣는다.
- 탐지: 알림이 안 오는 것 같으면 `console.log`로 실제 `postMessage` 호출(`message.kind`, `message.name`)을 worker 쪽에서 임시로 찍어 "나가긴 했는데 하니스 events에 없다"인지부터 확인한다(RD-010 DELTA-04에서 이렇게 원인을 좁혔다).

참고: RD-010 DELTA-04(`_works/_completed/20260922-11-rd-010-session-reset/`).
