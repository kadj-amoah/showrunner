# Showrunner roadmap

Anchored on the v1.1.0 publish (2026-05-23). Cycles are ~2 weeks each at a heavy maintenance cadence (~6–8 hr/week of focused work).

## Released

| Version | Date | Theme |
|---|---|---|
| **v1.1.0** | 2026-05-23 | First tagged release — pipeline works end-to-end, LLM + TTS providers swappable. See [CHANGELOG.md](./CHANGELOG.md#110--2026-05-23). |

## Planned

| Version | Window | Ship target | Theme |
|---|---|---|---|
| **v1.1.1** | 2026-05-24 → 2026-06-07 | 2026-06-07 | **Cross-OS reliability** |
| **v1.1.2** | 2026-06-08 → 2026-06-21 | 2026-06-21 | **Untested CLI commands burndown** |
| **v1.1.3** | 2026-06-22 → 2026-07-05 | 2026-07-05 | **Tier-3 surface closure** |
| **v1.2.0** | 2026-07-06 → 2026-08-02 | 2026-08-02 | **DX polish + community scaffolding + marketing gate** |

---

### v1.1.1 — Cross-OS reliability

The pipeline has been validated end-to-end on Windows + WSL only. v1.1.1 closes the obvious cross-platform gaps so the README's "works on Linux, macOS, Windows" claim holds up.

- [ ] Run the full pipeline on **macOS** (Apple Silicon and Intel if possible) — fix path / ffmpeg / chromium issues that surface
- [ ] Run the full pipeline on **Linux native** (Ubuntu LTS in a container or VM) — verify `apt install ffmpeg` path, no Windows path leakage
- [ ] **Windows-native** (no WSL, no Git Bash) — port the scaffolded `seed_demo_data.sh` / `reset_demo_data.sh` / `teardown.sh` to PowerShell siblings, or document the Git-Bash-required caveat
- [ ] Audit `src/` for hardcoded `/` separators that should be `path.join` / `path.sep`
- [ ] Add CI matrix (GitHub Actions) covering Node 20 + Node 22 on `ubuntu-latest` + `macos-latest` + `windows-latest`

### v1.1.2 — Untested CLI commands burndown

Several CLI commands are coded but were never exercised in the v1.1.0 validation. Each gets a smoke run + any necessary fixes.

- [ ] `showrunner instrument` — validate against a real codebase, confirm the diff applies cleanly
- [ ] `showrunner capture-auth` — test against at least one auth-gated site
- [ ] `showrunner run --resume` — exercise partial-failure → resume flow end-to-end
- [ ] `showrunner trace` — confirm Playwright trace viewer opens correctly on each OS
- [ ] `showrunner preview` — verify UI Mode launches the generated Playwright spec
- [ ] `showrunner rerun-segment` — confirm reset_script invocation + single-segment re-record
- [ ] `showrunner print-vo` — wire any missing output formatting
- [ ] `showrunner approve-vo` — already exercised in unit tests; add an integration test

### v1.1.3 — Tier-3 surface closure

The CHANGELOG's "Known limitations" Tier 3 list — coded but never exercised end-to-end.

- [ ] **OpenAI LLM provider** — real end-to-end run with an OPENAI_API_KEY
- [ ] **OpenAI TTS provider** + `alignment_strategy: best_effort` per-segment fallback path
- [ ] **`agent_bridge` file_poll mode** — file-based request/response handshake
- [ ] **Custom provider modules** — reference implementation in `docs/examples/`
- [ ] **Auth flows** — at least one each of `form`, `session`, `setup_script` against a real protected site
- [ ] **Background music mix** + title-card logo + custom font in mux

### Marketing decision gate (early July)

After v1.1.3 ships, evaluate whether to launch publicly (Hacker News, Reddit, dev Twitter) or stay stealth for another cycle. The decision rests on:
- v1.1.x stability (no regressions across the three OSes)
- Doctor green on every reference target
- README polish + at least 2 worked-example projects to point to

### v1.2.0 — DX polish + community

- [ ] Docker image bundling Node 20 + Chromium + ffmpeg + xvfb (the one currently promised in the README "Deployment target" section)
- [ ] Examples repo: TodoMVC, Conduit, a marketing site — three reference `demo.yaml` projects checked in
- [ ] Video walkthrough — produced with Showrunner itself ("dogfooding") demonstrating first-run-to-MP4 in 5 minutes
- [ ] CONTRIBUTING.md fleshed out beyond the v1.1.0 skeleton
- [ ] GitHub Action template for "run Showrunner on every PR" demo-recording workflow
- [ ] Marketing decision execution (if green-lit)

## Out-of-scope until v2.0.0 (breaking-change cycle)

- Remove the legacy v1.0 → v1.1 config normalization shim
- Any schema cleanups that would invalidate existing `demo.yaml` files
- Additional TTS providers (Azure, Google Cloud, Coqui local) — non-breaking, can ship in any v1.x

---

See [MAINTENANCE.md](./MAINTENANCE.md) for the weekly / bi-weekly / monthly rituals that keep this calendar honest.
