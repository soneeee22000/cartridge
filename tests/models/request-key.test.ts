import { describe, expect, it } from "vitest";
import {
  VolatileValueError,
  assertNoVolatile,
  canonicalJson,
  requestKey,
} from "../../src/models/request-key.ts";

describe("canonicalJson (§7.2)", () => {
  it("sorts keys recursively and drops undefined values", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: undefined }], c: 3 } })).toBe(
      '{"a":{"c":3,"d":[2,{"z":1}]},"b":1}',
    );
  });
});

describe("requestKey", () => {
  it("is stable under key order and prefixed with sha256", () => {
    const first = requestKey("/v1/messages", { model: "m", stream: true });
    const second = requestKey("/v1/messages", { stream: true, model: "m" });
    expect(first).toBe(second);
    expect(first).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("changes with the path or the body", () => {
    const base = requestKey("/v1/messages", { a: 1 });
    expect(requestKey("/v1/other", { a: 1 })).not.toBe(base);
    expect(requestKey("/v1/messages", { a: 2 })).not.toBe(base);
  });
});

describe("assertNoVolatile", () => {
  it("accepts ordinary request bodies", () => {
    expect(() => {
      assertNoVolatile({ messages: [{ role: "user", content: "make a game" }] });
    }).not.toThrow();
  });

  it("rejects a UUID anywhere in the body", () => {
    expect(() => {
      assertNoVolatile({ meta: ["x", "run 3f2b8c1e-9a4d-4e7f-8b21-0c5d6e7f8a9b"] });
    }).toThrow(VolatileValueError);
  });

  it("rejects an ISO timestamp anywhere in the body", () => {
    expect(() => {
      assertNoVolatile({ nested: { note: "at 2026-09-24T10:11:12Z" } });
    }).toThrow(VolatileValueError);
  });
});
