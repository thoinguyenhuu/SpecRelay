# Contributing to SpecRelay

Thank you for contributing. SpecRelay is intentionally safety-oriented: any
change that affects filesystem access, process execution, credentials, policy,
or agent prompts requires focused tests and a clear security rationale.

## Local setup

```bash
npm install
npm run validate
```

Node.js 22+ and Git are required. Tests use temporary Git repositories and a
fake/offline workflow; do not add real Codex or Claude credentials to tests.

## Pull requests

- Keep each change focused and update docs when behavior changes.
- Add unit or integration tests for bug fixes and new behavior.
- Run `npm run validate` before opening a pull request.
- Explain any new process, filesystem, network, or permission behavior.
- Do not add telemetry, remote downloads, or `shell: true` without a design
  discussion and maintainer approval.

## Reporting vulnerabilities

Do not open a public issue for a suspected security vulnerability. Follow
[SECURITY.md](SECURITY.md) instead.
