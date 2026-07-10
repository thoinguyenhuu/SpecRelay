# SpecRelay beta fixture

This is a deliberately small, dependency-free Node.js target repository for a
trusted beta run. Copy this directory to a separate location before using it;
do not create `.specrelay/` artifacts in the SpecRelay source repository.

The safe example objective is: add `createFormalGreeting(name)` to
`src/greeting.mjs`, export it, and add a matching test. The approved plan must
include the explicit checks below:

```yaml
checks:
  - id: lint
    preset: node
    argv: ["npm", "run", "lint"]
    timeout: "1m"
  - id: test
    preset: node
    argv: ["npm", "test"]
    timeout: "1m"
```

Run `npm run lint` and `npm test` before starting a SpecRelay run. A real
Claude execution is optional and requires the tester's own Claude Code setup.
