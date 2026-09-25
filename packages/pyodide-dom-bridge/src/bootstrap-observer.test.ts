/**
 * 부트스트랩 관찰기: coincident가 worker 전역에서 받는 부트스트랩 메시지(배열)가 도착했는지만 기록한다. coincident 리스너는
 * `stopImmediatePropagation()`으로 메시지를 삼키므로, 뒤에 걸린 일반 리스너는 그 메시지를 보지 못한다. 관찰기는 캡처 단계 리스너라
 * 등록 순서와 무관하게 먼저 호출되고, 메시지를 소비하지 않는다. jsdom DOM 노드에 `message` 이벤트를 보내 DOM 표준 디스패치
 * 순서(같은 대상에서 캡처 리스너가 먼저)를 그대로 쓴다.
 */
import { describe, expect, test } from "vitest";
import { createBootstrapObserver } from "./bootstrap-observer";

function createTarget() {
  return document.createElement("div");
}

function send(target: EventTarget, data: unknown) {
  const event = new MessageEvent("message", { data, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

describe("createBootstrapObserver", () => {
  test("메시지가 오기 전에는 수신 기록이 없다", () => {
    const observer = createBootstrapObserver(createTarget());

    expect(observer.received).toBe(false);
  });

  test("배열 메시지(부트스트랩)가 오면 수신으로 기록한다", () => {
    const target = createTarget();
    const observer = createBootstrapObserver(target);

    send(target, ["uid", false, -1]);

    expect(observer.received).toBe(true);
  });

  test("core init 프레임 같은 객체 메시지·문자열은 부트스트랩으로 세지 않는다", () => {
    const target = createTarget();
    const observer = createBootstrapObserver(target);

    send(target, { kind: "init" });
    send(target, "문자열");
    send(target, null);

    expect(observer.received).toBe(false);
  });

  test("메시지를 소비하지 않는다(뒤 리스너가 호출되고 기본 동작도 취소되지 않는다)", () => {
    const target = createTarget();
    createBootstrapObserver(target);
    const later: unknown[] = [];
    target.addEventListener("message", (event) =>
      later.push((event as MessageEvent).data),
    );

    const event = send(target, ["uid", false, -1]);

    expect(later).toEqual([["uid", false, -1]]);
    expect(event.defaultPrevented).toBe(false);
  });

  test("앞에 걸린 리스너가 stopImmediatePropagation을 불러도 관찰기는 메시지를 본다", () => {
    const target = createTarget();
    // coincident가 하는 일: 부트스트랩 리스너가 관찰기보다 먼저 등록돼 메시지를 삼킨다.
    target.addEventListener("message", (event) => {
      event.stopImmediatePropagation();
      event.preventDefault();
    });
    const observer = createBootstrapObserver(target);

    send(target, ["uid", false, -1]);

    expect(observer.received).toBe(true);
  });

  test("한 번 받은 뒤에도 리스너가 남아 이후 메시지에 영향을 주지 않는다", () => {
    const target = createTarget();
    const observer = createBootstrapObserver(target);

    send(target, ["uid", false, -1]);
    send(target, { kind: "init" });

    expect(observer.received).toBe(true);
  });
});
