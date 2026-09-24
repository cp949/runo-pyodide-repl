// `mergeReadOptions` 순수 시험(RD-014 DELTA-02). 가짜 터미널 없음 — `vi.fn()`으로 `onKey` 호출만 관찰한다.
import { describe, expect, test, vi } from "vitest";
import { mergeReadOptions } from "./read-options";

describe("mergeReadOptions", () => {
  test("onKey는 앞에서부터 부르고 먼저 소비한 쪽에서 멈춘다", () => {
    const a = vi.fn().mockReturnValue(true);
    const b = vi.fn().mockReturnValue(false);

    const merged = mergeReadOptions({ onKey: a }, { onKey: b });
    const result = merged.onKey?.({} as never);

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
    expect(result).toBe(true);
  });

  test("아무도 소비하지 않으면 전부 부르고 false", () => {
    const a = vi.fn().mockReturnValue(false);
    const b = vi.fn().mockReturnValue(false);

    const merged = mergeReadOptions({ onKey: a }, { onKey: b });
    const result = merged.onKey?.({} as never);

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(result).toBe(false);
  });

  test("onKey가 하나도 없으면 결과에 onKey가 없다", () => {
    const merged = mergeReadOptions({}, { prefill: "  " });

    expect(merged).toEqual({ prefill: "  " });
  });

  test("prefill·historyEntry는 제공한 쪽 것이고 둘 다 주면 뒤가 이긴다", () => {
    const f = vi.fn();

    expect(mergeReadOptions({ prefill: "a" }, { prefill: "b" }).prefill).toBe(
      "b",
    );
    expect(mergeReadOptions({ historyEntry: f }, {}).historyEntry).toBe(f);
  });

  test("인자가 없으면 빈 객체", () => {
    expect(mergeReadOptions()).toEqual({});
  });
});
