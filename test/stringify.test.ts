import assert from "node:assert/strict";
import { describe, it } from "node:test";
import vm from "node:vm";
import defaultSafeStringify, { safeStringify, toSafeJSON } from "../dist/index.js";

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
    assert.equal(defaultSafeStringify, safeStringify);
  });

  it("unwraps boxed primitives like JSON.stringify", () => {
    assert.equal(s(new Number(42)), "42");
    assert.equal(s(new Number(Number.NaN)), "null");
    assert.equal(s(new String("abcdef"), { maxStringLength: 3 }), '"abc… (3 more characters)"');
    assert.equal(s(new Boolean(false)), "false");
    assert.equal(s(Object(123n)), '"123"');
    assert.equal(s(Object(123n), { bigint: "number" }), "123");

    assert.equal(s(vm.runInNewContext("new Number(42)")), "42");
    assert.equal(s(vm.runInNewContext("new Number(NaN)")), "null");
    assert.equal(s(vm.runInNewContext("new String('abcdef')"), { maxStringLength: 3 }), '"abc… (3 more characters)"');
    assert.equal(s(vm.runInNewContext("new Boolean(false)")), "false");
    assert.equal(s(vm.runInNewContext("Object(123n)")), '"123"');
    assert.equal(s(vm.runInNewContext("Object(123n)"), { bigint: "number" }), "123");
    assert.equal(s({ [Symbol.toStringTag]: "Number", a: 1 }), '{"a":1}');
  });

  it("preserves __proto__ keys and handles null-prototype objects", () => {
    const withProto = JSON.parse('{"__proto__":{"a":1},"ok":2}');
    assert.equal(s(withProto), '{"__proto__":{"a":1},"ok":2}');
    const safeObj = toSafeJSON(withProto) as Record<string, unknown>;
    assert.equal(Object.getPrototypeOf(safeObj), Object.prototype);
    assert.deepEqual(Object.getOwnPropertyDescriptor(safeObj, "__proto__")?.value, { a: 1 });

    const nullProto = Object.assign(Object.create(null) as Record<string, unknown>, { a: 1 });
    assert.equal(s(nullProto), '{"a":1}');
    assert.equal(s(nullProto, { maxDepth: 0 }), '"[Object]"');
  });

  it("replaces circular references with their path", () => {
    const root: Record<string, unknown> = { name: "root", child: { list: [] as unknown[] } };
    (root.child as { list: unknown[] }).list.push(root, root.child);
    root.self = root;
    assert.equal(s(root), '{"name":"root","child":{"list":["[Circular ~]","[Circular ~.child]"]},"self":"[Circular ~]"}');
    assert.equal(s(root, { circular: "[Circular]" }), '{"name":"root","child":{"list":["[Circular]","[Circular]"]},"self":"[Circular]"}');
    assert.equal(s([root], { circular: (path) => ({ ref: path }) }), '[{"name":"root","child":{"list":[{"ref":"~[0]"},{"ref":"~[0].child"}]},"self":{"ref":"~[0]"}}]');
    const spaced: Record<string, unknown> = { "a b": {} };
    (spaced["a b"] as Record<string, unknown>).back = spaced["a b"];
    assert.equal(s(spaced), '{"a b":{"back":"[Circular ~[\\"a b\\"]]"}}');
  });

  it("guards against self-referencing or throwing circular callbacks", () => {
    const loop: Record<string, unknown> = { ok: 1 };
    loop.self = loop;
    assert.equal(s(loop, { circular: () => loop }), '{"ok":1,"self":"[Circular ~]"}');
    assert.equal(s(loop, { circular: () => { throw new Error("cycle cb"); } }), '{"ok":1,"self":"[Throws: cycle cb]"}');
    assert.deepEqual(toSafeJSON(loop, { circular: () => loop }), { ok: 1, self: "[Circular ~]" });

    const nested: Record<string, unknown> = { a: {} };
    (nested.a as Record<string, unknown>).self = nested;
    assert.equal(
      s(nested, {
        circular: (path) => {
          const rep: Record<string, unknown> = { ref: path };
          rep.again = rep;
          return rep;
        },
      }),
      '{"a":{"self":{"ref":"~","again":"[Circular ~.a.self]"}}}',
    );
  });

  it("serializes repeated (non-circular) references in full", () => {
    const shared = { x: 1 };
    assert.equal(s({ a: shared, b: shared }), '{"a":{"x":1},"b":{"x":1}}');
  });

  it("handles BigInt as strings or bare numbers", () => {
    assert.equal(s({ id: 12345678901234567890n }), '{"id":"12345678901234567890"}');
    assert.equal(s({ id: 12345678901234567890n, list: [-1n] }, { bigint: "number" }), '{"id":12345678901234567890,"list":[-1]}');
    assert.equal(s(42n, { bigint: "number" }), "42");
    assert.equal(s({ text: "\u0000abc:12" }, { bigint: "number" }), '{"text":"\\u0000abc:12"}', "user strings are never unquoted");
    assert.deepEqual(toSafeJSON({ a: 5n, b: 2n ** 60n }, { bigint: "number" }), { a: 5, b: "1152921504606846976" });
  });

  it("converts Map, Set, typed arrays, DataView, RegExp, URL, Date and unserializable built-ins", () => {
    const raw = new Uint8Array([10, 20, 30, 40]);
    const value = {
      map: new Map<unknown, unknown>([["a", 1], [2, new Set(["x"])]]),
      objectKeys: new Map([[{ id: 1 }, "obj"]]),
      set: new Set([1, 2]),
      bytes: new Uint8Array([1, 2]),
      view: new DataView(raw.buffer, 1, 2),
      big: new BigInt64Array([3n]),
      re: /a+/gi,
      url: new URL("https://example.com/a?b=1"),
      date: new Date(0),
      invalidDate: new Date(Number.NaN),
      buffer: new ArrayBuffer(8),
      weakMap: new WeakMap(),
      weakSet: new WeakSet(),
      weakRef: new WeakRef({}),
      promise: Promise.resolve(1),
    };
    assert.deepEqual(JSON.parse(s(value)), {
      map: { a: 1, 2: ["x"] },
      objectKeys: [[{ id: 1 }, "obj"]],
      set: [1, 2],
      bytes: [1, 2],
      view: [20, 30],
      big: ["3"],
      re: "/a+/gi",
      url: "https://example.com/a?b=1",
      date: "1970-01-01T00:00:00.000Z",
      invalidDate: null,
      buffer: { type: "ArrayBuffer", byteLength: 8 },
      weakMap: "[WeakMap]",
      weakSet: "[WeakSet]",
      weakRef: "[WeakRef]",
      promise: "[Promise]",
    });
  });

  it("serializes errors with cause, code, AggregateError and throwing getters", () => {
    const cause = new TypeError("inner");
    const err = Object.assign(new Error("outer", { cause }), { code: "E_TEST" });
    const parsed = JSON.parse(s({ err }, { errorStack: false }));
    assert.deepEqual(parsed, { err: { name: "Error", message: "outer", code: "E_TEST", cause: { name: "TypeError", message: "inner" } } });
    assert.match(JSON.parse(s(err)).stack, /^Error: outer/);
    const agg = JSON.parse(s(new AggregateError([new Error("a")], "many"), { errorStack: false }));
    assert.deepEqual(agg, { name: "AggregateError", message: "many", errors: [{ name: "Error", message: "a" }] });

    const badErr = new Error("still readable");
    Object.defineProperty(badErr, "stack", { get() { throw new Error("stack boom"); } });
    assert.deepEqual(JSON.parse(s(badErr)), { name: "Error", message: "still readable", stack: "[Throws: stack boom]" });
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

    const badArr: unknown[] = [1, 2];
    Object.defineProperty(badArr, 0, { get() { throw new Error("index boom"); }, enumerable: true });
    assert.equal(s(badArr), '["[Throws: index boom]",2]');

    const throwingReplacer = (k: string, v: unknown) => {
      if (k === "bad") throw new Error("replacer boom");
      return v;
    };
    assert.equal(s({ bad: 1, ok: 2 }, { replacer: throwingReplacer }), '{"bad":"[Throws: replacer boom]","ok":2}');
    assert.deepEqual(toSafeJSON({ bad: 1, ok: 2 }, { replacer: throwingReplacer }), { bad: "[Throws: replacer boom]", ok: 2 });

    const loop: Record<string, unknown> = {};
    loop.self = loop;
    assert.equal(
      s(loop, { circular: () => { throw new Error("very long circular callback error"); }, maxStringLength: 10 }),
      '{"self":"[Throws: v… (33 more characters)"}',
    );
    const badProxy = new Proxy({}, { ownKeys() { throw new Error("very long proxy trap error"); } });
    assert.equal(s({ badProxy }, { maxStringLength: 10 }), '{"badProxy":"[Throws: v… (26 more characters)"}');
    const badBox = new Number(1);
    badBox.valueOf = () => { throw new Error("very long valueOf error"); };
    assert.equal(s({ badBox }, { maxStringLength: 10 }), '{"badBox":"[Throws: v… (23 more characters)"}');
  });

  it("sortKeys, maxDepth, maxStringLength and maxArrayLength", () => {
    class CustomBox {
      x = 1;
    }
    assert.equal(s({ b: 1, a: { d: 1, c: 2 } }, { sortKeys: true }), '{"a":{"c":2,"d":1},"b":1}');
    assert.equal(s({ a: { b: { c: 1 } }, l: [[1]], box: new CustomBox() }, { maxDepth: 2 }), '{"a":{"b":"[Object]"},"l":["[Array]"],"box":{"x":1}}');
    assert.equal(s({ box: new CustomBox() }, { maxDepth: 1 }), '{"box":"[CustomBox]"}');
    assert.equal(s({ a: { b: { c: 1 } } }, { maxDepth: Number.NaN }), '{"a":{"b":{"c":1}}}');
    assert.equal(s({ a: { b: { c: 1 } } }, { maxDepth: 1.5 }), '{"a":"[Object]"}');
    assert.equal(s({ t: "abcdef" }, { maxStringLength: 3 }), '{"t":"abc… (3 more characters)"}');
    assert.equal(s({ t: "abcdef" }, { maxStringLength: -2 }), '{"t":"… (6 more characters)"}');
    assert.equal(s({ t: "abcdef" }, { maxStringLength: Number.NaN }), '{"t":"abcdef"}');
    assert.equal(s({ t: "abcdef" }, { maxStringLength: 2.9 }), '{"t":"ab… (4 more characters)"}');
    assert.equal(s([1, 2, 3, 4], { maxArrayLength: 2 }), '[1,2,"… 2 more items"]');
    assert.equal(s([1, 2, 3], { maxArrayLength: Number.NaN }), "[1,2,3]");
    assert.equal(s([1, 2, 3, 4], { maxArrayLength: 1.9 }), '[1,"… 3 more items"]');
    assert.equal(s(new Set([1, 2, 3]), { maxArrayLength: 1 }), '[1,"… 2 more items"]');
    assert.equal(s(new Map([["a", 1], ["b", 2], ["c", 3]]), { maxArrayLength: 1 }), '{"a":1,"…":"2 more entries"}');
    assert.equal(s(new Map([["a", 1], ["b", 2]]), { maxArrayLength: -1 }), '{"…":"2 more entries"}');
    assert.equal(s(new Map([["a", 1], ["b", 2]]), { maxArrayLength: Number.NaN }), '{"a":1,"b":2}');
    assert.equal(s(new Map([["a", 1], ["b", 2], ["c", 3]]), { maxArrayLength: 1.9 }), '{"a":1,"…":"2 more entries"}');
    assert.equal(s(new Map([["…", "keep"], ["b", 2]]), { maxArrayLength: 1 }), '{"…":"keep","……":"1 more entries"}');
  });

  it("functions, symbols and replacer", () => {
    function named() {}
    assert.equal(s({ f: named, s: Symbol("tag"), [Symbol("hidden")]: 1 }, { functions: true }), '{"f":"[Function named]","s":"Symbol(tag)"}');
    assert.equal(s({ password: "x", user: "ada" }, { replacer: (k, v) => (k === "password" ? undefined : v) }), '{"user":"ada"}');
  });
});
