# Security policy

## Supported versions

Until the first stable release, the latest code on `main` is the supported
development version.

## Reporting a vulnerability

Please do not create a public issue for a suspected vulnerability. Contact the
maintainers privately through the repository's GitHub Security Advisory flow
after the repository is published. Include a minimal reproduction, impact, and
any suggested mitigation.

Maintainers will acknowledge reports within seven days and coordinate a fix and
disclosure timeline with the reporter.

## Security principles

- No telemetry or remote reporting.
- No credential storage; bounded logs redact common credential patterns.
- Agent execution uses explicit policy, isolated workspaces, and human approval
  gates; it never relies on prompt text as authorization.
- Beta releases require a maintainer threat-model review before the
  `beta-release` environment is approved.
