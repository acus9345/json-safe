# json-safe

`JSON.stringify` that never throws. Circular references, BigInt, Map, Set, Error (with `cause`), typed arrays and throwing getters all come out as sensible JSON. About 1.7 kB gzipped, zero dependencies, works everywhere.

[![npm](https://img.shields.io/npm/v/json-safe)](https://www.npmjs.com/package/json-safe)
[![CI](https://github.com/acus9345/json-safe/actions/workflows/ci.yml/badge.svg)](https://github.com/acus9345/json-safe/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/json-safe)](LICENSE)

`JSON.stringify` throws on a circular reference or a BigInt, prints `{}` for a Map, a Set or an Error, and lets any throwing getter take your logger down with it. That's the last thing you want in an error handler. `safeStringify` handles all of that and always returns a string.

## Install

```bash
npm install json-safe
```

## Usage

```js
import { safeStringify } from "json-safe";

const user = {
  id: 1n,
  tags: new Set(["admin"]),
  lastError: new Error("Card declined", { cause: { code: "E_CARD" } }),
};
user.self = user;

safeStringify(user, { errorStack: false });
```

```json
{"id":"1","tags":["admin"],"lastError":{"name":"Error","message":"Card declined","cause":{"code":"E_CARD"}},"self":"[Circular ~]"}
```

`JSON.stringify(user)` would have thrown `TypeError: Do not know how to serialize a BigInt`.

## What it handles

| Value | `JSON.stringify` | `safeStringify` |
| --- | --- | --- |
| Circular reference | throws | `"[Circular ~.path.to.target]"` |
| `BigInt` | throws | `"123"`, or `123` with `{ bigint: "number" }` |
| `Map` | `{}` | an object, or `[[key, value], ...]` when keys aren't strings or numbers |
| `Set` | `{}` | an array |
| `Error` | `{}` | `name`, `message`, `stack`, `cause`, own properties like `code`, and `errors` for `AggregateError` |
| Typed arrays | `{"0":1,"1":2}` | `[1, 2]` |
| `RegExp` | `{}` | `"/a+/gi"` |
| Throwing getter or `toJSON()` | throws | `"[Throws: message]"` |
| Proxy with throwing traps | throws | `"[Throws: message]"` |
| `ArrayBuffer`, `WeakMap`, `Promise` | `{}` | a short description |
| Top-level `undefined` | `undefined` | `"null"` |

Everything else (`Date`, `URL`, `NaN`, `undefined` properties, functions, objects with `toJSON`) behaves exactly like `JSON.stringify`. The same object appearing twice without a cycle is serialized twice, as JSON would.

## Options

```js
safeStringify(value, {
  space: 2,
  sortKeys: true,
  maxDepth: 5,
  maxStringLength: 1000,
  maxArrayLength: 100,
  circular: "[Circular]",
  bigint: "string",
  errorStack: true,
  functions: false,
  replacer: (key, value) => (key === "password" ? undefined : value),
});
```

| Option | Default | What it does |
| --- | --- | --- |
| `space` | none | Indentation, like `JSON.stringify`'s third argument. |
| `sortKeys` | `false` | Sort object keys, so equal values always give the same string (handy for hashing and snapshots). |
| `maxDepth` | unlimited | Deeper objects become `"[Object]"` (or the class name) and `"[Array]"`. |
| `maxStringLength` | unlimited | Longer strings are cut and say how many characters were left out. |
| `maxArrayLength` | unlimited | Longer arrays, Sets and Maps are cut and say how many items were left out. |
| `circular` | `"[Circular <path>]"` | Replacement for circular references: a string, or a function of the path (`"~"` is the root). |
| `bigint` | `"string"` | `"number"` prints bare digits. Valid JSON, but JavaScript's `JSON.parse` loses precision above 2^53. |
| `errorStack` | `true` | Include `Error.stack`. |
| `functions` | `false` | Show functions and symbols (`"[Function name]"`, `"Symbol(desc)"`) instead of dropping them. |
| `replacer` | none | Called with every key and value after `toJSON()`. Return `undefined` to drop the key. |

## `toSafeJSON(value, options?)`

Returns the plain JSON data instead of a string, for loggers that serialize on their own:

```js
import { toSafeJSON } from "json-safe";

logger.info({ request: toSafeJSON(req, { maxDepth: 3 }) });
```

## Performance

It walks the value itself before calling `JSON.stringify`, so it's slower than plain JSON, around 5 times on a 1,000-key object of nested data. That's fine for logging and error reporting. For hot paths with data you know is plain, use `JSON.stringify`.

## License

MIT
