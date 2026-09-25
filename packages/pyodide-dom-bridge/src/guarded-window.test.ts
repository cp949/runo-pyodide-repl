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

/**
 * reflected-ffi 원격 프록시처럼 동작하는 대역. 자기 target은 비어 있고 `getOwnPropertyDescriptor`는 실제 창의 설명자를 그대로 돌려준다.
 * 실제 `window.document`·`location`은 비설정(non-configurable) own 속성이라, 빈 target을 가진 프록시가 그 설명자를 돌려주면 JS 엔진이 프록시
 * 불변식 위반(`TypeError: 'getOwnPropertyDescriptor' on proxy: trap reported non-configurability …`)으로 던진다. Python `JsProxy`가 속성을
 * 읽을 때 이 요청이 나가므로 guard가 원격 프록시를 그대로 target으로 삼으면 `window.document`가 Python에서 실패한다(Chromium L1 실측).
 */
function createRemoteLikeWindow() {
  const real: Record<string, unknown> = { title: "제목", parent: "부모" };
  Object.defineProperty(real, "document", {
    value: { title: "문서" },
    enumerable: true,
    configurable: false,
    writable: false,
  });
  Object.defineProperty(real, "location", {
    value: { href: "https://예시.test/" },
    enumerable: true,
    configurable: false,
    writable: false,
  });
  return new Proxy(
    {},
    {
      get: (_, key) => Reflect.get(real, key),
      set: (_, key, value) => Reflect.set(real, key, value),
      has: (_, key) => Reflect.has(real, key),
      ownKeys: () => Reflect.ownKeys(real),
      getOwnPropertyDescriptor: (_, key) =>
        Reflect.getOwnPropertyDescriptor(real, key),
    },
  ) as Record<string, unknown>;
}

describe("guardedWindow: 원격 프록시(불변식이 엄격한 target)", () => {
  test("대역 자체는 비설정 속성의 설명자 요청에 던진다(시험 대역이 실제 오류를 재현한다)", () => {
    const remote = createRemoteLikeWindow();

    expect(() => Object.getOwnPropertyDescriptor(remote, "document")).toThrow(
      "non-configurability",
    );
  });

  test("비설정 속성(document)의 설명자를 요청해도 던지지 않고 값을 돌려준다", () => {
    const guarded = guardedWindow(createRemoteLikeWindow());

    const descriptor = Object.getOwnPropertyDescriptor(guarded, "document");

    expect(descriptor?.value).toEqual({ title: "문서" });
    expect(descriptor?.configurable).toBe(true);
    expect(descriptor?.enumerable).toBe(true);
  });

  test("없는 속성의 설명자는 undefined다", () => {
    const guarded = guardedWindow(createRemoteLikeWindow());

    expect(Object.getOwnPropertyDescriptor(guarded, "없음")).toBeUndefined();
  });

  test.each(["parent", "top", "opener"])(
    "설명자 요청으로도 %s 값이 새지 않는다(없는 속성처럼 undefined)",
    (name) => {
      const remote = createRemoteLikeWindow();
      Reflect.set(remote, name, "차단 대상");
      const guarded = guardedWindow(remote);

      expect(Object.getOwnPropertyDescriptor(guarded, name)).toBeUndefined();
      expect(() => guarded[name]).toThrow(`runo.browser: window.${name}`);
    },
  );

  test("in 연산과 속성 읽기는 원격 값을 그대로 돌려준다", () => {
    const guarded = guardedWindow(createRemoteLikeWindow());

    expect("document" in guarded).toBe(true);
    expect("없음" in guarded).toBe(false);
    expect(guarded.document).toEqual({ title: "문서" });
    expect((guarded.location as { href: string }).href).toBe(
      "https://예시.test/",
    );
  });

  test("Object.keys는 원격의 열거 가능한 속성을 나열하되 차단 속성(parent)은 뺀다", () => {
    const guarded = guardedWindow(createRemoteLikeWindow());

    expect(Object.keys(guarded).sort()).toEqual(
      ["document", "location", "title"].sort(),
    );
  });

  test("Reflect.ownKeys(나열 자체)에도 차단 속성이 없다", () => {
    const guarded = guardedWindow(createRemoteLikeWindow());

    expect(Reflect.ownKeys(guarded)).not.toContain("parent");
    expect(Reflect.ownKeys(guarded)).toContain("document");
  });

  test("속성 쓰기는 원격에 반영된다", () => {
    const remote = createRemoteLikeWindow();
    const guarded = guardedWindow(remote);

    guarded.title = "바뀜";

    expect(remote.title).toBe("바뀜");
  });
});
