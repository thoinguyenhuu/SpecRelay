# Beta acceptance checklist

Use one checklist per tester. This document prepares a 5–10 person beta; it
does not collect telemetry or contact testers automatically.

## Tester record

- Release tag: `v0.1.0-beta.2`
- Platform: Windows PowerShell, Windows WSL, macOS, or Linux
- Node, npm, Git, Codex, and Claude Code versions:
- Fixture-only or real Claude fixture run:
- Result: pass, blocked, or failed

## Required checks

- [ ] Verified the release checksum before installing the tarball.
- [ ] Installed the CLI and confirmed `specrelay --version`.
- [ ] Ran `specrelay doctor --json` and recorded only sanitized capability output.
- [ ] Added the Git marketplace, restarted Codex, installed SpecRelay, and used a new task.
- [ ] Copied `examples/beta-fixture` outside the SpecRelay source repository.
- [ ] Initialized the fixture as Git, made an initial commit, then ran its lint and test commands.
- [ ] Reviewed a plan in Codex chat and confirmed plan approval remained explicit.
- [ ] Ran `implement --dry-run` before any optional real Claude execution.
- [ ] Inspected the worktree/diff/report before any manual follow-up action.
- [ ] Submitted sanitized feedback or explicitly reported no issue.

## Exit criteria

Record a blocking issue when installation, plugin discovery, explicit approval,
worktree isolation, check enforcement, or review state is unclear or unsafe.
Do not report credentials, private source, raw artifacts, or unredacted logs in
the public issue tracker.
