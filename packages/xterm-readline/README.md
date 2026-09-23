# @cp949/runo-xterm-readline

[strtok/xterm-readline](https://github.com/strtok/xterm-readline) 1.2.2의 `src/*.ts`를 벤더링한 workspace 패키지. `private`이며 npm에 배포하지 않는다. 결정 배경은 `docs/adr/0003-vendor-xterm-readline.md`.

## 출처

| 항목     | 값                                              |
| -------- | ----------------------------------------------- |
| 원본     | `strtok/xterm-readline`                         |
| 버전     | 1.2.2                                           |
| 커밋     | `8869f17542bed618d8f389fea46c000089a8d9ad`      |
| 라이선스 | MIT (`LICENSE-MIT`, Copyright 2021 Erik Bremen) |

`LICENSE-MIT`와 저작권 고지를 유지한다. 원본 소스의 영어 주석과 시험 제목은 업스트림 diff를 위해 번역하지 않는다.

## 원본 대비 변경

`highlight`·`keymap`·`line`·`tty`·`vterm`은 원본과 바이트 동일하다. 변경은 아래로 한정한다.

| 종류           | 파일                                                                    | 내용                                                                                                                                                                                                                                                                                                                                                        |
| -------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `persist` 옵션 | `src/history.ts`                                                        | `HistoryOptions`, 생성자 2번째 인자 `{ persist?: boolean }`(기본 `true`). `false`면 `saveToLocalStorage`·`restoreFromLocalStorage`가 즉시 반환                                                                                                                                                                                                              |
| `persist` 옵션 | `src/readline.ts`                                                       | `ReadlineOptions`, 생성자 인자 `{ persist?: boolean }`을 `History`에 전달. `history`·`state` 필드 초기화를 생성자로 옮김(생성 순서는 원본과 같음)                                                                                                                                                                                                           |
| `dispose` 정책 | `src/readline.ts`                                                       | `dispose()`가 리스너를 해제하고 `term`을 비우며, 대기 중인 읽기(write 콜백 대기 중이라 `activeRead`가 없는 것 포함)를 `Error("readline disposed")`로 reject한다. 두 번째 호출은 무동작. 원본은 리스너만 해제해 dispose된 xterm에 write 콜백이 닿고(`DisposableStore` 경고) 읽기 promise가 끝나지 않았다. `pendingReads` 필드 추가, `read()`가 reject를 기록 |
| 취소 가능한 읽기 | `src/readline.ts`                                                     | `ReadOptions`, `read(prompt)` / `read(prompt, { cancelable })` 오버로드(반환 `Promise<string>` / `Promise<string \| null>`). `cancelable`이면 활성 읽기 중 Ctrl+C가 `moveCursorToEnd` → `refreshUnhighlighted` → `\r\n` → `resolve(null)`로 읽기를 끝낸다(`^C` 에코·history 없음, reject 없음). 옵션을 주지 않으면 원본 동작(`^C` + 같은 프롬프트 재그리기). `ActiveRead`에 `cancelable` 필드 추가 |
| 프리필           | `src/readline.ts`                                                     | `ReadOptions.prefill?: string`. `read()`의 write 콜백 안, `new State` 직후 1회 `state.update(prefill)`로 채운다(커서는 끝). 빈 문자열·미지정은 원본과 같이 `state.refresh()`만 부른다. `cancelable`이 아닌 읽기의 Ctrl+C 재그리기(같은 prompt로 `new State`)는 다시 채우지 않는다 |
| 키 훅            | `src/readline.ts`                                                     | `ReadOptions.onKey?: (input: Input) => boolean`. `readKey`가 `activeRead === undefined` 검사 뒤·`switch` 앞에서 호출하고, `true`면 벤더 처리를 생략한다. `readPaste`가 `editInsert`로 바로 넣는 `Text` 토큰은 거치지 않는다. `ActiveRead`에 `onKey` 필드 추가 |
| 접근자 3종       | `src/readline.ts`, `src/state.ts`                                     | `getCursor(): number`(→ `State.cursor()`, 신규), `editInsert(text)`, `editBackspace(n)`. `getLine`/`updateLine`과 같은 수준으로 활성 읽기가 없어도 현재 state에 작용한다 |
| `skipBlankHistory` | `src/readline.ts`                                                   | `ReadlineOptions.skipBlankHistory?: boolean`(기본 `false`). 켜면 Enter 분기에서 trim 결과가 빈 문자열인 제출을 `history.append` 대신 `history.resetCursor()`만 한다 |
| `restore`        | `src/history.ts`                                                      | `History.restore(entries: string[]): void`. `entries`를 복사본으로 대입 → `resetCursor()` → `saveToLocalStorage()`. 호출자 배열과 공유하지 않는다 |
| `historyEntry` 훅 | `src/readline.ts`                                                    | `ReadOptions.historyEntry?: (line: string) => string`. Enter 분기의 `history.append` 직전(`skipBlankHistory`가 거른 뒤)에 불려 돌려준 문자열이 기록된다. `resolve`는 원래 줄 그대로. 취소(`cancelable` Ctrl+C)에는 부르지 않는다. `ActiveRead`에 `historyEntry` 필드 추가 |
| 키 이벤트 훅     | `src/readline.ts`                                                      | `ReadlineOptions.onKeyEvent?: (event: KeyboardEvent) => boolean`(RD-017 DELTA-01). `handleKeyEvent`(모든 `keydown`/`keypress`/`keyup`, `attachCustomKeyEventHandler`로 등록) 맨 앞에서 부른다. `true`면 벤더 처리(Shift+Enter 포함)를 생략하고 `handleKeyEvent` 자체도 xterm에 `false`를 돌려준다(xterm 기본 처리도 생략). 활성 읽기 유무와 무관하게 항상 불린다 — 코어가 `attachCustomKeyEventHandler`를 재등록해 벤더 것을 덮어쓰지 않고 선택 복사 같은 코어 기능을 얹을 수 있게 한다 |
| `getHistory`     | `src/readline.ts`                                                      | `Readline.getHistory(): History`. `history` 객체 그대로 — 코어(RD-014)가 `entries` 스냅샷·`restore`에 쓴다 |
| `printAbove`     | `src/readline.ts`, `src/state.ts`                                      | `Readline.printAbove(text: string): void`(RD-015 DELTA-01, 다중 행·`cancelRead` 경합 수정은 DELTA-01a). 활성 읽기 중이면 `state.moveCursorToEnd()`로 물리적 커서를 버퍼 끝(감긴 줄이면 마지막 행)으로 옮긴 뒤 `\r\n` + `text` + `\r\n`을 쓰고, `term.write("", cb)` 콜백에서 `this.activeRead`가 여전히 유효한지 먼저 확인(`cancelRead()`가 먼저 끝났으면 다시 그리지 않고 `redrawing`·`queued`만 비움) → `Tty.anchorRow`를 갱신 → `State.restoreCursor(pos)`로 원래 커서를 되돌림 → `State.resetLayout()`(신규)로 `moveCursorToEnd()`가 남긴 옛 레이아웃을 0으로 되돌림 → `state.refresh()`로 같은 읽기를 다시 그린다. 콜백을 기다리는 동안(`redrawing`) 도착한 키는 `queued`에 원본 문자열째 쌓았다가 콜백에서 순서대로 `readData`로 재생한다(붙여넣기 덩어리도 하나로 보관해 `readPaste` 경로를 그대로 탐). 활성 읽기가 없거나 `term`이 없으면 `println(text)`와 같다. `dispose()`가 `redrawing`·`queued`를 비운다 |
| type-ahead       | `src/readline.ts`, `src/type-ahead.test.ts`(신규)                     | 활성 읽기가 없을 때(실행 중·`read()` write 콜백 대기 중·부팅 중) 들어온 `onData` 덩어리를 원본 문자열째 `typeAhead`에 쌓는다(RD-019 DELTA-01). Ctrl+C·Ctrl+L 단독 입력은 쌓지 않는다: Ctrl+L은 기존대로 즉시 화면을 지우고, Ctrl+C는 버퍼를 비운 뒤 `ctrlCHandler`를 부른다(게이트 결과와 무관). 합계 상한은 4096 UTF-16 코드 유닛이며 넘는 덩어리는 통째로 버린다(알림 없음). `read()` write 콜백 안에서 `activeRead`를 만들고 `new State`·`prefill`을 끝낸 직후 스냅샷을 비운 뒤 `readData`로 하나씩 재생한다 — `onKey` 훅·`readPaste` 경로를 그대로 타고, Enter로 읽기가 끝나면 남은 덩어리는 다시 버퍼로 들어가 다음 읽기가 받는다. `printAbove` 재그리기 중 도착한 키는 기존 `queued`가 그대로 잡는다(통합하지 않음). `dispose()`·`cancelRead()`가 비운다. 공개 API 추가 없음. 원본은 활성 읽기가 없을 때 Ctrl+C·Ctrl+L 외의 키를 버렸다 |
| `Input` export   | `src/index.ts`                                                        | `export type { Input }` 추가(값 export 목록은 불변) |
| export 추가    | `src/index.ts`(신규)                                                    | `Readline`, `History`, `InputType`, `State`, `Tty`와 타입 `HistoryOptions`·`ReadlineOptions`·`ReadOptions`. 원본 파일에 export를 덧붙이지 않는다                                                                                                                                                                                                              |
| 시험 이식      | `src/*.test.ts` 8개                                                     | jest → vitest. `vitest` import 추가, `jest.fn` → `vi.fn`(`state`·`tty`). 시험 본문은 그대로                                                                                                                                                                                                                                                                 |
| 시험 추가      | `src/persist.test.ts`, `src/index.test.ts`, `src/dispose.test.ts`, `src/cancel.test.ts`(신규) | `persist` 옵션, 공개 export 표면, `dispose` 정책(write 콜백 동기/비동기), 취소 가능한 읽기의 Ctrl+C                                                                                                                                                                                                                              |
| 시험 추가      | `src/history-entry.test.ts`(신규)                                       | `historyEntry` 훅(기록 텍스트 교체·`skipBlankHistory` 미호출·취소 미호출·훅 없을 때 보호)과 `getHistory()` — `on-key.test.ts`의 `StubTerminal`·`setup()` 패턴 재사용                                                                                                                                                            |
| 시험 추가      | `src/print-above.test.ts`(신규)                                         | `printAbove`(버퍼·커서 유지, 재그리기 중 키 큐 순서 보존, 커서 끝·이모지 버퍼, 활성 읽기 없을 때 `println` 동등, dispose 뒤 콜백 무해, DELTA-01a: 2행·3행 블록 입력과 감긴 단일 행에서 재그리기가 입력줄을 지우지 않음, `cancelRead()`가 재그리기 콜백보다 먼저 오면 죽은 입력줄을 다시 그리지 않음) — `StubTerminal`에 `asyncWrite`(write 콜백을 `flush()`까지 미룸)·`cursorYReads` 카운터 추가 |
| 빌드           | `tsdown.config.ts`, `package.json`                                      | tsdown(ESM + d.ts). 진입점 `src/index.ts`                                                                                                                                                                                                                                                                                                                   |
| 설정           | `tsconfig.json`, `eslint.config.js`                                     | `noUncheckedIndexedAccess: false`(원본이 인덱스 접근을 검사 없이 사용). `@typescript-eslint/no-unused-vars` off(원본 `.eslintrc`와 동일). `src/tty.ts`에 한정해 `no-control-regex`·`no-useless-assignment` off                                                                                                                                              |

## 업스트림 추적

원격을 연결하지 않는다. 업스트림 변경은 원본 저장소의 `CHANGELOG.md` 버전 기준으로 수동 diff해 가져온다.

## 명령

```bash
pnpm --filter @cp949/runo-xterm-readline test
pnpm --filter @cp949/runo-xterm-readline build
```

`vterm.ts`는 시험 전용 헬퍼이며 빌드 진입점(`src/index.ts`)에서 export하지 않는다.
