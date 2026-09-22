# TRP-021 코루틴 프레임 안의 동기 `time.sleep` 중단은 우리 파일명이 든 트레이스백을 한 번 더 찍는다

- 상태: ACTIVE
- 적용 조건: `async def main(): time.sleep(...)`처럼 **코루틴 프레임 안에서 동기 `time.sleep`(조각 래퍼)을 직접** 부르고 그 코루틴을 `asyncio.run(main())`·`run_sync(main())`으로 돌리는 중 Ctrl+C. 중단 화면의 형식을 시험·브라우저 확인으로 판정할 때.

## 오해하기 쉬운 신호

- `expect(screen.stderr.endsWith(CONSOLE_TRACEBACK)).toBe(true)`가 **통과**한다. 화면의 **마지막** 트레이스백은 콘솔 `formattraceback`이 만든 3줄 표준형이라 끝만 보는 단언은 전부 통과한다.
- 나머지 판정도 전부 정상이다: 프롬프트 복귀 20/20, 복귀 지연 중앙값 26~27ms(문턱 안), `pageerror` 0.
- 같은 모양의 다른 조합은 깨끗해서 "이 경로는 문제 없다"고 일반화하기 쉽다. `async def main(): while True: await asyncio.sleep(0.1)`(await만 하는 코루틴)은 트레이스백 1개·우리 프레임 0으로 20/20 통과한다.

## 원인

화면에 트레이스백이 **둘** 나오고 첫째에 우리 내부 파일명이 그대로 있다.

```txt
Traceback (most recent call last):
  File "<sigint-handler>", line 133, in guard
  File "<console>", line 5, in main
  File "<sleep-slice>", line 109, in sleep
  File "<sleep-slice>", line 69, in poll
  File "…/pyodide.asm.mjs", line 1, in checkInterrupt
  File "wasm://wasm/…", line 1, in null.<anonymous>
  File "<sigint-handler>", line 110, in sigint_handler
KeyboardInterrupt
Traceback (most recent call last):
  File "<console>", line 1, in <module>
KeyboardInterrupt
```

첫째는 `guard` Task가 취소되는 정리 경로에서 pyodide가 그 Task의 예외를 `sys.excepthook`으로 한 번 더 찍는 것이다. 조각 래퍼(`sleep-slice.py`)가 excepthook을 무음으로 바꾸는 창은 `poll()`(= `pyodide_js.checkInterrupt()`) **호출 동안만**이고, 예외가 코루틴 밖으로 전파되는 이 시점은 창 밖이다. `formattraceback` 절단은 콘솔이 만드는 마지막 트레이스백에만 적용되므로 첫째는 자르지 못한다.

사용자 코드가 `await`로만 기다리면 조각 래퍼 프레임 자체가 없어 이 경로를 타지 않는다. 즉 조건은 "코루틴을 감싸 도는 것"이 아니라 **"감싸인 코루틴 프레임 안에서 동기 sleep 조각을 직접 부르는 것"**이다.

## 탐지/회피

- 화면 형식 판정에 **우리 프레임 부재를 별도 단언으로** 넣는다: 화면 전체에 `<sigint-handler>`·`<sleep-slice>`·`<webloop-reraise>`·`webloop.py`가 없다. `endsWith(CONSOLE_TRACEBACK)`만으로는 잡히지 않는다.
- 트레이스백 **개수**를 센다(시간 기반 중단은 정확히 1개).
- 이 조합은 알려진 편차다(`docs/design/10-parity-deviations.md` 28). 새 확인을 짤 때 "전부 통과"를 기대값으로 쓰지 말고 해당 셀을 편차로 표시한다 — 실측에서 `arun-sleep`·`runsync-sleep` 두 셀이 N=20 전량(40/40) 이 형태다.
- excepthook을 대체하지 않고 막는 길이 있다: `guard` 코루틴이 `KeyboardInterrupt`를 `CancelledError`처럼 정상 값으로 바꾸고 `run_sync` 래퍼가 사용자 스택에서 올리면, 예외가 Task 결과로 JS 경계를 넘지 않아 excepthook 경로를 타지 않는다(node 확인 2026-09-22, `ROADMAP.md` RD-009a). 그 전까지는 등록된 편차로 두고 판정에서만 명시적으로 제외한다. `poll()` 창을 콘솔 실행 전체로 넓히는 안은 사용자가 바꾼 excepthook과 충돌하므로 쓰지 않는다.
