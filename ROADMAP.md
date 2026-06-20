# Showrunner roadmap

Released versions and per-version themes are in [CHANGELOG.md](./CHANGELOG.md). v1.1.1 through v1.1.8 shipped on 2026-05-24, immediately after the v1.1.0 publish on 2026-05-23. v1.2.0 is the next planned cycle.

## Released

| Version | Date | Theme |
|---|---|---|
| **v1.1.0** | 2026-05-23 | First tagged release. End-to-end pipeline, swappable LLM + TTS providers. |
| **v1.1.1** | 2026-05-24 | Cross-OS reliability + first-run UX. `playwright-core` swap, doctor per-OS hints, sudo-cache detection. |
| **v1.1.2** | 2026-05-24 | Babel runtime deps moved to `dependencies`. `install-browser` subcommand. |
| **v1.1.3** | 2026-05-24 | Bare-command welcome and `init` next-steps footer rewrites. |
| **v1.1.4** | 2026-05-24 | Interactive `init` wizard. Detect → Q&A → inline key paste → URL probe → real `.env`. |
| **v1.1.5** | 2026-05-24 | `set-target` subcommand, init port-scan, agent-driven dev-server discovery. |
| **v1.1.6** | 2026-05-24 | `understand --agent` delegates project exploration to the local `claude` CLI. |
| **v1.1.7** | 2026-05-24 | `understand --agent` cwd fix. `--project-dir` flag, `project.codebase_root` config field. |
| **v1.1.8** | 2026-05-24 | Welcome ffmpeg/ffprobe detection. Init wizard cwd confirm. README polish. |

## Planned

| Version | Ship target | Theme |
|---|---|---|
| **v1.2.0** | 2026-08-02 | Doctor-with-remediation, Docker image, discoverability + community |

### v1.2.0

#### 1. Doctor-with-remediation

Refactor `src/commands/doctor.ts` from inline check functions into a check-registry where each check returns `{ status, label, detail, fix?: () => Promise<FixResult> }`. Add a top-level `--fix` (or `--interactive`) flag. Without it, the command behaves as today (report-only). Split into two scope modes:

- `doctor` (no `-c`) — system-prereq pass only: ffmpeg, ffprobe, chromium, node, free disk, free memory.
- `doctor -c demo.yaml` — full pass, including provider keys and target URL.

Tiered scope:

- [ ] **Tier 1 — install remediation.** Detect host package manager (`pacman` / `apt` / `dnf` / `brew` / `winget` / `choco`). On missing `ffmpeg` / `ffprobe` / `chromium`, prompt and run install. Collapse `ffprobe` into `ffmpeg`'s install. Chromium already has the `install-browser` wrapper.
- [ ] **Tier 2 — API-key fitness + remediation.** Per-provider cheapest-call ping: Anthropic `models.list`, OpenAI `models.list`, ElevenLabs `GET /v1/voices`, agent_bridge `claude -p "ping"`. On missing-or-invalid, prompt for paste, write to `.env`, re-check. For ElevenLabs `voice_id` mismatch, list voices via the same endpoint and offer a `select` picker.
- [ ] **Tier 3 — runtime fitness + remediation.** Target URL on failure offers the v1.1.5 agent-discovery flow, or a "start your server, press enter, re-probe" prompt. Playwright check launches a real headless browser (about:blank, close) to catch sandbox / SELinux / AppArmor blocks beyond binary-exists.
- [ ] **Tier 4 — stretch (defer).** Lifecycle-script regen from template. Zod-error to specific fix mapping.

#### 2. Docker image

- [ ] One-command containerised usage. Node 20 + Chromium + ffmpeg + xvfb. Delivers what the README's "Deployment target" section has promised since v1.1.0.

#### 3. Discoverability + community scaffolding

- [ ] Examples repo. Three reference `demo.yaml` projects: TodoMVC, Conduit, a marketing site.
- [ ] Video walkthrough produced with Showrunner itself, first-run-to-MP4 in 5 minutes.
- [ ] CONTRIBUTING.md fleshed out beyond the v1.1.0 skeleton.
- [ ] GitHub Action template for "run Showrunner on every PR" demo-recording workflow.
- [ ] Marketing decision gate. After v1.2.0 ships, evaluate launching publicly (HN / Reddit / dev Twitter) vs. another stealth cycle. Decision rests on: v1.1.x + v1.2.0 stability, doctor green on every reference target, README polish, at least two worked-example projects to point at.

#### Smaller gaps rolled in

- [ ] Wire `type: codebase` entries in `comprehension.sources` to the non-`--agent` document path. Micromatch / fast-glob, binary filters, file caps, vendored-dir defaults.
- [ ] PID tracking + `showrunner teardown` for v1.1.5's spawned dev servers.
- [ ] Generalise agent-driven discovery beyond `agent_bridge`. Wire `anthropic` and `openai` providers via their structured-output paths.

## Carry-over from original plan — unscheduled

The original v1.1.1 / v1.1.2 / v1.1.3 cycles in this file (cross-OS validation, untested-command burndown, Tier-3 surface closure) did not ship during the 2026-05-24 batch. Items below are not currently scheduled into any cycle. Pick up into v1.2.x patches or a later minor as priorities clarify.

### Cross-OS validation

- [ ] Full pipeline run on **macOS** (Apple Silicon and Intel where possible). Fix any path / ffmpeg / chromium issues that surface.
- [ ] Full pipeline run on **Linux native** (Ubuntu LTS in a container or VM). Verify the `apt install ffmpeg` path, no Windows path leakage.
- [ ] **Windows-native** (no WSL, no Git Bash). Port the scaffolded `seed_demo_data.sh` / `reset_demo_data.sh` / `teardown.sh` to PowerShell siblings, or document the Git-Bash-required caveat.
- [ ] Audit `src/` for hardcoded `/` separators that should be `path.join` / `path.sep`.
- [ ] GitHub Actions CI matrix covering Node 20 + Node 22 on `ubuntu-latest`, `macos-latest`, `windows-latest`.

### Untested CLI command burndown

Each command is coded but was not exercised in the v1.1.0 validation.

- [ ] `showrunner instrument` against a real codebase. Confirm the diff applies cleanly.
- [ ] `showrunner capture-auth` against at least one auth-gated site.
- [ ] `showrunner run --resume`. Partial-failure to resume flow end-to-end.
- [ ] `showrunner trace`. Playwright trace viewer opens correctly on each OS.
- [ ] `showrunner preview`. UI Mode launches the generated Playwright spec.
- [ ] `showrunner rerun-segment`. reset_script invocation + single-segment re-record.
- [ ] `showrunner print-vo`. Wire any missing output formatting.
- [ ] `showrunner approve-vo`. Add an integration test alongside the existing unit coverage.

### Tier-3 provider surface closure

- [ ] **OpenAI LLM provider** end-to-end run with an `OPENAI_API_KEY`.
- [ ] **OpenAI TTS provider** with `alignment_strategy: best_effort` per-segment fallback.
- [ ] **`agent_bridge` file_poll mode**. File-based request/response handshake.
- [ ] **Custom provider modules**. Reference implementation in `docs/examples/`.
- [ ] **Auth flows**. At least one each of `form`, `session`, `setup_script` against a real protected site.
- [ ] **Background music mix**, title-card logo, custom font in mux.

## Out-of-scope until v2.0.0 (breaking-change cycle)

- Remove the legacy v1.0 → v1.1 config normalization shim.
- Schema cleanups that would invalidate existing `demo.yaml` files.
- Additional TTS providers (Azure, Google Cloud, Coqui local). Non-breaking; can ship in any v1.x.

---

See [MAINTENANCE.md](./MAINTENANCE.md) for the weekly / bi-weekly / monthly rituals that keep this calendar honest.
