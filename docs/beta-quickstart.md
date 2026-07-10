# SpecRelay beta quickstart

This guide installs the `v0.1.0-beta.1` CLI from a GitHub Release tarball and
then installs the Codex plugin from the SpecRelay Git marketplace. The CLI and
plugin are separate installations by design.

## Before you start

- Node.js 22+, npm 10+, Git, and the Codex desktop app are required.
- Claude Code is only required for a real `specrelay implement` run; it is not
  required to install the beta or inspect a dry-run.
- Run only on repositories you trust. Never paste credentials, private diffs,
  or raw `.specrelay/` artifacts into a public issue.

## 1. Install and verify the CLI

Install the release tarball globally:

```sh
npm install --global https://github.com/thoinguyenhuu/SpecRelay/releases/download/v0.1.0-beta.1/specrelay-cli-0.1.0-beta.1.tgz
specrelay --version
specrelay doctor --json
```

The version must be `0.1.0-beta.1`. If `specrelay` is not found, reopen the
terminal and ensure npm's global bin directory is on `PATH`.

## 2. Add the plugin marketplace

```sh
codex plugin marketplace add thoinguyenhuu/SpecRelay --ref v0.1.0-beta.1 --sparse .agents/plugins
codex plugin marketplace list
```

Restart the Codex desktop app, open the Plugins directory, select **SpecRelay
Beta**, and install **SpecRelay**. Start a new task after installation so the
bundled workflow skill is loaded.

The plugin only guides Codex to use the installed CLI. It does not store a
Claude credential, grant Claude execution permission, or bypass the CLI's
approval and safety gates.

## 3. Run the safe fixture

Copy `examples/beta-fixture` to a separate directory, initialize it as a Git
repository, and create an initial commit. Then run its checks:

```sh
npm run lint
npm test
```

In a new Codex task, ask SpecRelay to plan the objective described in the
fixture README. Review and approve the plan in chat. Use `implement --dry-run`
first. A real Claude run is optional and must be limited to this trusted
fixture.

## Troubleshooting

- **Windows PowerShell:** restart PowerShell after global npm installation. Use
  `Get-Command specrelay` and `Get-Command codex` to check PATH resolution.
- **Windows WSL:** install Node, Git, Codex CLI, and Claude Code inside the WSL
  distribution; do not mix Windows and Linux paths for one run.
- **macOS/Linux:** reopen the shell after global installation, then run
  `command -v specrelay` and `command -v codex`.
- **Plugin missing:** run `codex plugin marketplace list`, confirm the
  `v0.1.0-beta.1` marketplace source, restart the desktop app, and install
  from the Plugins directory.
- **Codex cannot run shell commands:** use the same `specrelay` commands from
  a terminal. The workflow and audit artifacts remain identical.

## Feedback

Use the **Beta feedback** GitHub issue form with the release tag, OS/tool
versions, outcome, and sanitized reproduction. Use the private security
reporting process in `SECURITY.md` for vulnerabilities.
