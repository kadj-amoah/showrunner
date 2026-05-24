# Changelog

All notable changes to Showrunner are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project tracks loose semver — minor bumps for new capability, patch for fixes.

## [1.1.2] — 2026-05-24

### Fixed

- `showrunner --version` crashed on fresh global install with `ERR_MODULE_NOT_FOUND` for `@babel/parser`. The babel runtime dependencies (`@babel/parser`, `@babel/traverse`, `@babel/types`) used by the `instrument` stage were in `devDependencies` and therefore absent from the published tarball. Moved to `dependencies`. `@types/babel__traverse` stays in `devDependencies` (type-only).

### Added

- `showrunner install-browser` subcommand. Wraps the bundled `playwright-core` CLI directly, sidestepping the "install your dependencies first" warning that bare `npx playwright install` emits when invoked outside a Node project.
- Welcome detects missing chromium and surfaces an `install-browser` hint.

## [1.1.1] — 2026-05-24

### Changed

- Replace `playwright` with `playwright-core`. Eliminates the ~300 MB browser auto-download on `npm install`. `npx playwright install chromium` is now a required post-install step (enforced by `doctor`).
- `doctor` failure rows include per-OS install hints for `ffmpeg` and `ffprobe` (apt / pacman / dnf on Linux, brew on macOS, winget / choco on Windows).
- `doctor` probes the root / admin Playwright cache and warns when a browser is present there but missing from the user cache (the typical aftermath of `sudo npx playwright install`).

### Removed

- `fluent-ffmpeg` and `@types/fluent-ffmpeg`. The package was listed but never imported; ffmpeg invocations have always gone through `child_process.spawn` via the internal `runFfmpeg()` wrapper.

### Fixed

- Generated Playwright spec at `src/manifest/playwrightCodegen.ts` imported `expect` from `'playwright'`, which doesn't export it. The `assert_visible` action now emits `locator.waitFor({ state: 'visible' })`.

### Docs

- README leads with `npx @kadj-amoah/showrunner`. Browser bootstrap (`npx playwright install chromium`) is called out as required.
- Troubleshooting note added for Arch / CachyOS / Fedora users who see Playwright's "OS not officially supported" warning during browser install.

## [1.1.0] — 2026-05-23

First tagged release. Versioned `1.1.0` rather than `0.1.0` because the project has been tracked as "v1.1 — reliability hardening + provider-agnostic refactor" throughout development; this is the first cut where the pipeline works end-to-end against real Next.js targets and the LLM + TTS layers are swappable. No `1.0.0` was ever published.

### Added

- **Provider-agnostic LLM layer** (`llm.default` + per-stage `llm.overrides`). Four providers:
  - `anthropic` — Claude via the official SDK with structured outputs.
  - `openai` — `gpt-4o`-style models via `response_format: json_schema` with `json_object` fallback.
  - `agent_bridge` — spawn a headless CLI agent like `claude -p --output-format json`; **no API key on file required**. Supports `spawn` and `file_poll` modes.
  - `custom` — dynamic-import an operator-supplied module conforming to the `LLMProvider` interface.
- **Provider-agnostic TTS layer** (`voiceover.provider`). Three providers:
  - `elevenlabs` — the only one that returns per-character alignment.
  - `openai` — `tts-1-hd` via the audio API.
  - `custom` — dynamic-import for in-house TTS pipelines.
- **`alignment_strategy: required | best_effort`** — when a TTS provider doesn't return alignment, switch automatically to per-segment synthesis (one TTS call per segment) so audio doesn't get sliced across mid-word boundaries.
- **`showrunner doctor`** — preflight checks before any run. Validates config syntax, provider env vars, ffmpeg + ffprobe on PATH, Playwright chromium binary, target URL reachability, free disk on every output dir, free memory + computed ffmpeg thread cap, and lifecycle script executability. Wired into `run` implicitly (escape with `--skip-doctor`).
- **`showrunner record-actions`** with scroll capture. Drives a headed browser; captures click / input / change / keydown / submit / **scroll** events; coalesces them into a clean action stream. Scroll capture is 250 ms debounced with direction coalescing.
- **DOM preflight in the `script` stage** — scrapes the live target's actionable selector inventory (≈60–80 entries on a typical marketing site) before asking the LLM for a manifest. The LLM is constrained to inventory selectors only, with a one-shot remediation retry if it strays.
- **Resource preflight** in `record` and `mux` stages — checks free disk against estimated artifact sizes, computes an ffmpeg `-threads` cap from free RAM × resolution × quality preset (`SHOWRUNNER_FFMPEG_THREADS` env override available).
- **Structured ffmpeg errors** — categorized as `oom | no_space | codec_missing | permission | unknown`, with per-category remediation hints.
- **`--resolution` flag** on both `init` and `run`. Presets: `low` (854×480), `standard` (720p, the default), `high` (1080p), `extreme` (4K). On `run` it overrides both `recording.viewport` and `output.resolution` in one step so they stay matched and mux doesn't upscale.
- **`init` flags**: `--llm-provider`, `--tts-provider`, `--resolution`. Scaffolds a `demo.yaml` with the right provider blocks, an `.env.example` listing only the env vars that combination actually needs (deduplicated when LLM + TTS both use OpenAI), and a real `docs/PRD.md` stub with section guides.
- **Legacy config auto-migration** — pre-v0.1 `demo.yaml` files with flat `voiceover.{voice_id, model, ...}` fields and no `llm` block are normalized at load time. Existing configs keep working with zero edits.
- **`validate --strict`** — exit nonzero on missing provider env vars (otherwise warns).
- **Captions** — SRT + VTT emitted alongside the final MP4 when `output.captions.enabled` is set. Whole-segment cues are used as a fallback when per-character alignment isn't available.

### Changed

- `engines.node` bumped to `>=20.6` (needed for `process.loadEnvFile`).
- `init` defaults: `script.vo_review_gate: false` (was true), `recording.viewport: 1280×720` (was 1920×1080), `output.resolution: 1280x720`. Each is opt-in to the larger/stricter value via a one-line edit.
- `tsup` configured with `skipNodeModulesBundle: true` and `target: 'node20'`. Built `dist/cli.js` dropped from 1.75 MB to 247 KB and no longer crashes with `Dynamic require of "tty" is not supported` — `npm link` and `npm i -g` are viable now.
- README rewritten for v0.1 — install path (with `npm link`), full prereqs (Node ≥ 20.6, ffmpeg, chromium), provider-choice tables, pipeline-per-stage table, daily-commands cookbook, troubleshooting section.

### Fixed

- `understand --interactive` no longer silently exits after the second question on piped stdin. Replaced `readline/promises.question()` with a queued `'line'`-event reader that handles both TTY and pipe semantics.
- `understand --output <path>` now correctly takes precedence over `project.product_model` in the config (was silently overridden).
- Script-stage prompt now bans Tailwind arbitrary-value class names (`.max-w-[1280px]`) which aren't legal CSS and crashed Playwright with a `SyntaxError`. A post-validator catches violations and retries once with a remediation prompt before accepting the manifest.
- `looksUnstable()` heuristic now catches Next.js compiled-CSS classes like `__variable_3eb911` (leading underscores were previously slipping past).
- `mux` output write now falls back to a timestamped sibling MP4 when the canonical path is locked by a media player, with a warning, instead of failing the run.

### Known limitations (Tier 3 — coded but not exercised end-to-end)

- OpenAI LLM + OpenAI TTS provider paths are wired but were not run with a real API key in v0.1 validation. The agent_bridge + ElevenLabs combination is the validated default.
- `agent_bridge` file_poll mode is coded but only `spawn` mode was exercised.
- Custom provider modules (LLM + TTS) — dynamic-import loader is wired but no reference implementation has been swapped in.
- `instrument`, `capture-auth`, `trace`, `preview`, `rerun-segment`, `print-vo`, `approve-vo` commands are mostly thin wrappers but were not stress-tested in v0.1.
- Background music mix and title-card logo / custom-font rendering are coded but were not exercised.
- 1920×1080 mux remains RAM-sensitive on tight boxes; the thread-cap heuristic mitigates but the safe default is `--resolution standard`.

### Validation artifact

A real end-to-end run against the Credstone Atlas marketing site produced `output/ct-website-atlas_demo.mp4` (4.3 MB, H.264 + AAC, 1280×720, 48.2 s, with SRT + VTT) using:
- `agent_bridge` LLM (via local `claude` CLI, no Anthropic key on file)
- ElevenLabs TTS with `alignment_strategy: required`
- DOM preflight + selector validator producing inventory-only manifest selectors
- Full mux preflight + thread cap on a 5.9 GB RAM machine with 1.1 GB free at run time

[1.1.0]: https://github.com/kadj-amoah/showrunner/releases/tag/v1.1.0
[1.1.1]: https://github.com/kadj-amoah/showrunner/releases/tag/v1.1.1
[1.1.2]: https://github.com/kadj-amoah/showrunner/releases/tag/v1.1.2
