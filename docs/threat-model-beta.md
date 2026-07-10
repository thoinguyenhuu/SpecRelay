# SpecRelay beta threat model

## Release gate

`v0.1.0-beta.2` may be released only after the designated maintainer reads this
document, records findings in the GitHub Environment approval, and approves
the `beta-release` environment. The release workflow is manual and must not
publish to npm.

## Assets and trust boundaries

| Area              | Primary risk                                           | Required mitigation                                                                                                              |
| ----------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Git marketplace   | A marketplace points to an unexpected plugin revision. | Pin the plugin source to the immutable beta tag; validate name, URL, and tag/version parity.                                     |
| Release tarball   | A tester installs altered or incomplete CLI contents.  | Build from the tagged commit, run validation, publish the `.tgz` and SHA-256 checksum, then require checksum verification.       |
| Global CLI PATH   | Another executable shadows `specrelay`.                | Verify `specrelay --version` and resolve its path before a run.                                                                  |
| Plugin skill      | Instructions attempt to replace CLI enforcement.       | The skill only calls documented CLI commands; approval, worktree, checks, and review remain CLI gates.                           |
| Target repository | Prompt injection or hostile code influences an agent.  | Trusted-repository policy, approved plan hash, isolated worktree, limited executor tools, bounded output, and human diff review. |
| Worktree cleanup  | Cleanup removes user work.                             | Owned-path checks, clean-worktree refusal, explicit `--yes`, and retained audit artifacts.                                       |

## Reviewer checklist

- [ ] Confirm the release tag, package version, manifest version, and marketplace ref are all `v0.1.0-beta.2` / `0.1.0-beta.2`.
- [ ] Confirm CI and package smoke tests passed for the tagged commit.
- [ ] Inspect the tarball file list and checksum.
- [ ] Confirm the CLI remains `private: true` and the workflow has no npm publish step.
- [ ] Confirm beta documentation states trusted-repository and credential-redaction limits.
- [ ] Record accepted residual risks and blocking findings before approving `beta-release`.
