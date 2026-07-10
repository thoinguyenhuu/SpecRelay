# SpecRelay architecture

## Phase A boundaries

SpecRelay is a single Node.js ESM package. The public CLI and the future Codex
plugin are adapters around a small, testable core; the core is the source of
truth for state, configuration, paths, and error codes.

```text
Codex plugin (future) ─┐
                       ├─> SpecRelay CLI ─> core
Terminal user ─────────┘                     ├─ state machine
                                              ├─ configuration schema
                                              ├─ paths and safety checks
                                              └─ stable errors
```

Phase A deliberately contains no model client, credential handling, network
request, or Git worktree lifecycle.

## CLI contract

- `specrelay doctor` is read-only and returns human-readable output or JSON.
- `specrelay init` requires an existing Git repository. It is idempotent and
  only creates local SpecRelay artifacts after preflight validation.
- Errors have stable codes such as `NOT_A_GIT_REPOSITORY`, `INVALID_CONFIG`,
  and `ARTIFACT_DIRECTORY_COLLISION`.

## Persistent configuration

The v1 configuration is stored at `.specrelay/config.json` in the target
repository. It records only its schema version, creator version, and the fixed
artifact directory. It cannot contain credentials, model settings, or agent
permissions.

Future phases will add approved plans, isolated worktrees, executor logs, and
review packets without allowing plan text to bypass CLI policy.
