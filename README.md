# Showrunner

Automated product demo recording & production tool.

Showrunner collapses the demo-video pipeline into a single, repeatable, automatable command. Point it at a running web product, give it a one-page brief, and it produces a finished, captioned MP4 — comprehension, script, recording, voiceover, and mux in one pass.

## Status

v1.1 — usable end-to-end for short demos. The LLM and TTS layers are provider-agnostic so you can bring your own keys or wire in an in-house pipeline. See `prd_showrunner.md` for the full product spec.

## What you need on your machine

- **Node ≥ 20.6** (`process.loadEnvFile` is required)
- **ffmpeg + ffprobe on PATH** (`apt install ffmpeg` on Debian/Ubuntu, `brew install ffmpeg` on macOS, gyan.dev build on Windows)
- **A Chromium binary** — Playwright installs one for you (`npx playwright install chromium`)
- **API keys for the providers you pick**, OR a headless CLI agent like `claude -p` (see _Provider choices_ below)

Showrunner is built to deploy on Linux but develops fine on WSL2 or macOS.

## Install

Until the GitHub Packages release lands, install from source:

```bash
git clone https://github.com/kadj-amoah/showrunner.git
cd showrunner
npm install
npm run build
npm link                    # makes `showrunner` available globally
npx playwright install chromium
```

Verify with `showrunner --help`.

## First demo in five commands

```bash
showrunner init --name my-demo --url http://localhost:3000
cd my-demo
cp .env.example .env                       # then paste in your provider keys
$EDITOR docs/PRD.md                        # replace the stub with your product brief
showrunner doctor -c demo.yaml             # preflight: 11–12 PASS/FAIL rows
showrunner run -c demo.yaml                # the whole pipeline
open output/demo_final.mp4
```

If you'd rather not write a PRD upfront, swap the `$EDITOR` step for `showrunner understand -c demo.yaml --interactive` — it asks five questions and produces the product model on the spot.

## Provider choices

The two generative stages (LLM for comprehension + script, TTS for voiceover) are pluggable. Pick them at scaffold time with `--llm-provider` and `--tts-provider`, or edit the `llm` and `voiceover.provider` blocks in `demo.yaml` later.

### LLM (`llm.default.provider`)

| Provider       | Needs                                      | Notes                                                                       |
|----------------|--------------------------------------------|-----------------------------------------------------------------------------|
| `anthropic`    | `ANTHROPIC_API_KEY`                        | Default. Uses Claude with structured outputs.                                |
| `openai`       | `OPENAI_API_KEY`                           | Uses `response_format: json_schema`, falls back to `json_object` if needed.  |
| `agent_bridge` | A headless CLI agent on PATH (default `claude -p --output-format json`) | No API key on file — Showrunner spawns the agent per request.                |
| `custom`       | A dynamic-importable module                | Implement the `LLMProvider` interface.                                       |

Per-stage overrides are supported under `llm.overrides.{comprehension,script,instrument}` so you can, e.g., use `agent_bridge` for the heavy script generation and `anthropic` for the small `instrument` calls.

### TTS (`voiceover.provider.name`)

| Provider     | Needs                  | Alignment? | Default `alignment_strategy` |
|--------------|------------------------|------------|------------------------------|
| `elevenlabs` | `ELEVENLABS_API_KEY`   | ✅          | `required`                   |
| `openai`     | `OPENAI_API_KEY`       | ❌          | `best_effort`                |
| `custom`     | A dynamic-import module| Your call  | `best_effort`                |

Only ElevenLabs returns per-character alignment. With other providers, Showrunner takes the **best-effort path**: one synthesis call per segment (no slicing), captions collapse to whole-segment cues, and `at_word` action timing degrades to `at`. Set `voiceover.alignment_strategy: required` if you want it to fail loudly instead.

## Pipeline

```
comprehension → script → record + voiceover → mux → demo_final.mp4
```

| Stage           | What it does                                                                                       | Inputs                                  | Outputs                                                 |
|-----------------|----------------------------------------------------------------------------------------------------|-----------------------------------------|---------------------------------------------------------|
| `comprehension` | Reads `docs/`, an optional codebase, or runs the interactive Q&A. Emits `product_model.json`.       | `docs/PRD.md` (or `--interactive`)      | `product_model.json`                                    |
| `script`        | Scrapes the live target's actionable DOM, then asks the LLM for a manifest using only those selectors. | `product_model.json` + live target URL  | `scripts/manifest.json`, `vo_script.txt`, Playwright spec |
| `record`        | Drives Playwright through the manifest, captures `master.webm` + a slice plan.                     | manifest, dev server                    | `segments/video/master.webm`, `slice_plan.json`         |
| `voiceover`     | TTS for the whole script, slices per segment, writes alignment files (when supported).             | manifest                                | `segments/audio/*.mp3`, `segments/alignment/*.json`     |
| `mux`           | Normalizes, slices, branding cards, background music, captions. Outputs the MP4.                   | video + audio + alignment               | `output/demo_final.mp4` (+ `.srt`/`.vtt` if enabled)    |

Stages are independently runnable, checkpointed, and idempotent. Existing artifacts are never silently overwritten — use `--force <stage>[,<stage>]` to regenerate.

## Daily commands

```bash
# preflight — catches missing keys, ffmpeg, dev server down, free disk, RAM cap
showrunner doctor -c demo.yaml

# generate (or refresh) product_model.json from docs/PRD.md
showrunner understand -c demo.yaml
showrunner understand -c demo.yaml --interactive          # 5-question fallback

# full pipeline (`--skip-doctor` to bypass the implicit preflight)
showrunner run -c demo.yaml

# re-run just one stage
showrunner run -c demo.yaml --stages script
showrunner run -c demo.yaml --force voiceover,mux         # regen, don't reuse

# the LLM's selectors are wrong for one segment — demo it yourself
showrunner record-actions -c demo.yaml --segment fill-form

# preview the manifest in Playwright UI Mode (no recording)
showrunner preview -c demo.yaml

# inspect a failed take
showrunner trace -c demo.yaml --segment <id>
```

## When things go wrong

- **`x264 malloc failed` during mux** — out of RAM. The `doctor` row "free memory: … (ffmpeg thread cap: N)" shows what was budgeted. Drop resolution to 1280x720 (or 854x480 for draft), set `SHOWRUNNER_FFMPEG_THREADS=1`, or close Docker / browsers.
- **Recording fails because a selector doesn't resolve** — usually the LLM picked something fragile. The `script` stage's DOM preflight is supposed to prevent this; if it does happen, run `showrunner record-actions -c demo.yaml --segment <id>` and demonstrate the interaction yourself.
- **`vo_review_gate` halted the pipeline** — by design. Edit `scripts/vo_script.txt`, then `showrunner approve-vo -c demo.yaml`. (The init scaffold ships with this off — you have to opt in via `script.vo_review_gate: true`.)
- **Output file is locked by a media player** — close VLC/QuickTime/your-browser-tab. Showrunner falls back to writing a timestamped sibling MP4 with a warning, but the canonical path needs the lock released.
- **DOM preflight failed** — your dev server isn't on the URL in `demo.yaml`, or it's behind auth. Bring the server up, configure `recording.auth` for session/form/setup-script flows.

## Configuration reference

`demo.yaml` is the single source of truth. Sections:

- `project` — name and optional `product_model` path
- `comprehension` — `mode` + `sources` (PRD, README, codebase, OpenAPI, etc.)
- `script` — `style`, `duration_target_seconds`, `highlight_features`, `vo_review_gate`
- `recording` — `target_url`, viewport, browser, cursor + segment timing knobs, auth, lifecycle scripts
- `voiceover` — `provider` (discriminated by `name`), `alignment_strategy`, output dirs, drift behavior, pause placement
- `llm` — `default` provider + per-stage `overrides` (comprehension, script, instrument)
- `output` — resolution, fps, branding cards, background music, captions, output path

Legacy v1.0 configs (flat `voiceover.voice_id`, no `llm` block) are auto-migrated by the loader — your existing demos keep working without edits.

## Deployment target

Linux. Local dev runs on WSL2/Docker on Windows or macOS hosts. A Docker image bundling Node 20, Playwright (Chromium), FFmpeg, and `xvfb` is on the roadmap.

## License

MIT
