// 세션이 여러 REPL 읽기 옵션 모듈(자동 들여쓰기·블록 history·나중의 Tab)을 합성하는 순수 함수.
// `createReplReader`는 모듈 종류를 몰라도 되게 `ReadOptionsProvider` 함수 하나만 받는다
// (`06-editing.md` 6.6, RD-014 그릴링 확정 6).

import type { ReadOptions } from "@cp949/runo-xterm-readline";

export type ReplReadOptions = Pick<
  ReadOptions,
  "prefill" | "onKey" | "historyEntry"
>;

export type ReadOptionsProvider = (
  pending: string | undefined,
) => ReplReadOptions;

/**
 * 여러 모듈의 `ReplReadOptions`를 하나로 합친다.
 * - `onKey`: 준 것들을 앞에서부터 순서대로 부르고, 먼저 `true`(소비)를 돌려준 쪽에서 멈춘다. 아무도
 *   소비하지 않으면 전부 부른 뒤 `false`. 하나도 없으면 결과에 `onKey` 키 자체를 넣지 않는다.
 * - `prefill`·`historyEntry`: 준 쪽 것을 쓰고, 둘 이상이 주면 **뒤가 이긴다**.
 */
export function mergeReadOptions(...parts: ReplReadOptions[]): ReplReadOptions {
  const onKeys = parts
    .map((part) => part.onKey)
    .filter((onKey): onKey is NonNullable<ReplReadOptions["onKey"]> => onKey !== undefined);

  const result: ReplReadOptions = {};
  if (onKeys.length > 0) {
    result.onKey = (input) => onKeys.some((onKey) => onKey(input));
  }
  for (const part of parts) {
    if (part.prefill !== undefined) result.prefill = part.prefill;
    if (part.historyEntry !== undefined) result.historyEntry = part.historyEntry;
  }
  return result;
}
