# Product Requirements Document: Showrunner
**Automated Product Demo Recording & Production Tool**

Version: 0.4 — Draft
Status: In Review

> **Changelog for 0.4:** Audio post-processing added (debreath filter chain runs by default on every clip — removes ElevenLabs MultilingualV2's audible inhales). Voice-settings defaults updated to practitioner-tested values (`stability: 0.55`, `style: 0.0`, `use_speaker_boost: true`). Intra-segment pause placement formalized: when VO is shorter than its segment, slack silence is distributed at manifest-action boundaries rather than dumped at clip end. All three derive from learnings on a prior hand-built pipeline (credstone) that produced a finished demo.
>
> **Changelog for 0.3:** Recording architecture revised to single-context, single-video, slice-in-post (was: new context per segment) — eliminates black-frame artifacts and preserves auth/state continuity. Codegen integration clarified as spec-file-plus-AST-parse (was: implied direct event capture). Voiceover synthesis switched to ElevenLabs `with-timestamps` endpoint by default; `trim_pad` strategy dropped; `resynthesize` speed clamped to [0.85, 1.15]. All three changes informed by a v0.3 research pass against Playwright ~1.49, FFmpeg 7.x, and ElevenLabs v2 docs.

---

## 1. Overview

### 1.1 Problem Statement

Creating a high-quality product demo video is expensive and slow. It requires coordinating a screen recording, a polished voiceover, synchronized UI interactions, and video editing — work that typically spans multiple tools, multiple people, and multiple revision cycles. Every time the product changes, the demo goes stale.

Showrunner collapses this entire pipeline into a single, repeatable, automatable command. Given a product, it understands how it works, writes the script, performs the UI interactions, records the voiceover via ElevenLabs, and produces a finished MP4 — with no human in the loop unless you want one.

### 1.2 Target Users

- **Solo developers** who need a demo video but have no video production resources
- **QA engineers and DevRel** who want to produce feature walkthroughs on every release
- **Agents (e.g. Claude Code)** running as part of a CI/CD pipeline to auto-generate demo videos on release

### 1.3 Design Philosophy

- **Understand first, record second.** The quality of the output is bounded by the quality of the product understanding. Every pipeline run begins with a comprehension pass.
- **Separation of concerns.** Script generation, UI automation, voiceover synthesis, and video muxing are discrete, independently replaceable stages.
- **Agent-first ergonomics.** Every stage is driven by config files and CLI flags, not a GUI. A human and an agent should have identical access.
- **Idempotent by default.** Re-running any stage should produce the same result. Existing artifacts are never silently overwritten — the operator must opt in with `--force`.

---

## 2. Goals and Non-Goals

### Goals

- Ingest product documentation, PRD, and source code to generate an accurate understanding of the product
- Generate a synchronized master script (timestamps, VO text, Playwright actions) from that understanding
- Execute Playwright interactions against a running instance of the product and capture screen recordings
- Synthesize voiceover via the ElevenLabs API
- Mux all assets via FFmpeg into a production-ready MP4
- Expose a CLI and a YAML/JSON config interface suitable for both human use and agent invocation
- Manage demo state (seed, reset, teardown) so recordings are reproducible across runs
- Expose Playwright's native live toolset (Codegen, UI Mode, Trace Viewer) as first-class CLI commands at the right moments in the workflow

### Non-Goals

- Showrunner is not a general-purpose screen recorder or browser automation framework
- It does not host, deploy, or manage the product being demoed — it requires a running instance to connect to
- It does not produce interactive demos (e.g. Arcade, Navattic) — output is a flat video file
- It does not replace a human editor for broadcast-quality work; it targets "very good" not "broadcast perfect"

---

## 3. System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                       Showrunner CLI                         │
│            showrunner run --config demo.yaml                 │
└──────────────────────────┬──────────────────────────────────┘
                           │
           ┌───────────────▼──────────────────┐
           │       Stage 1: Comprehension      │
           │  (Document ingestion → LLM pass)  │
           └───────────────┬──────────────────┘
                           │  product_model.json
           ┌───────────────▼──────────────────┐
           │       Stage 2: Script Gen         │
           │  Master script + timestamp map    │
           └───┬────────────────┬─────────────┘
               │                │
   ┌───────────▼──┐     ┌───────▼──────────┐
   │ Stage 3a     │     │ Stage 3b          │
   │ Playwright   │     │ ElevenLabs VO     │
   │ Screen Rec   │     │ Synthesis         │
   └───────┬──────┘     └───────┬──────────┘
           │  segments/         │  audio/
           └─────────┬──────────┘
                     │
         ┌───────────▼──────────┐
         │   Stage 4: FFmpeg    │
         │   Mux + Edit         │
         └───────────┬──────────┘
                     │
              demo_output.mp4 + build_manifest.json
```

---

## 4. Feature Specifications

---

### 4.1 Stage 1 — Product Comprehension

The first stage builds a structured internal model of the product before any recording happens.

#### 4.1.1 Document Ingestion Mode (Primary)

Showrunner accepts a manifest of input sources:

```yaml
comprehension:
  mode: documents
  sources:
    - type: prd
      path: ./docs/PRD.md
    - type: codebase
      path: ./src
      include: ["**/*.ts", "**/*.tsx", "**/*.py"]
      exclude: ["**/node_modules", "**/__tests__"]
    - type: readme
      path: ./README.md
    - type: openapi
      path: ./docs/openapi.yaml
    - type: changelog
      path: ./CHANGELOG.md
```

Accepted source types: `prd`, `readme`, `codebase`, `openapi`, `changelog`, `custom`.

For `codebase` sources, Showrunner performs a shallow parse: it reads file names, exported function/class names, route definitions, and top-level comments — it does not attempt full semantic analysis. The goal is interface-level understanding, not implementation detail.

All ingested content is chunked, summarized per-source, and then synthesized by an LLM call into a structured **product model**:

```jsonc
// product_model.json (generated artifact)
{
  "product_name": "Avocado",
  "tagline": "Autonomous voice AI testing platform",
  "primary_user": "QA Engineers and voice AI teams",
  "confidence": "high",        // high | medium | low
  "source": "documents",       // documents | interactive
  "generated_at": "2025-05-20T10:00:00Z",
  "core_flows": [
    {
      "id": "create-test",
      "name": "Create a voice test",
      "steps": ["Navigate to Tests", "Click New Test", "..."],
      "entry_url": "/tests/new"
    }
  ],
  "key_features": ["..."],
  "demo_recommendation": {
    "suggested_flows": ["create-test", "run-test", "review-results"],
    "suggested_duration_seconds": 90
  }
}
```

This file is human-readable and editable. A developer can review and correct the model before proceeding.

**Artifact precedence:** If `product_model.json` already exists, Showrunner skips comprehension and uses it directly. To regenerate, pass `--force comprehension` or delete the file. This prevents expensive LLM re-runs when nothing about the product has changed.

#### 4.1.2 Interactive Mode (Fallback)

When documents are unavailable or insufficient, Showrunner drops into an interactive Q&A mode:

```
$ showrunner understand --interactive

? What does your product do? (one sentence)
> Avocado is an autonomous voice AI testing platform.

? What are the 2-3 most important things a user can do in the product?
> 1. Create and configure voice tests
> 2. Run tests against live AI systems
> 3. Review call transcripts and pass/fail reports

? What's the URL of the running instance to record against?
> http://localhost:3000

? Walk me through the main user flow step by step (type 'done' when finished):
> ...
```

Responses are structured into the same `product_model.json` format, flagged with `"source": "interactive"` and `"confidence": "medium"` for transparency.

---

### 4.2 Stage 2 — Master Script Generation

From `product_model.json`, Showrunner generates three tightly coupled artifacts that share a single timestamp spine.

**Artifact precedence:** If `manifest.json` already exists, Showrunner skips script generation and uses it directly. To regenerate, pass `--force script`. Human edits to `manifest.json` are preserved across runs unless explicitly overwritten.

#### 4.2.1 The Timestamp Manifest

The master timing document that all other scripts reference. Every segment has a structured `actions` array rather than a single inline action string, enabling multi-step sequences, waits, and assertions within a single segment.

```jsonc
// scripts/manifest.json
{
  "total_duration_seconds": 92,
  "generated_from": "product_model.json",
  "segments": [
    {
      "id": "intro",
      "label": "Introduction",
      "start": 0.0,
      "end": 8.5,
      "vo_line": "Every voice AI team needs to know their product works — Avocado makes testing autonomous.",
      "actions": [
        { "type": "idle" }
      ],
      "transition": "fade_in"
    },
    {
      "id": "navigate-tests",
      "label": "Navigate to Tests",
      "start": 8.5,
      "end": 14.0,
      "vo_line": "From the dashboard, navigate to the Tests tab.",
      "actions": [
        { "type": "wait_for", "selector": "[data-testid='nav-tests']" },
        { "type": "click", "selector": "[data-testid='nav-tests']" },
        { "type": "wait_for_url", "pattern": "**/tests" }
      ],
      "transition": "cut"
    },
    {
      "id": "create-test",
      "label": "Create a New Test",
      "start": 14.0,
      "end": 28.0,
      "vo_line": "Click New Test to begin configuring your first voice scenario.",
      "actions": [
        { "type": "click", "selector": "[data-testid='btn-new-test']" },
        { "type": "wait_for", "selector": "[data-testid='test-form']" },
        { "type": "fill", "selector": "[data-testid='input-test-name']", "value": "Onboarding Flow" },
        { "type": "fill", "selector": "[data-testid='input-prompt']", "value": "You are a helpful assistant..." },
        { "type": "click", "selector": "[data-testid='btn-save']" },
        { "type": "wait_for", "selector": "[data-testid='toast-success']" }
      ],
      "transition": "cut"
    }
  ]
}
```

**Supported action types:**

| Type | Required fields | Description |
|---|---|---|
| `idle` | — | No interaction; camera holds on current state |
| `click` | `selector` | Click an element |
| `fill` | `selector`, `value` | Clear and type into an input |
| `type` | `selector`, `value` | Type without clearing (appends) |
| `hover` | `selector` | Hover over an element |
| `scroll` | `selector`, `direction` | Scroll inside an element (`up`/`down`) |
| `navigate` | `url` | Full navigation to a URL |
| `wait_for` | `selector` | Wait until element is visible |
| `wait_for_url` | `pattern` | Wait until URL matches glob pattern |
| `wait` | `ms` | Explicit pause |
| `assert_visible` | `selector` | Assert element exists; fail segment if not |
| `custom` | `js` | Inline JavaScript executed in page context |

All downstream scripts are generated from this manifest. It is the single source of truth for timing.

#### 4.2.2 Selector Strategy

Showrunner uses a selector priority hierarchy when generating Playwright actions, from most to least resilient:

1. `data-testid` attributes (most stable — structural changes don't break them)
2. ARIA role + accessible name (`getByRole('button', { name: 'Save' })`)
3. Text content (`getByText('Save changes')`)
4. CSS selector (least stable — fallback only)

When generating selectors during comprehension, Showrunner instructs the LLM to prefer `data-testid` and role-based selectors. If the product codebase is available, Showrunner scans for existing `data-testid` attributes and uses them directly.

For products with no `data-testid` attributes, a `showrunner instrument` command (see CLI section) outputs a diff of suggested attribute additions to the codebase.

#### 4.2.3 The Playwright Script

Generated from the manifest. Each segment's `actions` array is translated into typed Playwright operations:

```typescript
// scripts/playwright_demo.ts — generated, do not edit directly
import { chromium } from 'playwright';
import manifest from './manifest.json';

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await context.newPage();

// Segment: navigate-tests (8.5s – 14.0s)
await page.waitForSelector("[data-testid='nav-tests']");
await page.click("[data-testid='nav-tests']");
await page.waitForURL('**/tests');
// ...
```

This file is regenerated from the manifest before each run. Do not edit it directly — edit the manifest instead.

#### 4.2.4 The Voiceover Script

A clean plain-text file for human review, extracted from manifest VO lines:

```
# Showrunner VO Script — Avocado Demo
# Total duration: 1:32
# Generated: 2025-05-20

[0:00] Every voice AI team needs to know their product works — Avocado makes testing autonomous.
[0:08] From the dashboard, navigate to the Tests tab.
[0:14] Click New Test to begin configuring your first voice scenario.
...
```

This file is the human review gate. Developers edit this before voiceover synthesis runs. Edits are written back into the manifest before synthesis proceeds.

**VO review gate flow:**

When `vo_review_gate: true` in config, the pipeline pauses after script generation:

1. Showrunner writes `scripts/vo_script.txt` and prints its path
2. The pipeline suspends and writes a `.showrunner-lock` file marking the pending gate
3. The developer edits the VO script externally
4. `showrunner approve-vo --config demo.yaml` reads the edited file, merges changes back into the manifest, removes the lock, and resumes the pipeline from the VO synthesis stage

In agent mode (`--no-interactive`), `vo_review_gate` is automatically treated as `false` regardless of config. A warning is emitted.

---

### 4.3 Stage 3a — Screen Recording

Showrunner connects to a running product instance and executes the Playwright script. It does not launch or manage the product process itself.

#### Connection Configuration

```yaml
recording:
  target_url: http://localhost:3000
  viewport:
    width: 1920
    height: 1080
  browser: chromium         # chromium | firefox | webkit
  headless: false
  output_dir: ./segments/video
  trace_dir: ./segments/traces      # Playwright trace files, one per segment
  cursor_highlight: true
  segment_buffer_ms: 200   # extra capture time per segment
  state:
    seed_script: ./scripts/seed_demo_data.sh     # run once before recording starts
    reset_script: ./scripts/reset_demo_data.sh   # run before each segment re-take
    teardown_script: ./scripts/teardown.sh       # run after all segments complete
```

#### Demo State Management

Reproducible recordings require reproducible state. Showrunner provides three lifecycle hooks for managing the demo environment:

- **`seed_script`** — runs once before the recording session begins. Use it to create demo users, seed records, and establish baseline state. Not run on individual segment re-takes.
- **`reset_script`** — runs before each segment re-take (not the initial run). Use it to undo mutations that previous takes may have introduced — for example, deleting a record created during a prior take. This ensures re-recording segment 3 doesn't break because segment 3 already ran once.
- **`teardown_script`** — runs after the full session completes, whether it succeeded or failed. Use it to clean up seeded data, close background processes, or reset the database to a clean state.

All three scripts receive the following environment variables: `SHOWRUNNER_RUN_ID`, `SHOWRUNNER_SEGMENT_ID` (reset only), `SHOWRUNNER_STATUS` (teardown only: `success` | `failure`).

If no state scripts are configured, Showrunner assumes the operator is managing demo state externally and proceeds without lifecycle management.

#### Recording Backend

Showrunner uses **Playwright's built-in `recordVideo` API** as the primary recording backend, capturing video at the configured viewport resolution. This avoids the OS-level display complexity (`xvfb`, `x11grab`) and works consistently inside the official Playwright Docker image.

**Architecture: single context, single video, slice in post.** The entire script runs inside one `BrowserContext` which records one continuous WebM file. Per-segment clips are produced afterwards by slicing the master recording at the manifest's segment boundaries during the FFmpeg mux stage. Per-segment Playwright traces are still captured via `tracing.startChunk()` / `tracing.stopChunk({ path })` around each segment's action sequence.

```typescript
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  recordVideo: {
    dir: './segments/video',                 // master WebM written here
    size: { width: 1920, height: 1080 }
  }
});

await context.tracing.start({ screenshots: true, snapshots: true, sources: true });

for (const segment of manifest.segments) {
  await context.tracing.startChunk({ title: segment.id });
  await runSegment(context, segment);          // emits SHOWRUNNER_SEG_START/END markers
  await context.tracing.stopChunk({ path: `./segments/traces/${segment.id}.zip` });
}

await context.close();                         // flushes the WebM
```

**Why this shape:**
- A fresh context per segment introduces a 100–300ms cold-start (page navigation, first paint) that shows up as a black or partially-rendered frame at the start of every clip.
- A fresh context per segment also loses auth cookies, `localStorage`, and any in-app state built up by prior segments — forcing the operator to either re-inject `storageState` per segment or design every segment to be state-independent. Neither is acceptable.
- One continuous recording avoids both problems and gives the mux stage a single, trustworthy source of truth for timestamps.

**Capture characteristics (verify against Playwright docs before implementing):**
- `recordVideo` outputs **WebM (VP8)**. Frame rate is not configurable and is approximately 25 fps, not a stable 30. WebM keyframes are sparse, so frame-accurate trimming requires a normalization pass.
- Cursor is not captured by `recordVideo` — see the cursor highlight section for the overlay approach Showrunner uses.
- The configured viewport size is also the recording size. There is no separate "record at lower resolution" knob.

**Normalization pass (mux prerequisite):** Before any slicing, concat, or `xfade` operation, the master WebM is re-encoded to H.264 MP4 at the configured output frame rate (default 30) with a fixed GOP (`-g 30`) and `yuv420p` pixel format. This is what makes segment boundaries frame-accurate and what makes `xfade` cross-segment transitions work at all — `xfade` requires identical fps, resolution, pixel format, and timebase across all inputs.

**Re-recording a single segment** (`showrunner rerun-segment`) is the one case where a fresh context is used: only the failing segment is re-run against a fresh context, the resulting WebM is sliced to the segment's bounds plus a `segment_buffer_ms` lead-in (default raised to 500 ms to absorb cold-start), and the slice replaces the corresponding region of the master recording during mux.

**Platform notes:**
- **Linux (deployment target):** Playwright requires a display server. The official Docker image bundles `xvfb-run` and launches Playwright inside it automatically. No operator configuration required.
- **WSL2 + WSLg (dev):** Headed Playwright works under WSLg on Ubuntu 24.04+. Install `fonts-liberation` + `fonts-noto-color-emoji` to match the Playwright Docker image and avoid "looks different in CI" surprises. Recommended dev pattern: `headless: false` for `record-actions` / `preview` / `trace` (you need to see a window); `headless: true` for `showrunner run` (faster, identical output).
- **macOS / Windows native:** not a supported deployment target. Showrunner runs in Docker or WSL.

#### Authentication

Showrunner supports three authentication strategies, resolved in priority order. If `setup_script` is defined, it always wins; the other two are fallbacks for common cases.

**Priority order:**
1. `setup_script` — full Playwright control (highest priority)
2. `session` — cookie/token injection
3. `form` — credential form fill
4. No auth config — assumes public access

---

**Strategy 1: Setup Script (Primary — maximum flexibility)**

A TypeScript file that receives the Playwright `page` object before recording begins. Use this for anything beyond a simple username/password form: OAuth, SSO, MFA, multi-step onboarding flows, or any auth pattern Showrunner doesn't natively understand.

```yaml
recording:
  auth:
    type: setup_script
    path: ./scripts/demo_login.ts
```

```typescript
// scripts/demo_login.ts
import type { Page } from 'playwright';

export default async function setup(page: Page): Promise<void> {
  await page.goto('/login');
  await page.fill('#email', process.env.DEMO_EMAIL!);
  await page.fill('#password', process.env.DEMO_PASSWORD!);
  await page.click('[type=submit]');
  await page.waitForURL('**/dashboard');
}
```

Credentials are always read from environment variables — never hardcoded in config or script files. The setup script runs once before the first segment and is not recorded.

---

**Strategy 2: Session Injection (Fast, stateless)**

For products that use cookies or `localStorage` tokens, Showrunner injects a pre-captured auth state directly into the browser context before any page loads. No login flow occurs on camera.

```yaml
recording:
  auth:
    type: session
    cookies_file: ./auth/session.json
    local_storage_file: ./auth/storage.json   # optional
```

Session files are captured once using `showrunner capture-auth` (see CLI section) and committed to the project. They will expire — agents should treat a `401` response during recording as a signal to re-run `capture-auth` and update the files.

Session file format follows the Playwright `BrowserContext.storageState()` schema, so sessions exported from Playwright test suites are directly compatible.

---

**Strategy 3: Form Fill (Low-friction, simple flows)**

For standard username/password forms, Showrunner handles auth natively with no script required.

```yaml
recording:
  auth:
    type: form
    login_url: /login
    fields:
      email:
        selector: '[data-testid="input-email"]'
        env: DEMO_EMAIL
      password:
        selector: '[data-testid="input-password"]'
        env: DEMO_PASSWORD
    submit_selector: '[type=submit]'
    success_url_pattern: '**/dashboard'
    timeout_ms: 5000
```

This strategy fails explicitly if the `success_url_pattern` is not matched within `timeout_ms` — it does not silently continue into a broken recording.

**Limitations:** Form fill does not support MFA, CAPTCHA, OAuth redirects, or any flow that requires more than two fields and a submit. Use Strategy 1 for those cases.

---

#### Auth Utilities: `showrunner capture-auth`

A one-time interactive command that opens a visible browser, waits for the user to log in manually, then exports the resulting session state to files compatible with Strategy 2.

```bash
showrunner capture-auth \
  --config demo.yaml \
  --output-cookies ./auth/session.json \
  --output-storage ./auth/storage.json
```

```
[showrunner] Opening browser at http://localhost:3000
[showrunner] Log in manually, then press Enter in this terminal to capture session...

> (user logs in via browser)

[showrunner] Session captured.
  Cookies: 3 saved → ./auth/session.json
  LocalStorage: 2 keys saved → ./auth/storage.json
[showrunner] Done. Commit these files or add to .gitignore if they contain sensitive tokens.
```

This command is intentionally human-only — it is not part of the automated pipeline. Agents should invoke it via a human-in-the-loop step during initial project setup, then use the exported files for all subsequent automated runs.

Auth files should be added to `.gitignore` if the product is public-facing or the session tokens are long-lived. For internal tooling, committing them is acceptable and simplifies agent access.

---

### 4.4 Playwright Live Toolset

Showrunner integrates Playwright's three native developer tools as first-class commands in the workflow. These are not wrappers — they invoke Playwright's own tooling directly, exposing them at the right moment in the pipeline rather than requiring the operator to know when and how to reach for them.

The three tools map to three distinct jobs:

| Tool | Job | When to use |
|---|---|---|
| **Codegen** | Author actions by demonstrating them | Before the first run, when the manifest doesn't exist yet |
| **UI Mode** | Preview and debug a generated script live | Before recording, to verify the script plays correctly |
| **Trace Viewer** | Post-mortem a failed or suspicious recording | After a run, to understand exactly what went wrong |

---

#### 4.4.1 Codegen — Record Actions by Demonstration (`showrunner record-actions`)

When you run Codegen, two windows open: a browser window displaying the target site, and the Playwright Inspector. The browser automatically highlights elements and shows you a locator in Playwright's preferred user-first selector format. As you interact with the site, the Inspector records every interaction in real time.

Showrunner exposes this as `showrunner record-actions`. Under the hood it is **not** a live event bridge — Playwright Codegen does not expose a structured event stream or a JSON output target; its `--target` flag emits language files only (`playwright-test`, `javascript`, `python`, etc.). The actual integration is a two-step pipeline:

1. **Capture step.** Showrunner spawns `playwright codegen --target=playwright-test --output=<tmp>.spec.ts` pre-pointed at the product's `target_url`, with auth session pre-injected via `--load-storage`. The developer demonstrates the flow in the browser; Codegen writes a standard `.spec.ts` file when the browser closes.
2. **Parse + translate step.** Showrunner parses the spec file with `@babel/parser` (TypeScript-aware), walks the AST for `page.<method>(...)` and `expect(...)` calls, and maps each to one of the 12 manifest action types in Section 4.2.1. Anything unrecognized is emitted as a `custom` action carrying the raw JS, with a warning so the developer can hand-translate it.

This is intentionally a parser, not a wrapper — it gives Showrunner a single, stable surface (the AST of a Playwright spec file) instead of depending on Codegen's private `Recorder` internals, which break across minor versions.

```bash
# Record actions for a new segment interactively
showrunner record-actions   --config demo.yaml   --segment create-test   --output scripts/manifest.json
```

```
[showrunner] Opening Codegen at http://localhost:3000
[showrunner] Perform the "Create a New Test" flow, then close the browser.
[showrunner] Auth session injected — you are already logged in.

> (developer performs the flow in the browser)

[showrunner] Codegen wrote /tmp/showrunner-codegen-3a9f.spec.ts (12 statements)
[showrunner] Parsed 11 known actions, 1 unrecognized → custom action with warning.
  Actions written → scripts/manifest.json
[showrunner] Review and adjust selectors in the manifest before running.
```

Codegen prioritizes role, text, and test ID locators — so the recorded selectors are already more resilient than raw CSS out of the box. You can also intervene via the Inspector to swap in more robust selectors or insert assertions before saving; whatever Codegen writes to the spec file is what Showrunner parses.

`record-actions` can also be run without a `--segment` flag to record an entire new flow from scratch, which Showrunner writes as a new manifest.

**Supported AST patterns (v0.1):** `page.goto`, `page.click`, `page.fill`, `page.type`, `page.press`, `page.hover`, `page.check`/`uncheck`, `page.selectOption`, `page.waitForSelector`, `page.waitForURL`, `page.waitForTimeout`, and `expect(locator).toBeVisible()`. Locators built via `page.getByRole`, `getByText`, `getByLabel`, `getByPlaceholder`, `getByTestId`, and raw CSS selectors all round-trip cleanly. Anything outside this set lands in `custom` and surfaces a warning.

---

#### 4.4.2 UI Mode — Preview and Debug Live (`showrunner preview`)

UI Mode provides a time-travel experience: you can see a full trace of your script and hover back and forward over each action to see what was happening during each step. You can also pop out the DOM snapshot of a given moment into a separate window.

`showrunner preview` runs the generated Playwright script inside UI Mode before any recording happens. This is the human review gate for the action sequence — the equivalent of the VO review gate but for the browser interactions.

```bash
# Preview the full script in Playwright UI Mode
showrunner preview --config demo.yaml

# Preview a single segment only
showrunner preview --config demo.yaml --segment navigate-tests
```

The UI Mode interface shows test execution in a dedicated window with the execution state, a timeline, locators, and a live browser preview. This allows pausing execution at any stage to check page elements for timing or selector issues.

From within the preview, the developer can:

- **Watch the full script play through** end-to-end against the live product, verifying that every action lands correctly before any video is recorded
- **Step through segment by segment** to isolate a specific interaction
- **Inspect DOM snapshots** for any step to see exactly what the page looked like at that moment
- **Identify flaky selectors** before they become a broken recording — UI Mode highlights when a selector matches multiple elements or takes unexpectedly long to resolve

When used with `vo_review_gate: true`, the recommended workflow is: generate script → `showrunner preview` → adjust manifest → `showrunner approve-vo` → record. The preview pass replaces the need to do full re-recordings when an action is wrong.

---

#### 4.4.3 Trace Viewer — Post-mortem a Recording (`showrunner trace`)

Showrunner captures a Playwright trace file for every recording run. If a segment fails or the final video looks wrong at a specific moment, `showrunner trace` opens the Trace Viewer for the relevant segment.

```bash
# Open the trace for a specific failed segment
showrunner trace --config demo.yaml --segment create-test

# Open traces for all segments from the last run
showrunner trace --config demo.yaml --all
```

The Trace Viewer is a GUI tool that lets you go back and forward through each action on the left side and visually see what was happening during the action. In the middle of the screen, you can see a DOM snapshot for the action. On the right side you can see action details — time, parameters, return value, and log. You can also explore console messages and network requests.

The Trace Viewer captures everything that happened during a recording — screenshots, logs, API calls, and UI state — and lets you replay it later like a film. This makes it possible to diagnose sync issues, missed clicks, or unexpected page states without re-running the entire pipeline.

Trace files are stored per-segment at `segments/traces/<segment-id>.zip` and are included in the build manifest for CI/CD traceability. They can be shared between team members or attached to bug reports without requiring a live product instance.

---

#### 4.4.4 Toolset Summary

```
Authoring flow (new demo):
  showrunner record-actions → manifest.json authored by demonstration

Pre-recording review:
  showrunner preview → verify actions play correctly before any video is captured

Post-recording diagnosis:
  showrunner trace → inspect exactly what happened in a failed or suspect segment
```

These three commands are available at all times — they are not gated behind pipeline stages and can be run independently of `showrunner run`.


---

### 4.5 Stage 3b — Voiceover Synthesis

Showrunner calls the ElevenLabs API to synthesize each VO line as a separate audio file, keyed to segment ID. The default endpoint is **`text-to-speech/{voice_id}/with-timestamps`**, which returns the audio plus per-character timing alignment in a single JSON response. This gives Showrunner exact audio duration (no `ffprobe` round-trip needed) and word-level timing data that future features (caption overlays, keyword-synced UI highlights) can build on.

```yaml
voiceover:
  provider: elevenlabs
  endpoint: with_timestamps             # with_timestamps (default) | basic
  voice_id: "21m00Tcm4TlvDq8ikWAM"      # ElevenLabs voice ID
  model: eleven_multilingual_v2
  stability: 0.55                       # practitioner-tested defaults below
  similarity_boost: 0.75
  style: 0.0
  use_speaker_boost: true
  speed: 1.0                            # 0.85 – 1.15 (clamped — see drift strategy)
  output_dir: ./segments/audio
  alignment_dir: ./segments/alignment   # per-segment word-timing JSON when using with_timestamps
  api_key_env: ELEVENLABS_API_KEY       # resolved from environment
  duration_drift_threshold_pct: 15
  drift_strategy: adjust_timing         # adjust_timing | resynthesize
  post_process:
    debreath: true                      # default-on; removes ElevenLabs MultilingualV2 inhales
  pause_placement:
    strategy: action_boundaries         # action_boundaries (default) | trailing
    min_silence_ms: 250                 # ignore action-boundary gaps shorter than this
    snap_window_ms: 1200                # ± window for snapping to natural TTS silence
```

Each VO file is named to match its segment: `intro.mp3`, `navigate-tests.mp3`, etc. When `endpoint: with_timestamps`, an `intro.alignment.json` sits next to each audio file with the character-level timing data — kept for future use, not consumed in v0.1.

After synthesis, Showrunner compares actual audio duration to the manifest's allocated segment duration. If drift exceeds the threshold (default: 15%), it applies the configured strategy:

- **`adjust_timing`** (default) — rewrite manifest timestamps to match actual audio duration. Downstream stages (mux, transitions) all read from the manifest, so the rewrite cascades correctly. Free, predictable, and produces clean audio every time.
- **`resynthesize`** — retry the synthesis with an adjusted `speed` parameter (clamped to `[0.85, 1.15]`), up to two attempts. If drift after two retries still exceeds threshold (typically because the line needs >20% speed change, which is outside ElevenLabs' supported range), automatically falls back to `adjust_timing` and emits a warning.

> **Removed in v0.3:** the `trim_pad` strategy. It produced audibly bad output — clipped final words or awkward trailing silence — and there is no scenario in which it's the right answer. Use `adjust_timing` instead.

**Note on `with_timestamps` response format:** the endpoint returns JSON of the form `{ audio_base64: string, alignment: { characters: string[], character_start_times_seconds: number[], character_end_times_seconds: number[] } }`. Audio duration is `max(character_end_times_seconds)`. The `basic` endpoint mode (raw audio bytes) is retained as a fallback for callers that prefer streaming or want to minimize response size, but it costs an extra `ffprobe` invocation per segment to determine duration.

#### Audio post-processing

ElevenLabs' MultilingualV2 voices include audible inhales between sentences that read as unprofessional in finished demo content. Showrunner applies a default cleanup filter chain to every synthesized clip:

```
silenceremove=start_periods=1:start_duration=0.08:start_threshold=-42dB,
highpass=f=60,
afade=t=in:st=0:d=0.02
```

This removes the leading inhale (most prominent in MultilingualV2 output), cuts sub-60Hz rumble that some voice IDs introduce, and adds a 20ms fade-in to eliminate the clip-start click. The filter runs as a single `ffmpeg -af` pass per clip; impact on synthesis latency is negligible.

Disable with `post_process.debreath: false` if a specific voice ID doesn't need it, or if you want to keep the raw ElevenLabs output for debugging.

#### Intra-segment pause placement

When a synthesized clip is shorter than its allocated segment duration — common after `adjust_timing`, or simply because the VO line is shorter than the visual flow — the remaining time becomes silence. *Where* that silence lands within the clip materially affects perceived quality. A 12-second clip with 3 seconds of trailing silence reads worse than the same clip with 1 second of silence around each of three internal action moments, even though the totals are identical.

Showrunner's default strategy (`action_boundaries`) places slack silence at positions corresponding to **action boundaries in the manifest**. A segment with `click → wait → fill → click` has three internal boundary moments; the slack gets distributed among them rather than dumped at clip end. The algorithm:

1. Compute total slack: `segment.duration - actual_VO_duration`.
2. Collect candidate insertion points from `segment.actions`: the timestamp of each action boundary, relative to segment start.
3. Run `silencedetect=noise=-32dB:d=0.12` on the TTS output to enumerate natural pause positions in the synthesized audio.
4. For each candidate, snap to the nearest natural pause within `pause_placement.snap_window_ms` (default ±1200 ms). Drop the candidate if no natural pause is in range — avoids mid-word silence inserts.
5. Distribute the slack proportionally across the snapped points and splice in `aevalsrc` silence at each via an `ffmpeg filter_complex` pass.

Why this matters: when silence lands at action boundaries, the audio falls quiet at the same moments the visual flow naturally pauses (between two clicks, while a page settles, after a form submits). When silence dumps at clip end, the VO finishes early and the viewer stares at a moving cursor in silence. Same total length; much better feel.

Set `pause_placement.strategy: trailing` to revert to "all silence at end" — useful when a segment's actions don't correspond to natural pause moments (e.g. a fast-paced sequence the operator wants narrated continuously).

---

### 4.6 Stage 4 — FFmpeg Mux & Edit

Showrunner constructs a final `ffmpeg` command chain from all segment assets.

```
segments/
  video/
    intro.webm
    navigate-tests.webm
    ...
  audio/
    intro.mp3
    navigate-tests.mp3
    ...
```

The mux pipeline:

1. **Per-segment composition**: Combine video clip + audio clip for each segment, applying timing from manifest. Add transition effects (fade, cut, dissolve) between segments.

2. **Concatenation**: Use FFmpeg's `concat` filter to stitch segments in order.

3. **Post-processing** (optional, config-driven):
   - Intro/outro card overlays (title card, logo)
   - Lower-third text overlays at specified timestamps
   - Background music track mixed at configurable level (-20dB default)
   - Output resolution normalization (1080p default)

4. **Output**: Single MP4 + build manifest JSON (see Section 4.6).

```yaml
output:
  format: mp4
  resolution: 1920x1080
  fps: 30
  codec_video: h264
  codec_audio: aac
  branding:
    title_card:
      enabled: true
      text: "Avocado — Voice AI Testing"
      duration_seconds: 2
      font: "./assets/fonts/Inter-SemiBold.ttf"
      font_size: 48
      text_color: "#FFFFFF"
      background_color: "#0F172A"
      logo: "./assets/logo.png"
      logo_position: top_center   # top_left | top_center | top_right
    outro_card:
      enabled: true
      text: "avocadovoice.io"
      duration_seconds: 2
  background_music:
    path: ./assets/bg_music.mp3
    volume_db: -22
  output_path: ./output/demo_final.mp4
```

---

### 4.7 Build Manifest (Output Artifact)

Every completed pipeline run produces a `build_manifest.json` alongside the MP4. This is the traceability artifact — it records exactly what inputs produced what output, enabling CI/CD systems to correlate a demo video to a specific commit, config, and product model.

```jsonc
// output/build_manifest.json
{
  "run_id": "sr-20250520-a3f9c",
  "generated_at": "2025-05-20T10:47:33Z",
  "output_file": "demo_final.mp4",
  "duration_seconds": 92,
  "git": {
    "commit": "a3f9c82",
    "branch": "main",
    "tag": "v1.2.0"
  },
  "inputs": {
    "config": "demo.yaml",
    "product_model": "product_model.json",
    "manifest": "scripts/manifest.json",
    "product_model_confidence": "high"
  },
  "stages": {
    "comprehension": { "skipped": true, "reason": "product_model.json already present" },
    "script": { "skipped": false, "duration_ms": 4200 },
    "record": { "skipped": false, "duration_ms": 97400, "segments": 8 },
    "voiceover": { "skipped": false, "duration_ms": 12100, "characters_synthesized": 842 },
    "mux": { "skipped": false, "duration_ms": 6800 }
  },
  "voiceover": {
    "provider": "elevenlabs",
    "voice_id": "21m00Tcm4TlvDq8ikWAM",
    "model": "eleven_multilingual_v2",
    "characters_synthesized": 842
  },
  "warnings": []
}
```

The `characters_synthesized` field enables operators to track ElevenLabs API costs across runs. Git fields are populated automatically if Showrunner is run inside a git repository; they are omitted otherwise.

---

## 5. Cost Estimation

Showrunner makes API calls to Anthropic (comprehension + script generation) and ElevenLabs (voiceover synthesis). Both incur real costs. A `--estimate` flag runs a dry pass and prints a cost forecast before any API calls are made.

```bash
showrunner run --config demo.yaml --estimate
```

```
[showrunner] Cost estimate for avocado-demo-v1.2
─────────────────────────────────────────────────
Comprehension (Anthropic claude-sonnet-4-20250514)
  Input tokens:  ~42,000   → ~$0.13
  Output tokens: ~1,200    → ~$0.02

Script generation (Anthropic claude-sonnet-4-20250514)
  Input tokens:  ~3,000    → ~$0.01
  Output tokens: ~2,000    → ~$0.01

Voiceover (ElevenLabs eleven_multilingual_v2)
  Estimated characters: ~820  → ~$0.02

─────────────────────────────────────────────────
Estimated total: ~$0.19
Note: Comprehension will be skipped (product_model.json exists). Actual cost: ~$0.03
─────────────────────────────────────────────────
Proceed? [y/N]
```

In agent mode (`--no-interactive`), `--estimate` prints the forecast to stdout as JSON and proceeds without prompting. Operators can parse this in CI to gate expensive runs.

---

## 6. Project Scaffold (`showrunner init`)

`showrunner init` generates a complete project structure for a new demo. It asks a small number of questions (or accepts flags in agent mode) and writes a ready-to-edit config.

```bash
showrunner init --name "avocado-demo" --url "http://localhost:3000"
```

Generated structure:

```
avocado-demo/
├── demo.yaml                  # main config — edit this
├── .env.example               # required env vars with placeholders
├── .gitignore                 # pre-configured for auth files and segment cache
├── auth/
│   └── .gitkeep
├── assets/
│   ├── fonts/
│   │   └── .gitkeep           # drop custom fonts here
│   └── bg_music.mp3           # royalty-free placeholder track
├── docs/
│   └── .gitkeep               # drop PRD, README, OpenAPI here
├── scripts/
│   ├── seed_demo_data.sh      # stub with comments
│   ├── reset_demo_data.sh     # stub with comments
│   └── teardown.sh            # stub with comments
├── segments/
│   ├── audio/
│   └── video/
└── output/
```

The `.env.example` is pre-populated with every variable Showrunner needs:

```
ANTHROPIC_API_KEY=
ELEVENLABS_API_KEY=
DEMO_EMAIL=
DEMO_PASSWORD=
```

---

## 7. Configuration Reference

All stages are driven by a single `demo.yaml` config file. An agent can generate this file from the product model; a human can author it manually.

```yaml
# demo.yaml — complete example

project:
  name: avocado-demo-v1.2
  product_model: ./product_model.json   # skip comprehension if present

comprehension:
  mode: documents
  sources:
    - type: prd
      path: ./docs/PRD.md
    - type: codebase
      path: ./src

script:
  style: "matter-of-fact"       # tone hint for LLM script generation
  duration_target_seconds: 90
  highlight_features:
    - "Create a voice test"
    - "Review transcripts"
  vo_review_gate: true          # pause for human VO review before synthesis

recording:
  target_url: http://localhost:3000
  viewport: { width: 1920, height: 1080 }
  browser: chromium
  headless: false
  output_dir: ./segments/video
  state:
    seed_script: ./scripts/seed_demo_data.sh
    reset_script: ./scripts/reset_demo_data.sh
    teardown_script: ./scripts/teardown.sh
  auth:
    type: session
    cookies_file: ./auth/session.json
    local_storage_file: ./auth/storage.json

voiceover:
  provider: elevenlabs
  voice_id: "21m00Tcm4TlvDq8ikWAM"
  model: eleven_multilingual_v2
  stability: 0.5
  similarity_boost: 0.75
  output_dir: ./segments/audio
  api_key_env: ELEVENLABS_API_KEY
  duration_drift_threshold_pct: 15
  drift_strategy: adjust_timing   # trim_pad | adjust_timing | resynthesize

output:
  format: mp4
  resolution: 1920x1080
  fps: 30
  branding:
    title_card:
      enabled: true
      text: "Avocado — Voice AI Testing"
      duration_seconds: 2
      font: "./assets/fonts/Inter-SemiBold.ttf"
      font_size: 48
      text_color: "#FFFFFF"
      background_color: "#0F172A"
      logo: "./assets/logo.png"
      logo_position: top_center
  background_music:
    path: ./assets/bg_music.mp3
    volume_db: -22
  output_path: ./output/demo_final.mp4
```

---

## 8. CLI Interface

```bash
# Full pipeline run
showrunner run --config demo.yaml

# Run specific stages only
showrunner run --config demo.yaml --stages comprehension,script
showrunner run --config demo.yaml --stages record,vo,mux

# Force-regenerate specific stages (ignores existing artifacts)
showrunner run --config demo.yaml --force script,vo

# Estimate API costs before running
showrunner run --config demo.yaml --estimate

# Scaffold a new project
showrunner init --name "my-demo" --url "http://localhost:3000"

# Interactive comprehension mode
showrunner understand --interactive --output product_model.json

# Suggest data-testid attributes for a codebase
showrunner instrument --config demo.yaml --output ./patches/testids.diff

# Re-run a single segment (runs reset_script before recording)
showrunner rerun-segment --config demo.yaml --segment navigate-tests

# Validate config before running
showrunner validate --config demo.yaml

# Dry run: generate scripts without recording or synthesizing
showrunner run --config demo.yaml --dry-run

# Print generated VO script for review
showrunner print-vo --config demo.yaml

# Capture auth session interactively (human-only, run once)
showrunner capture-auth \
  --config demo.yaml \
  --output-cookies ./auth/session.json \
  --output-storage ./auth/storage.json

# Approve VO script and resume pipeline (used when vo_review_gate: true)
showrunner approve-vo --config demo.yaml

# Resume a failed run from the last successful stage
showrunner run --config demo.yaml --resume
```

All commands emit structured JSON logs to stdout when `--json` flag is set, for agent consumption:

```json
{ "stage": "voiceover", "segment": "intro", "status": "complete", "audio_path": "./segments/audio/intro.mp3", "duration_ms": 8200 }
```

Exit codes follow Unix conventions: `0` = success, `1` = stage failure, `2` = config error.

---

## 9. Infrastructure & Deployment

### 9.1 Dependencies

| Dependency | Purpose | Required |
|---|---|---|
| Node.js ≥ 18 | Runtime | Yes |
| Playwright | Browser automation + recording | Yes |
| FFmpeg ≥ 6.0 | Video mux and editing | Yes |
| ElevenLabs API key | Voiceover synthesis | Yes (VO stage) |
| Anthropic API key | Comprehension + script generation | Yes (comp/script stages) |
| xvfb | Virtual display on Linux/CI | Auto-managed in Docker |

### 9.2 Installation

```bash
npm install -g showrunner
playwright install chromium
# FFmpeg must be available on PATH
showrunner init
```

### 9.3 Environment Variables

```
ANTHROPIC_API_KEY=
ELEVENLABS_API_KEY=
SHOWRUNNER_LOG_LEVEL=info    # debug | info | warn | error
DEMO_EMAIL=                  # used by form/setup_script auth strategies
DEMO_PASSWORD=
```

### 9.4 Agent Deployment

Showrunner is designed to be invocable by an agent (e.g. Claude Code) with zero interactive prompts when `vo_review_gate: false` is set in config. A typical agent invocation:

```bash
# Triggered by CI on release tag
showrunner run \
  --config demo.yaml \
  --no-interactive \
  --json \
  --output-path ./artifacts/demo-$RELEASE_TAG.mp4
```

Agents can also drive Showrunner programmatically via its Node.js API:

```typescript
import { Showrunner } from 'showrunner';

const sr = new Showrunner({ config: './demo.yaml' });
const result = await sr.run({ stages: ['all'] });
console.log(result.outputPath);      // ./output/demo_final.mp4
console.log(result.buildManifest);   // full build_manifest.json object
```

### 9.5 Docker Image

An official Docker image is provided for CI/CD use. It bundles Node.js, Playwright (with Chromium), FFmpeg, and xvfb — no additional setup required on the host.

```dockerfile
FROM showrunner/runner:latest

COPY demo.yaml .
COPY docs/ ./docs/
COPY src/ ./src/
COPY assets/ ./assets/
COPY auth/ ./auth/

CMD ["showrunner", "run", "--config", "demo.yaml", "--no-interactive", "--json"]
```

Runtime environment variables required: `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`, and any auth credentials used by the configured auth strategy.

---

## 10. Error Handling & Recovery

| Failure Mode | Behavior |
|---|---|
| Playwright selector not found | Log warning with selector + segment ID; skip action; flag segment for review |
| `assert_visible` fails | Halt segment immediately; emit error; mark segment as failed |
| ElevenLabs API error | Retry up to 3× with exponential backoff; fail stage on exhaustion |
| Auth failure (401 during recording) | Halt with actionable message: "Session may have expired — run `showrunner capture-auth`" |
| Audio/video duration drift > threshold | Apply configured drift strategy; log warning with before/after durations |
| FFmpeg mux failure | Emit segment-level error with full FFmpeg stderr; halt |
| LLM comprehension returns low-confidence model | Flag with `"confidence": "low"`; continue with warning; recommend interactive review |
| Target URL unreachable | Fail fast before recording starts; emit actionable error |
| `seed_script` / `reset_script` non-zero exit | Halt before recording; emit script stderr |

All stage outputs are checkpointed. A failed run can be resumed from the last successful stage:

```bash
showrunner run --config demo.yaml --resume
```

---

## 11. Open Questions

1. **Multi-window / multi-tab flows**: Playwright can handle these, but the timestamp manifest schema needs to account for tab switches and multiple page contexts. Deferred to v0.2.

2. **Cursor injection reliability**: Some applications intercept pointer events in ways that break Playwright's injected cursor overlay. A fallback to OS-level cursor recording may be needed on specific platforms.

3. **LLM provider abstraction**: Comprehension and script generation are currently Anthropic-only. A provider interface should be defined early so alternatives (OpenAI, Gemini, local models) can be swapped without breaking the pipeline.

---

## 12. Success Metrics

**Quality floor for "watchable":**
- Audio/video sync drift under 200ms across all segments
- No visible selector failures (skipped clicks, missed navigations) in the final video
- VO audio has no clipping, silence gaps over 500ms, or synthesis artifacts
- Output MP4 plays without errors in Chrome, Safari, and VLC

**Operational targets:**
- A developer can run `showrunner run` on a project with a PRD and codebase and receive a passing-quality demo MP4 with zero manual edits
- A CI/CD agent can trigger a full pipeline run and receive a binary success/failure signal via exit code
- Segment re-recording after a UI change completes in under 3 minutes end-to-end
- A full pipeline run on a 90-second demo costs under $0.50 in API fees
