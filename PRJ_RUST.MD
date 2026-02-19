# Rust Warning Management Guide

This document describes how to identify, categorize, and eliminate Rust compiler warnings in the `worker` crate. It is based on the root causes found during the initial cleanup of 193 warnings in February 2026.

---

## 1. How to see warnings

Run the build from the Developer Command Prompt (or via `start.ps1`, which sets up the VS environment):

```powershell
cd worker
cargo build 2>&1 | Select-String "^warning"
```

To get a count:

```powershell
cargo build 2>&1 | Select-String "^warning" | Measure-Object -Line
```

The compiler also prints a summary line at the end:

```
warning: `sazinka-worker` (bin "sazinka-worker") generated N warnings
```

**Important:** The build must be run with the MSVC environment active (`VCINSTALLDIR` set). Without it, the build fails before reaching Rust compilation and only C-level warnings from third-party `-sys` crates are shown (see Section 6).

---

## 2. Warning categories found in this project

### 2.1 Dead code — unused struct / never constructed

```
warning: struct `Foo` is never constructed
  --> src/types/bar.rs:10:12
```

**Root cause:** A struct is defined in a `types/` module but no code path reachable from `main()` ever creates an instance. This happens when:

- A DTO or request type is defined in anticipation of a feature not yet wired to a NATS handler.
- A struct was used by an old implementation that was replaced (e.g., the old VRPTW solver).

**How to identify:** Run `cargo build` and look for `is never constructed` or `is never used` on struct names.

**Resolution options:**

| Situation | Action |
|---|---|
| Type is part of the planned data model, not yet wired | Add `#![allow(dead_code)]` at the top of the module file |
| Type was used by replaced/deleted code | Delete the type |
| Type is only needed in tests | Wrap with `#[cfg(test)]` |

---

### 2.2 Dead code — unused enum / never used

```
warning: enum `VisitStatus` is never used
  --> src/types/visit.rs:11:10
```

**Root cause:** Same as 2.1 — enum defined but never referenced from reachable code. Common for status/type enums in `types/` that are used in DB queries but the query result is never accessed in a way that triggers the enum variant.

**Resolution:** Same as 2.1.

---

### 2.3 Dead code — unused associated function / method

```
warning: associated functions `new`, `fast`, `quality`, and `instant` are never used
  --> src/services/vrp/config.rs:30:12
```

**Root cause:** A method or constructor is defined on a struct/enum but never called from reachable code. Common for:

- Builder/factory methods on configuration structs (`fast()`, `quality()`, `instant()`) that are defined for future use.
- `as_str()` / `from_str()` helpers on enums that are defined for completeness but not yet called.
- `new()` constructors on job queue types that are not yet used.

**Resolution options:**

| Situation | Action |
|---|---|
| Method is a planned API, keep for future use | Add `#[allow(dead_code)]` on the `impl` block or the method |
| Method is only needed in tests | Wrap with `#[cfg(test)]` |
| Method is genuinely obsolete | Delete it |

---

### 2.4 Dead code — unused field

```
warning: field `stop_id` is never read
  --> src/services/vrp/solution.rs:52:9
```

**Root cause:** A struct field is populated (e.g., by `sqlx::FromRow` or by a constructor) but never read by any reachable code.

**Resolution options:**

| Situation | Action |
|---|---|
| Field is part of the data model, will be used later | Add `#[allow(dead_code)]` on the field or the struct |
| Field is loaded from DB but only used via conversion methods | Add `#[allow(dead_code)]` on the struct |
| Field is genuinely obsolete | Delete it |

---

### 2.5 Dead code — entire module unused

```
warning: struct `VrptwSolver` is never constructed
warning: struct `VrptwStop` is never constructed
...
  --> src/services/vrptw.rs
```

**Root cause:** An entire module was replaced by a better implementation but the old module was not deleted. The module declaration remains in `mod.rs`.

**How to identify:** All (or almost all) items in a module generate dead code warnings.

**Resolution:** Delete the module file and remove its `pub mod` declaration from the parent `mod.rs`.

**Risk:** Low — verify first that nothing imports from the module using `grep -r "vrptw" src/`.

---

### 2.6 Dead code — function is a thin wrapper

```
warning: function `build_pragmatic_problem` is never used
  --> src/services/vrp/adapter.rs:69:8
```

**Root cause:** A function that was the original entry point was superseded by a more capable variant (e.g., `build_pragmatic_problem_with_buffer`). The old function now just delegates to the new one but is never called.

**Resolution:** Delete the wrapper function. If the simpler API is genuinely useful, keep it and add `#[allow(dead_code)]`.

---

### 2.7 Test-only function in production code

```
warning: associated function `with_token` is never used
  --> src/types/messages.rs:19:12
```

**Root cause:** A helper function is only called from `#[cfg(test)]` test code but lives in a non-test `impl` block. The compiler sees it as dead code in production builds.

**Resolution:** Wrap the function with `#[cfg(test)]`:

```rust
#[cfg(test)]
impl<T> Request<T> {
    pub fn with_token(token: String, payload: T) -> Self { ... }
}
```

---

## 3. The `types/` module pattern

The `types/` directory contains data model types: request/response DTOs, enums, and job queue types. Many of these are defined ahead of their handlers being wired. This is intentional — the types document the intended API surface.

**Convention:** Add `#![allow(dead_code)]` at the top of every `types/*.rs` file that contains forward-defined types. This suppresses all dead code warnings for that file without hiding real problems in `handlers/` or `services/`.

```rust
// At the very top of the file, before any use statements:
#![allow(dead_code)]
```

This is safe because:
- `types/` files contain only data definitions, no logic.
- Real logic bugs (unused variables, unreachable code) live in `handlers/` and `services/`, which do NOT get this blanket suppression.

---

## 4. Decision flowchart

```
New dead code warning appears
        │
        ▼
Is the item in types/ ?
    │           │
   YES          NO
    │           │
    ▼           ▼
Is it part of   Is the entire module dead?
planned model?      │           │
    │           YES             NO
   YES           │              │
    │           Delete          Is it test-only?
    ▼           module              │       │
Add             and mod         YES         NO
#![allow(       declaration      │          │
dead_code)]                  Wrap with   Is it a
to the file                  #[cfg(test)] thin wrapper?
                                         │       │
                                        YES      NO
                                         │       │
                                       Delete  Add #[allow(
                                       wrapper dead_code)]
                                               on item
```

---

## 5. Suppression reference

### Module-level (suppress all dead code in a file)

```rust
#![allow(dead_code)]
```

Place this as the very first line of the `.rs` file (before `use` statements).

### Item-level (suppress for one struct/enum/fn)

```rust
#[allow(dead_code)]
pub struct Foo { ... }
```

### Impl-level (suppress for all methods in an impl block)

```rust
#[allow(dead_code)]
impl SolverConfig {
    pub fn fast() -> Self { ... }
    pub fn quality() -> Self { ... }
}
```

### Test-only (only compile the item in test builds)

```rust
#[cfg(test)]
impl<T> Request<T> {
    pub fn with_token(...) -> Self { ... }
}
```

### Intentionally unused variable (suppress for one binding)

```rust
let _result = some_fallible_call();  // prefix with _ to suppress
```

---

## 6. C-level warnings from third-party `-sys` crates (not Rust warnings)

When the build runs **without** the MSVC environment set up (e.g., from a plain PowerShell without running `vcvars64.bat`), the build fails during the C compilation phase of native crates. The output contains C compiler warnings like:

```
warning: zstd-sys@2.0.16: cl : Command line warning D9002 : ignoring unknown option '-fvisibility=hidden'
```

These are **not Rust warnings** and cannot be fixed in this project. They come from:

| Crate | Pulled in by | Notes |
|---|---|---|
| `zstd-sys` | `zip` crate (default features) | Eliminated by using `zip = { default-features = false, features = ["deflate"] }` |
| `lzma-sys` | `zip` → `xz2` | Same fix |
| `bzip2-sys` | `zip` → `bzip2` | Same fix |
| `ring` | `async-nats`, `jsonwebtoken` | Required for TLS and JWT crypto, cannot be avoided |

**Fix for `zip` crate** (removes ~150 C warnings on Windows):

In `worker/Cargo.toml`:
```toml
# Before:
zip = "2.2"

# After:
zip = { version = "2.2", default-features = false, features = ["deflate"] }
```

The project only uses `CompressionMethod::Deflated`, so no functionality is lost.

**Note:** These C warnings only appear when the build fails early. Once the VS environment is active and the build succeeds, only Rust-level warnings are shown.

---

## 7. Workflow for new features

When adding a new feature:

1. **Define types first** in `types/your_feature.rs` with `#![allow(dead_code)]` at the top.
2. **Add the module** to `types/mod.rs`.
3. **Implement the handler** in `handlers/your_feature.rs`.
4. **Wire the handler** in `handlers/mod.rs` → `start_handlers()`.
5. Once the handler is wired and all types are reachable, **remove `#![allow(dead_code)]`** from the types file to let the compiler catch any types that were defined but not actually used.

---

## 8. Files with `#![allow(dead_code)]` and why

| File | Reason |
|---|---|
| `types/notification_job.rs` | Email/SMS job queue types; processors exist but job queue not yet wired from main |
| `types/import_export_job.rs` | Import/export job queue types; same pattern |
| `types/import.rs` | Import batch request DTOs; partially wired |
| `types/communication.rs` | Communication enums used in import but not in dedicated handler |
| `types/visit.rs` | Visit status/type/result enums used in import queries |
| `types/work_item.rs` | WorkType/WorkResult helpers used in import queries |
| `types/device.rs` | DeviceType enum and request types |
| `types/device_type_config.rs` | DeviceFieldValue/Dto used in DB queries |
| `types/route.rs` | RouteStop, OptimizeRouteRequest/Result — planned API |
| `types/revision.rs` | RevisionResult, RevisionIdRequest — partially wired |
| `types/role.rs` | UserPermissions — planned API |
| `types/messages.rs` | Request::with_token — test helper kept in production code |
| `types/settings.rs` | UserWithSettings fields loaded by sqlx but not all read directly |
