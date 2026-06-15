<script lang="ts">
  import ScriptBox from '../components/ScriptBox.svelte';
  import AudioPlayer from '../components/AudioPlayer.svelte';
  import DiagnosticsPanel from '../components/DiagnosticsPanel.svelte';
  import { synthesize, type SynthesizePayload, type SynthesizeResponse } from '../lib/api';

  let loading = $state(false);
  let error = $state<string | null>(null);
  let result = $state<SynthesizeResponse | null>(null);

  async function run(payload: SynthesizePayload) {
    loading = true;
    error = null;
    try {
      result = await synthesize(payload);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      result = null;
    } finally {
      loading = false;
    }
  }
</script>

<div class="screen">
  <header class="head">
    <div>
      <div class="eyebrow">Voice · VO engine testbench</div>
      <h1>Cast a take</h1>
    </div>
    <p class="hint">
      Type a script and synthesize it through the real <code>voiceover</code> stage — normalization,
      freeze cache, QA gate, and MOS run exactly as the pipeline does.
    </p>
  </header>

  <div class="grid">
    <div class="col">
      <ScriptBox onsubmit={run} {loading} />
      {#if error}
        <div class="panel error"><span class="led fault"></span> {error}</div>
      {/if}
    </div>

    <div class="col">
      {#if result}
        <AudioPlayer src={result.audioUrl} />
        <DiagnosticsPanel summary={result.summary} />
      {:else}
        <div class="panel idle">
          <span class="eyebrow">Output</span>
          <p>No take yet. Hit <strong>SYNTHESIZE</strong> to cast one.</p>
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .screen { max-width: 1080px; margin: 0 auto; }
  .head { display: flex; justify-content: space-between; align-items: flex-end; gap: 32px; margin-bottom: 26px; }
  .head h1 { font-size: 30px; font-weight: 700; margin-top: 6px; }
  .hint { max-width: 360px; color: var(--ink-dim); font-size: 12.5px; margin: 0; text-align: right; }
  .hint code { color: var(--amber); }

  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; align-items: start; }
  .col { display: flex; flex-direction: column; gap: 16px; }

  .error { padding: 14px 16px; display: flex; align-items: center; gap: 10px; color: var(--red); border-color: rgba(255, 82, 82, 0.4); }

  .idle { padding: 26px var(--pad); color: var(--ink-faint); display: flex; flex-direction: column; gap: 8px; }
  .idle strong { color: var(--amber); }

  @media (max-width: 900px) { .grid { grid-template-columns: 1fr; } .hint { text-align: left; } }
</style>
