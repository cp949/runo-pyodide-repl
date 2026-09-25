/**
 * worker에서 본 main `window` 프록시를 한 겹 감싸, `parent`·`top`·`opener`를 읽으면 명시 오류를 던진다. iframe 안에서 실행할 때
 * 상위 문서로 올라가는 가장 흔한 길을 실수로도 열지 않으려는 장치다. 얕은 차단이다: `window.frames`·`window.self.parent`·
 * `document.defaultView.parent` 같은 우회는 막지 않는다. 보안 경계가 아니다(경계는 iframe sandbox·origin 분리가 맡는다).
 */
const BLOCKED_PROPERTIES: ReadonlySet<string> = new Set([
  "parent",
  "top",
  "opener",
]);

export function guardedWindow<T extends object>(target: T): T {
  return new Proxy(target, {
    get(original, property) {
      if (typeof property === "string" && BLOCKED_PROPERTIES.has(property))
        throw new Error(`runo.browser: window.${property} 접근은 막혀 있다`);
      // receiver를 넘기지 않아 접근자의 this가 프록시가 아니라 원본이다(비공개 필드·원격 프록시가 프록시 receiver에 깨지지 않는다).
      return Reflect.get(original, property);
    },
  });
}
