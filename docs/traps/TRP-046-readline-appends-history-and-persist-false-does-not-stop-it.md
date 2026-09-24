# TRP-046 벤더 `Readline`은 Enter마다 history에 append하고 건너뛸 방법이 없다 — `persist: false`는 저장만 끈다

- 상태: ACTIVE
- 적용 조건: `Readline.read()`로 한 줄을 받으면서 그 줄을 history에 남기고 싶지 않은 모든 소비자(실행창의 `input()` 읽기, 향후 React 래퍼).

## 오해하기 쉬운 신호

- `persist: false`가 history를 끈 것처럼 읽힌다. 실제로는 localStorage 저장만 끄고 메모리 history는 그대로 쌓인다. `skipBlankHistory`는 공백뿐인 제출만 거르고, `ReadOptions.historyEntry`는 기록할 문자열을 바꿀 뿐 항목을 건너뛰지 못한다(빈 문자열도 기록된다).
- ↑를 눌러야 드러나므로 Enter만 치는 시험은 통과한다.

## 원인

- 벤더 `readline.ts`의 Enter 분기가 `history.append(...)`를 무조건 부른다(`skipBlankHistory` 예외만).

## 탐지/회피

- 읽기 앞에 `readline.getHistory().entries.slice()`를 잡고 읽기가 끝난 뒤(정상·취소·예외 모두 `finally`) `history.restore(snapshot)`로 되돌린다(`terminal-runner.ts`의 `readInput`, RD-014의 블록 히스토리와 같은 방식). 벤더에 "기록 안 함" 옵션은 넣지 않았다.
- 시험: `terminal-runner.test.ts`의 "Enter로 제출한 입력줄은 history에 남지 않아 다음 읽기에서 ↑로 되살아나지 않는다"(↑로 확인, history 복원을 없애는 변이가 이 시험에서 죽는다).
