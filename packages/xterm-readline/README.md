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

`highlight`·`keymap`·`line`·`state`·`tty`·`vterm`은 원본과 바이트 동일하다. 변경은 아래로 한정한다.

| 종류           | 파일                                                                    | 내용                                                                                                                                                                                                                                                                                                                                                        |
| -------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `persist` 옵션 | `src/history.ts`                                                        | `HistoryOptions`, 생성자 2번째 인자 `{ persist?: boolean }`(기본 `true`). `false`면 `saveToLocalStorage`·`restoreFromLocalStorage`가 즉시 반환                                                                                                                                                                                                              |
| `persist` 옵션 | `src/readline.ts`                                                       | `ReadlineOptions`, 생성자 인자 `{ persist?: boolean }`을 `History`에 전달. `history`·`state` 필드 초기화를 생성자로 옮김(생성 순서는 원본과 같음)                                                                                                                                                                                                           |
| `dispose` 정책 | `src/readline.ts`                                                       | `dispose()`가 리스너를 해제하고 `term`을 비우며, 대기 중인 읽기(write 콜백 대기 중이라 `activeRead`가 없는 것 포함)를 `Error("readline disposed")`로 reject한다. 두 번째 호출은 무동작. 원본은 리스너만 해제해 dispose된 xterm에 write 콜백이 닿고(`DisposableStore` 경고) 읽기 promise가 끝나지 않았다. `pendingReads` 필드 추가, `read()`가 reject를 기록 |
| 취소 가능한 읽기 | `src/readline.ts`                                                     | `ReadOptions`, `read(prompt)` / `read(prompt, { cancelable })` 오버로드(반환 `Promise<string>` / `Promise<string \| null>`). `cancelable`이면 활성 읽기 중 Ctrl+C가 `moveCursorToEnd` → `refreshUnhighlighted` → `\r\n` → `resolve(null)`로 읽기를 끝낸다(`^C` 에코·history 없음, reject 없음). 옵션을 주지 않으면 원본 동작(`^C` + 같은 프롬프트 재그리기). `ActiveRead`에 `cancelable` 필드 추가 |
| 프리필           | `src/readline.ts`                                                     | `ReadOptions.prefill?: string`. `read()`의 write 콜백 안, `new State` 직후 1회 `state.update(prefill)`로 채운다(커서는 끝). 빈 문자열·미지정은 원본과 같이 `state.refresh()`만 부른다. `cancelable`이 아닌 읽기의 Ctrl+C 재그리기(같은 prompt로 `new State`)는 다시 채우지 않는다 |
| export 추가    | `src/index.ts`(신규)                                                    | `Readline`, `History`, `InputType`, `State`, `Tty`와 타입 `HistoryOptions`·`ReadlineOptions`·`ReadOptions`. 원본 파일에 export를 덧붙이지 않는다                                                                                                                                                                                                              |
| 시험 이식      | `src/*.test.ts` 8개                                                     | jest → vitest. `vitest` import 추가, `jest.fn` → `vi.fn`(`state`·`tty`). 시험 본문은 그대로                                                                                                                                                                                                                                                                 |
| 시험 추가      | `src/persist.test.ts`, `src/index.test.ts`, `src/dispose.test.ts`, `src/cancel.test.ts`(신규) | `persist` 옵션, 공개 export 표면, `dispose` 정책(write 콜백 동기/비동기), 취소 가능한 읽기의 Ctrl+C                                                                                                                                                                                                                              |
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
