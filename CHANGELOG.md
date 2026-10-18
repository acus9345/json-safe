# Changelog

All notable changes to this project are documented here. This project follows [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-10-18

### Added

- `safeStringify()`: `JSON.stringify` that never throws. Handles circular references (with their path), BigInt, Map, Set, Error (`cause`, own properties, `AggregateError`), typed arrays, RegExp, invalid dates, throwing getters, throwing `toJSON()` and hostile Proxies.
- `toSafeJSON()` returns the plain JSON data instead of a string.
- Options: `space`, `sortKeys`, `maxDepth`, `maxStringLength`, `maxArrayLength`, `circular`, `bigint`, `errorStack`, `functions` and `replacer`.

[0.1.0]: https://github.com/acus9345/json-safe/releases/tag/v0.1.0
