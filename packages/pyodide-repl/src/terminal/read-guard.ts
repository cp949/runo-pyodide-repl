/**
 * REPL 읽기(`readLine` 요청)와 stdin 읽기(`readInput` 알림)는 같은 `Readline`을 쓴다. `readline.read()`는 이미 열린 읽기를
 * 교체하고 옛 읽기의 promise를 끝내지 않는다. 프롬프트를 기다리는 동안 worker에서 도는 배경 콜백이 `input()`을 부르면
 * stdin 읽기가 REPL 읽기를 교체해, 사용자가 친 REPL 줄이 stdin으로 가고 `readLine` 응답이 오지 않아 이후 입력이 멈춘다
 * (04-stdin-input.md 3.2). 그래서 stdin 읽기는 활성 REPL 읽기의 결과가 정해진 뒤에 시작한다.
 *
 * - 교착 없음: worker는 stdin 읽기 동안 동기 대기하고 REPL 응답은 포트에 큐잉된다(01-protocols.md 1.3). REPL 줄이 끝난 뒤
 *   stdin 읽기가 끝나 콜백이 돌아가면 worker가 그 응답을 처리한다.
 * - REPL 읽기는 기다리지 않고 바로 부른다(시작 타이밍 불변). stdin 읽기끼리는 직렬화하지 않는다: worker가 동기 대기라 두 stdin
 *   읽기가 겹치지 않는다.
 * - REPL 읽기가 줄·취소·실패 어느 쪽으로 끝나도 stdin 읽기는 진행한다. 실패는 원본 promise 그대로 REPL 호출자에게 간다.
 * - 겹침 거절(`createRepl`의 `reading`)은 가드 바깥에서 검사한다. 거절된 요청을 가드가 추적하면 실제 활성 REPL 읽기를 잃어
 *   stdin 읽기가 앞당겨진다.
 * - stdin 읽기를 미루는 순간(`readInput` 도착, 동기) `inputDeferred`를 부른다(RD-022b). 배경 `input()`이 먼저 쓴 프롬프트는 열린
 *   REPL 읽기의 접두가 되어 있으므로, REPL 줄이 끝나 벤더가 접두를 잊기 전에 그것을 꼬리로 옮겨 stdin 읽기의 프롬프트로 쓴다.
 */
const ignore = () => {};

export interface ReadGuardDeps<L, I> {
  /**
   * REPL 읽기(`repl-reader`). 즉시 부른다. `pending`·`cancelable`은 그대로 리더에 넘긴다.
   * `pending`은 자동 들여쓰기 프리필의 재료다(`06-editing.md` 6.3).
   */
  readLine(
    prompt: string,
    pending: string | undefined,
    cancelable: boolean
  ): Promise<L>;
  /** stdin 읽기(`stdin-reader`). 활성 REPL 읽기가 끝난 뒤 부른다. */
  readInput(cancelable: boolean): Promise<I>;
  /**
   * 활성 REPL 읽기가 있어 stdin 읽기를 미룰 때 `readInput` 도착 즉시(동기로) 한 번 부른다. REPL은 여기서 REPL 줄의 접두를
   * 꼬리로 옮긴다(`TerminalSinks.moveAbovePrefixToTail`).
   */
  inputDeferred?(): void;
}

export interface ReadGuard<L, I> {
  readLine(
    prompt: string,
    pending: string | undefined,
    cancelable: boolean
  ): Promise<L>;
  readInput(cancelable: boolean): Promise<I>;
}

/**
 * 돌려준 `readLine`은 반환 promise를 "활성 REPL 읽기"로 추적하고, `readInput`은 그 읽기가 끝난 뒤 원본을 부른다.
 * 목록 재그리기 등으로 읽기가 새로 시작돼도 `readLine`이 돌려주는 promise는 바뀌지 않으므로 그 promise가 최종 종료 시점이다.
 * 제네릭 덕에 REPL 읽기 결과가 취소(`string | null`)로 넓어져도 가드 자체는 그대로다.
 */
export function createReadGuard<L, I>(
  deps: ReadGuardDeps<L, I>,
): ReadGuard<L, I> {
  // 활성 REPL 읽기가 끝나면(줄·취소·실패 어느 쪽이든) 이행된다. 읽기가 없거나 끝났으면 이미 이행된 promise다.
  let replRead: Promise<void> = Promise.resolve();
  // 활성 REPL 읽기가 끝나지 않았다. 끝난 옛 읽기의 처리가 뒤에 열린 새 읽기의 표시를 내리지 않게 `replRead`와 대조한다.
  let replOpen = false;
  return {
    readLine(prompt, pending, cancelable) {
      const read = deps.readLine(prompt, pending, cancelable);
      // 가드 내부 체인만 실패를 삼킨다. 호출자가 받는 `read`는 그대로다.
      const settled = read.then(ignore, ignore);
      replRead = settled;
      replOpen = true;
      void settled.then(() => {
        if (replRead === settled) replOpen = false;
      });
      return read;
    },
    async readInput(cancelable) {
      if (replOpen) deps.inputDeferred?.();
      await replRead;
      return deps.readInput(cancelable);
    },
  };
}
