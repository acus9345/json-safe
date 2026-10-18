import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { safeStringify, toSafeJSON } from "../dist/index.js";

const s = safeStringify;

describe("safeStringify", () => {
  it("matches JSON.stringify for plain data", () => {
    const data = { a: 1, b: "x", c: [1, null, true], d: { e: undefined, f: () => 1 }, g: [undefined, () => 1], n: NaN, i: -Infinity };
    assert.equal(s(data), JSON.stringify(data));
    assert.equal(s(data, { space: 2 }), JSON.stringify(data, null, 2));
    assert.equal(s("str"), '"str"');
    assert.equal(s(null), "null");
    assert.equal(s(undefined), "null");
    assert.equal(s(() => 1), "null");
  });

  it("replaces circular references with their path", () => {
    const root: Record<string, unknown> = { name: "root", child: { list: [] as unknown[] } };
    (root.child as { list: unknown[] }).list.push(root, root.child);
    root.self = root;
    assert.equal(s(root), '{"name":"root","child":{"list":["[Circular ~]","[Circular ~.child]"]},"self":"[Circular ~]"}');
    assert.equal(s(root, { circular: "[Circular]" }), '{"name":"root","child":{"list":["[Circular]","[Circular]"]},"self":"[Circular]"}');
    assert.equal(s([root], { circular: (path) => ({ ref: path }) }), '[{"name":"root","child":{"list":[{"ref":"~[0]"},{"ref":"~[0].child"}]},"self":{"ref":"~[0]"}}]');
  });

  it("serializes repeated (non-circular) references in full", () => {
    const shared = { x: 1 };
    assert.equal(s({ a: shared, b: shared }), '{"a":{"x":1},"b":{"x":1}}');
  });

  it("handles BigInt as strings or bare numbers", () => {
    assert.equal(s({ id: 12345678901234567890n }), '{"id":"12345678901234567890"}');
    assert.equal(s({ id: 12345678901234567890n, list: [-1n] }, { bigint: "number" }), '{"id":12345678901234567890,"list":[-1]}');
    assert.equal(s({ text: "\u0000abc:12" }, { bigint: "number" }), '{"text":"\\u0000abc:12"}', "user strings are never unquoted");
    assert.deepEqual(toSafeJSON({ a: 5n, b: 2n ** 60n }, { bigint: "number" }), { a: 5, b: "1152921504606846976" });
  });

  it("converts Map, Set, typed arrays, RegExp, URL and Date", () => {
    const value = {
      map: new Map<unknown, unknown>([["a", 1], [2, new Set(["x"])]]),
      objectKeys: new Map([[{ id: 1 }, "obj"]]),
      set: new Set([1, 2]),
      bytes: new Uint8Array([1, 2]),
      big: new BigInt64Array([3n]),
      re: /a+/gi,
      url: new URL("https://example.com/a?b=1"),
      date: new Date(0),
      invalidDate: new Date(Number.NaN),
      buffer: new ArrayBuffer(8),
    };
    assert.deepEqual(JSON.parse(s(value)), {
      map: { a: 1, 2: ["x"] },
      objectKeys: [[{ id: 1 }, "obj"]],
      set: [1, 2],
      bytes: [1, 2],
      big: ["3"],
      re: "/a+/gi",
      url: "https://example.com/a?b=1",
      date: "1970-01-01T00:00:00.000Z",
      invalidDate: null,
      buffer: { type: "ArrayBuffer", byteLength: 8 },
    });
  });

  it("serializes errors with cause, code and AggregateError", () => {
    const cause = new TypeError("inner");
    const err = Object.assign(new Error("outer", { cause }), { code: "E_TEST" });
    const parsed = JSON.parse(s({ err }, { errorStack: false }));
    assert.deepEqual(parsed, { err: { name: "Error", message: "outer", code: "E_TEST", cause: { name: "TypeError", message: "inner" } } });
    assert.match(JSON.parse(s(err)).stack, /^Error: outer/);
    const agg = JSON.parse(s(new AggregateError([new Error("a")], "many"), { errorStack: false }));
    assert.deepEqual(agg, { name: "AggregateError", message: "many", errors: [{ name: "Error", message: "a" }] });
  });

  it("never throws, whatever the input does", () => {
    const evil = {
      get boom() {
        throw new Error("getter exploded");
      },
      bad: { toJSON() { throw new Error("toJSON exploded"); } },
      ok: 1,
    };
    assert.equal(s(evil), '{"boom":"[Throws: getter exploded]","bad":"[Throws: toJSON exploded]","ok":1}');
    const proxy = new Proxy({}, { ownKeys() { throw new Error("trap"); } });
    assert.equal(s({ proxy }), '{"proxy":"[Throws: trap]"}');
    const revocable = Proxy.revocable({}, {});
    revocable.revoke();
    assert.match(s({ revoked: revocable.proxy }), /\[Throws: .*revoked/);
  });

  it("sortKeys, maxDepth, maxStringLength and maxArrayLength", () => {
    assert.equal(s({ b: 1, a: { d: 1, c: 2 } }, { sortKeys: true }), '{"a":{"c":2,"d":1},"b":1}');
    assert.equal(s({ a: { b: { c: 1 } }, l: [[1]] }, { maxDepth: 2 }), '{"a":{"b":"[Object]"},"l":["[Array]"]}');
    assert.equal(s({ t: "abcdef" }, { maxStringLength: 3 }), '{"t":"abc… (3 more characters)"}');
    assert.equal(s([1, 2, 3, 4], { maxArrayLength: 2 }), '[1,2,"… 2 more items"]');
    assert.equal(s(new Set([1, 2, 3]), { maxArrayLength: 1 }), '[1,"… 2 more items"]');
  });

  it("functions, symbols and replacer", () => {
    function named() {}
    assert.equal(s({ f: named, s: Symbol("tag"), [Symbol("hidden")]: 1 }, { functions: true }), '{"f":"[Function named]","s":"Symbol(tag)"}');
    assert.equal(s({ password: "x", user: "ada" }, { replacer: (k, v) => (k === "password" ? undefined : v) }), '{"user":"ada"}');
  });
});
