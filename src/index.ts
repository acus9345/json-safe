/**
 * `JSON.stringify` that never throws.
 *
 * @example
 * import { safeStringify } from "json-safe";
 *
 * const user = { id: 1n, tags: new Set(["a"]), error: new Error("nope") };
 * user.self = user;
 * safeStringify(user);
 * // {"id":"1","tags":["a"],"error":{"name":"Error","message":"nope","stack":"..."},"self":"[Circular ~]"}
 */

export interface SafeStringifyOptions {
  /** Indentation, like JSON.stringify's third argument. */
  space?: number | string;
  /** Sort object keys, so equal values always give the same string. Default `false`. */
  sortKeys?: boolean;
  /** Objects nested deeper than this become `"[Object]"` / `"[Array]"`. Default: unlimited. */
  maxDepth?: number;
  /** Strings longer than this are cut, noting how many characters were left out. Default: unlimited. */
  maxStringLength?: number;
  /** Arrays, Sets and Maps longer than this are cut, noting how many items were left out. Default: unlimited. */
  maxArrayLength?: number;
  /**
   * What a circular reference becomes: a string, or a function of the path to the
   * object it points back to (`"~"` is the root, `"~.a.b[0]"` a nested object).
   * Default: `"[Circular ~.path]"`.
   */
  circular?: string | ((path: string) => unknown);
  /** `"string"` (default): `"123"`. `"number"`: a bare JSON number, which may lose precision when parsed in JavaScript. */
  bigint?: "string" | "number";
  /** Include `Error.stack`. Default `true`. */
  errorStack?: boolean;
  /** Show functions and symbols as `"[Function name]"` / `"Symbol(desc)"` instead of leaving them out like JSON does. Default `false`. */
  functions?: boolean;
  /** Runs on every value after `toJSON()`, like JSON.stringify's replacer. Return `undefined` to drop a key. */
  replacer?: (key: string, value: unknown) => unknown;
}

/** Plain JSON data. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

const OMIT = Symbol("omit");
// Marks a BigInt that should print as a bare number. JSON.stringify escapes it as \u0000.
const NUL = String.fromCharCode(0);

/**
 * Convert any value to plain JSON data (objects, arrays, strings, numbers, booleans, null).
 * This is what {@link safeStringify} serializes; use it to hand data to a logger.
 */
export function toSafeJSON(value: unknown, options: SafeStringifyOptions = {}): Json {
  const out = convert(value, options, undefined);
  return out === OMIT ? null : out;
}

/**
 * `JSON.stringify` that handles circular references, BigInt, Map, Set, Error,
 * typed arrays, RegExp, invalid dates, throwing getters and throwing `toJSON()`.
 * Always returns a string; a top-level `undefined`, function or symbol gives `"null"`.
 */
export function safeStringify(value: unknown, options: SafeStringifyOptions = {}): string {
  try {
    const token = options.bigint === "number" ? `${NUL}${Math.random().toString(36).slice(2)}:` : undefined;
    const data = convert(value, options, token);
    let text = JSON.stringify(data === OMIT ? null : data, null, options.space) ?? "null";
    if (token !== undefined) {
      // Unquote the marked BigInts: "\u0000abc:123" becomes 123.
      const marker = `\\u0000${token.slice(1)}`;
      text = text.split(`"${marker}`).map((part, i) => (i === 0 ? part : part.replace(/^(-?\d+)"/, "$1"))).join("");
    }
    return text;
  } catch (error) {
    // Unreachable for plain data, but the promise is to never throw.
    return JSON.stringify(`[Unserializable: ${describeError(error)}]`);
  }
}

function convert(root: unknown, options: SafeStringifyOptions, bigintToken: string | undefined): Json | typeof OMIT {
  const ancestors: object[] = [];
  const paths: string[] = [];
  const maxDepth = options.maxDepth ?? Infinity;
  const maxString = options.maxStringLength ?? Infinity;
  const maxItems = options.maxArrayLength ?? Infinity;

  const circular = (target: object, depth: number): Json | typeof OMIT => {
    const path = paths[ancestors.indexOf(target)] ?? "~";
    if (typeof options.circular === "function") return walk(options.circular(path), "", "~", depth);
    return options.circular ?? `[Circular ${path}]`;
  };

  const str = (s: string): string => (s.length > maxString ? `${s.slice(0, maxString)}… (${s.length - maxString} more characters)` : s);

  const list = (items: readonly unknown[], path: string, depth: number, total: number): Json[] => {
    const out: Json[] = [];
    for (let i = 0; i < items.length && i < maxItems; i++) {
      const v = walk(items[i], String(i), `${path}[${i}]`, depth + 1);
      out.push(v === OMIT ? null : v);
    }
    if (total > maxItems) out.push(`… ${total - maxItems} more items`);
    return out;
  };

  const object = (entries: [string, unknown][], path: string, depth: number): { [key: string]: Json } => {
    if (options.sortKeys) entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const out: { [key: string]: Json } = {};
    for (const [key, val] of entries) {
      const child = /^[A-Za-z_$][\w$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
      const v = walk(val, key, child, depth + 1);
      if (v !== OMIT) out[key] = v;
    }
    return out;
  };

  /** Read a property without letting a throwing getter (or Proxy trap) escape. */
  const read = (obj: object, key: PropertyKey): unknown => {
    try {
      return (obj as Record<PropertyKey, unknown>)[key];
    } catch (error) {
      return `[Throws: ${describeError(error)}]`;
    }
  };

  const container = (obj: object, path: string, depth: number): Json => {
    if (Array.isArray(obj)) return list(obj, path, depth, obj.length);
    if (obj instanceof Map) {
      const entries = [...obj.entries()];
      const shown = entries.slice(0, maxItems);
      if (entries.every(([k]) => typeof k === "string" || typeof k === "number")) {
        const out = object(shown.map(([k, val]) => [String(k), val]), path, depth);
        if (entries.length > maxItems) out["…"] = `${entries.length - maxItems} more entries`;
        return out;
      }
      return list(shown.map(([k, val]) => [k, val]), path, depth, entries.length);
    }
    if (obj instanceof Set) return list([...obj], path, depth, obj.size);
    if (obj instanceof Error) {
      const out: [string, unknown][] = [
        ["name", obj.name],
        ["message", obj.message],
      ];
      if (options.errorStack !== false && obj.stack) out.push(["stack", obj.stack]);
      const own = Object.keys(obj);
      for (const k of own) if (k !== "name" && k !== "message" && k !== "stack") out.push([k, read(obj, k)]);
      if ("cause" in obj && !own.includes("cause")) out.push(["cause", read(obj, "cause")]);
      if (obj instanceof AggregateError && !own.includes("errors")) out.push(["errors", obj.errors]);
      return object(out, path, depth);
    }
    if (obj instanceof RegExp) return obj.toString();
    if (ArrayBuffer.isView(obj)) {
      const items =
        obj instanceof DataView
          ? [...new Uint8Array(obj.buffer, obj.byteOffset, obj.byteLength)]
          : Array.from(obj as unknown as ArrayLike<number | bigint>);
      return list(items, path, depth, items.length);
    }
    if (obj instanceof ArrayBuffer) return { type: "ArrayBuffer", byteLength: obj.byteLength };
    if (obj instanceof WeakMap || obj instanceof WeakSet || (typeof WeakRef !== "undefined" && obj instanceof WeakRef)) {
      return `[${constructorName(obj)}]`;
    }
    if (obj instanceof Promise) return "[Promise]";
    return object(Object.keys(obj).map((k) => [k, read(obj, k)]), path, depth);
  };

  const walk = (value: unknown, key: string, path: string, depth: number): Json | typeof OMIT => {
    let v = value;
    // toJSON first, like JSON.stringify (Date, URL, Buffer, decimal libraries...).
    if (v !== null && typeof v === "object" && !ancestors.includes(v)) {
      const toJSON = read(v, "toJSON");
      if (typeof toJSON === "function") {
        try {
          v = toJSON.call(v, key);
        } catch (error) {
          v = `[Throws: ${describeError(error)}]`;
        }
      }
    }
    if (options.replacer) v = options.replacer(key, v);

    switch (typeof v) {
      case "string":
        return str(v);
      case "number":
        return Number.isFinite(v) ? v : null;
      case "boolean":
        return v;
      case "bigint":
        if (options.bigint !== "number") return v.toString();
        if (bigintToken !== undefined) return `${bigintToken}${v.toString()}`;
        return Number.isSafeInteger(Number(v)) ? Number(v) : v.toString();
      case "undefined":
        return OMIT;
      case "function":
        return options.functions ? `[Function ${v.name || "anonymous"}]` : OMIT;
      case "symbol":
        return options.functions ? v.toString() : OMIT;
    }
    if (v === null) return null;
    const obj = v as object;
    if (ancestors.includes(obj)) return circular(obj, depth);
    if (depth >= maxDepth) return Array.isArray(obj) ? "[Array]" : `[${constructorName(obj) ?? "Object"}]`;

    ancestors.push(obj);
    paths.push(path || "~");
    try {
      return container(obj, path || "~", depth);
    } catch (error) {
      // A Proxy whose traps throw, or an object that refuses inspection.
      return `[Throws: ${describeError(error)}]`;
    } finally {
      ancestors.pop();
      paths.pop();
    }
  };

  return walk(root, "", "", 0);
}

function constructorName(obj: object): string | undefined {
  try {
    const name = (Object.getPrototypeOf(obj) as { constructor?: { name?: unknown } } | null)?.constructor?.name;
    return typeof name === "string" && name !== "" ? name : undefined;
  } catch {
    return undefined;
  }
}

function describeError(error: unknown): string {
  try {
    return error instanceof Error ? error.message : String(error);
  } catch {
    return "unknown error";
  }
}

export default safeStringify;
