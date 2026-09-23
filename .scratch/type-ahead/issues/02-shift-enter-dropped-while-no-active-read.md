# 활성 읽기가 없는 구간의 Shift+Enter는 type-ahead에 쌓이지 않고 버려진다

Status: open
Origin: RD-019 벤더 `Readline` 버퍼 구현 중 코드 읽기로 발견(브라우저 미측정). 규칙은 `docs/design/06-editing.md` 6.7.

## 현상

`Readline.handleKeyEvent`가 Shift+Enter `keydown`에서 `readKey({ inputType: ShiftEnter })`를 직접 부르고 xterm에는 `false`를 돌려줘 `onData`로 가지 않는다. 활성 읽기가 없으면
`readKey`가 이 키를 버린다. 다른 키는 `readData` → type-ahead 버퍼로 쌓이므로 실행 중 친 Shift+Enter만 유실된다.

## 시나리오

`time.sleep(2)` 실행 중 `if 1:` Shift+Enter `pass`를 치면 종료 뒤 프롬프트에 `>>> if 1:` + 개행 + `pass`가 남아야 하는데 Shift+Enter가 사라져 `>>> if 1:pass`가 된다(추정).

## 완료 기준(관찰 가능)

- 위 시나리오를 벤더 단위 시험(가짜 터미널에서 `handleKeyEvent`로 Shift+Enter를 보낸 뒤 `read()`)으로 재현하고, 재생 뒤 입력줄에 개행이 들어간다.
- 쌓는 방식: 재생 경로가 `readData(string)`라 원본 문자열이 없으므로 `typeAhead`를 문자열이 아닌 항목(문자열 또는 `Input`)으로 넓히거나 Shift+Enter를 별도 항목으로 쌓는다. 순서가 다른 키와 섞이지 않아야 한다.

## 비고

3.14 tty에서는 Shift+Enter가 Enter와 같은 `\r`이라 이 기능의 3.14 대응이 없다(웹 고유 키). 우선순위 낮음.
