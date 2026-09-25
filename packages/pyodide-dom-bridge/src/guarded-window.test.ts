/**
 * `guardedWindow`: worker에서 본 main `window` 프록시를 한 겹 감싸 `parent`·`top`·`opener` 읽기를 명시 오류로 막는다.
 * 얕은 차단이다(`window.frames`·`document.defaultView.parent` 같은 우회는 막지 않는다). 보안 경계가 아니라 실수 방지다.
 */
import { describe, expect, test } from "vitest";
import { guardedWindow } from "./guarded-window";

/** main `window`를 흉내 내는 평범한 객체. */
function createFakeWindow() {
  return {
    title: "제목",
    parent: "부모",
    top: "최상위",
    opener: "오프너",
    self: "자기",
    frames: "프레임",
    document: { title: "문서" },
    count: 0,
    add(a: number, b: number) {
      return a + b;
    },
  };
}

describe("guardedWindow", () => {
  test.each(["parent", "top", "opener"])(
    "%s를 읽으면 명시 오류를 던진다",
    (name) => {
      const guarded = guardedWindow(createFakeWindow()) as Record<
        string,
        unknown
      >;

      expect(() => guarded[name]).toThrow(`runo.browser: window.${name}`);
    },
  );

  test("차단 목록 밖 속성은 그대로 읽힌다(얕은 차단: self·frames도 통과한다)", () => {
    const guarded = guardedWindow(createFakeWindow());

    expect(guarded.title).toBe("제목");
    expect(guarded.self).toBe("자기");
    expect(guarded.frames).toBe("프레임");
    expect(guarded.document).toEqual({ title: "문서" });
  });

  test("속성 쓰기는 원본에 그대로 반영된다", () => {
    const original = createFakeWindow();
    const guarded = guardedWindow(original);

    guarded.count = 3;
    guarded.title = "바뀜";

    expect(original.count).toBe(3);
    expect(original.title).toBe("바뀜");
  });

  test("메서드 호출은 그대로 동작한다", () => {
    const guarded = guardedWindow(createFakeWindow());

    expect(guarded.add(2, 3)).toBe(5);
  });

  test("심볼 키 읽기는 막지 않는다", () => {
    const original = Object.assign(createFakeWindow(), {
      [Symbol.toStringTag]: "Window",
    });
    const guarded = guardedWindow(original);

    expect(Object.prototype.toString.call(guarded)).toBe("[object Window]");
  });

  test("접근자 속성의 this는 원본이다(비공개 필드 클래스도 읽힌다)", () => {
    class Holder {
      #secret = "비밀";
      get secret() {
        return this.#secret;
      }
    }
    const guarded = guardedWindow(new Holder());

    expect(guarded.secret).toBe("비밀");
  });
});
