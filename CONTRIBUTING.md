# Contributing to Showrunner

Thanks for poking at this. Showrunner is a small project run on a heavy maintenance cadence (see [ROADMAP.md](./ROADMAP.md) for the dated plan and [MAINTENANCE.md](./MAINTENANCE.md) for the weekly / bi-weekly rhythm). Outside contributions are welcome — this guide tries to make the path obvious.

## Quick orientation

- **One author** maintains this currently. Triage happens Monday mornings.
- The codebase is **TypeScript + ESM** running on **Node ≥ 20.6** (needs `process.loadEnvFile`).
- The CLI is built with **tsup**, run via **tsx** in dev. Tests use **vitest**.
- Linux is the deployment target; macOS and Windows are first-class development environments.

## Before you start coding

If your change is **non-trivial** (more than a typo / one-line bug fix), please open an issue first describing what you want to change and why. This saves you from building something that conflicts with a planned cycle's theme or that's about to be deprecated.

For **bug reports**, the existing issue templates ask for the minimum reproduction info. Please use them.

## Local setup

```bash
git clone https://github.com/kadj-amoah/showrunner.git
cd showrunner
npm install
npm run typecheck    # must pass
npm run test         # must pass (2 tests for now)
npm run build        # produces dist/cli.js
node dist/cli.js --help
```

For running the CLI during development, use `npm run dev -- <command>` which uses tsx and doesn't need a build step.

## Working against a real demo project

The repo doesn't ship reference demo projects (yet — that's a v1.2.0 item). For local development you'll want one. Easiest path:

```bash
cd /tmp
npm run --prefix /path/to/showrunner dev -- init --name testdemo --url http://localhost:3000
cd testdemo
# fill in .env, write docs/PRD.md
npm run --prefix /path/to/showrunner dev -- doctor -c demo.yaml
```

## Submitting a change

1. **Fork** the repo on GitHub.
2. **Branch** from `main` (`git checkout -b fix/some-bug`).
3. **Code + test** — every behavior change needs at least one test if practical. Tests live next to the source (e.g. `src/mux/branding.test.ts`).
4. **Run the gate** before pushing:
   ```bash
   npm run typecheck && npm run test && npm run build
   ```
5. **Commit** with a clear message. First line ≤ 72 chars in imperative mood, blank line, then the why (not the what — the diff shows the what).
6. **Push** + **PR** against `main`. Reference any related issue (`Fixes #42`).

## What I'll respond with

- **Within ~1 week** for triage (in line with the Monday triage ritual).
- **PR review** is generally same-week if the change is in scope for the current cycle, longer if not.
- **Out-of-scope changes** won't necessarily be rejected — they may be parked against a future milestone.

## What's in scope vs. out

**In scope** for any version:
- Bug fixes
- New TTS / LLM providers
- New CLI commands that don't break existing schema
- Documentation, examples, tests
- Performance improvements
- Cross-OS compatibility fixes

**Out of scope until v2.0.0:**
- Anything that breaks existing `demo.yaml` files
- Removing the legacy v1.0 → v1.1 config normalization shim
- Schema field renames
- CLI flag renames

If you're not sure, open an issue and ask.

## Code style

- Prettier defaults are enforced via `npm run format`.
- ESLint config is what's in `eslint.config.js`.
- Prefer functions and modules over classes unless a class is genuinely the right shape.
- One short comment when WHY is non-obvious; otherwise let the names carry it. No multi-paragraph docstrings.

## Security

Don't open a public issue for security bugs. Email kadj.amoah@gmail.com directly with details.

## Licensing

By contributing, you agree your contributions are licensed under the [MIT License](./LICENSE) (same as the rest of the project).
