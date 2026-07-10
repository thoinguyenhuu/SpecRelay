# SpecRelay architecture

## Phase C boundaries

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

Phase C adds a local worker that starts Claude Code only after human plan
approval and a second `implement --yes` confirmation. It creates a branch and
Git worktree outside the base repository, then records bounded, redacted local
artifacts. It still contains no model API client, credential storage, test
runner, code review, commit, push, or merge capability.

## CLI contract

- `specrelay doctor` is read-only and returns human-readable output or JSON.
- `specrelay init` requires an existing Git repository. It is idempotent and
  only creates local SpecRelay artifacts after preflight validation.
- `specrelay plan` creates one run in `draft_plan` with a Vietnamese plan draft.
  The canonical document is `plan.md`; its YAML front matter has structured
  scope, constraints, steps, acceptance criteria, and open questions.
- `specrelay show` is deliberately summary-first. It compares the current
  `plan.md` SHA-256 with `approval.json` and reports `not_approved`, `current`,
  or `stale`.
- `specrelay approve` requires `--yes`, validates a complete plan, blocks
  unresolved blocking questions unless a reasoned override is explicit, then
  records `draft_plan → awaiting_approval → approved`.
- Errors have stable codes such as `NOT_A_GIT_REPOSITORY`, `INVALID_CONFIG`,
  `RUN_NOT_FOUND`, `OPEN_BLOCKING_QUESTIONS`, `PLAN_CHANGED_AFTER_APPROVAL`,
  and `RUN_LOCKED`.
- `specrelay implement` re-checks approval integrity, rejects a dirty base
  repository, creates `specrelay/<run-id>` in an owned cache worktree, and
  launches a detached internal worker. It requires a separate `--yes`.
- `specrelay status`, `cancel`, `report`, and `cleanup` are lifecycle commands.
  Cancellation is an artifact request consumed by the worker; it never sends a
  signal to an unverified PID. Cleanup only removes a clean owned worktree and
  always retains run artifacts.

## Persistent configuration

The v1 configuration is stored at `.specrelay/config.json` in the target
repository. It records only its schema version, creator version, and the fixed
artifact directory. It cannot contain credentials, model settings, or agent
permissions.

## Run artifacts and integrity

Each run is stored below `.specrelay/runs/<run-id>/`:

```text
request.md              Original objective
plan.md                 Canonical, human-readable plan with YAML front matter
state.json              Atomic state snapshot
events.jsonl            Append-only audit events
plan.normalized.json    Derived executor input, created only on approval
approval.json           Plan hash and approval audit record
policy.json             Immutable permission and resource-limit snapshot
executor-prompt.md      Deterministic contract passed to Claude Code
execution.json          Worker heartbeat, worktree ownership, and outcome
executor-events.jsonl   Bounded, redacted Claude stream events
executor-summary.json   Exit result and changed-file summary
```

Mutating commands hold a short exclusive per-run lock. `plan.md` is hashed as
the complete byte sequence read from disk. Any differing byte makes approval
stale. The executor must call the approval integrity gate before using a plan.

The worker runs `claude -p` without a shell, `--add-dir`, or dangerous
permission bypass. Its default policy permits file changes only in the worktree
and Git read operations, while denying commit, push, publish, auth, downloads,
and destructive shell patterns. This is a defense-in-depth policy, not a
security sandbox.

## Chat-first adapter

The bundled `specrelay-workflow` skill directs Codex to discuss and revise the
plan in chat, update artifacts only after the plan is shown, and execute
`approve --yes` only after direct user confirmation in the current conversation.
It invokes Claude Code only after the user explicitly asks to implement an
already-approved plan. It then presents lifecycle summaries in chat and stops
before check or review stages.

Future phases will add target checks, public diff, and review packets without
allowing plan text to bypass CLI policy.
