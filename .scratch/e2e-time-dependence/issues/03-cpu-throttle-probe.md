# 03 CPU 감속 실행으로 시간 의존 판정을 찾는 수단을 만든다

Status: open
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
