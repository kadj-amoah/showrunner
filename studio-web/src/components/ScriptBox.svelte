<script lang="ts">
  import type { SynthesizePayload } from '../lib/api';

  let { onsubmit, loading = false }: { onsubmit: (p: SynthesizePayload) => void; loading?: boolean } = $props();

  let script = $state('Press Ctrl+Z to undo.\n\nThe plan starts at $0/month — no card required.');
  let voiceId = $state('');
  let model = $state<'eleven_multilingual_v2' | 'eleven_v3'>('eleven_multilingual_v2');
  let normalize = $state(true);
  let gatePolicy = $state<'warn' | 'fail'>('warn');
  let naturalness = $state(false);

  const charCount = $derived(script.length);
  const canRun = $derived(script.trim().length > 0 && voiceId.trim().length > 0 && !loading);

  function run() {
    if (!canRun) return;
    onsubmit({ script, voiceId: voiceId.trim(), model, normalize, gatePolicy, naturalness });
  }
</script>

<section class="panel console">
  <header class="bar">
    <span class="eyebrow">Script</span>
    <span class="count">{charCount} ch</span>
  </header>

  <textarea
    class="script"
    bind:value={script}
    spellcheck="false"
    placeholder="Type the voiceover script. Blank lines split it into segments."
  ></textarea>

  <div class="rack">
    <label class="field voice">
      <span class="eyebrow">Voice ID</span>
      <input class="text" bind:value={voiceId} placeholder="elevenlabs voice id" spellcheck="false" />
    </label>

    <label class="field">
      <span class="eyebrow">Model</span>
      <select class="text" bind:value={model}>
        <option value="eleven_multilingual_v2">multilingual v2</option>
        <option value="eleven_v3">eleven v3</option>
      </select>
    </label>

    <div class="field">
      <span class="eyebrow">Switches</span>
      <div class="switches">
        <button class="sw" class:on={normalize} onclick={() => (normalize = !normalize)}>
          <span class="led" class:on={normalize}></span> NORMALIZE
        </button>
        <button class="sw" class:on={gatePolicy === 'fail'} onclick={() => (gatePolicy = gatePolicy === 'fail' ? 'warn' : 'fail')}>
          <span class="led" class:fault={gatePolicy === 'fail'} class:on={gatePolicy !== 'fail'}></span>
          GATE: {gatePolicy.toUpperCase()}
        </button>
        <button class="sw" class:on={naturalness} onclick={() => (naturalness = !naturalness)}>
          <span class="led" class:on={naturalness}></span> MOS
        </button>
      </div>
    </div>
  </div>

  <button class="transport" disabled={!canRun} onclick={run}>
    <span class="tri"></span>
    {loading ? 'SYNTHESIZING…' : 'SYNTHESIZE'}
  </button>
</section>

<style>
  .console { padding: var(--pad); display: flex; flex-direction: column; gap: 14px; }
  .bar { display: flex; justify-content: space-between; align-items: baseline; }
  .count { color: var(--ink-faint); font-size: 11px; }

  .script {
    width: 100%;
    min-height: 150px;
    resize: vertical;
    background: var(--bg-inset);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    color: var(--ink);
    padding: 14px;
    font-size: 14px;
    line-height: 1.6;
    box-shadow: inset 0 2px 6px rgba(0, 0, 0, 0.4);
  }
  .script::placeholder { color: var(--ink-faint); }

  .rack { display: grid; grid-template-columns: 1.4fr 1fr 2fr; gap: 14px; }
  .field { display: flex; flex-direction: column; gap: 6px; }
  .text {
    background: var(--bg-inset);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    color: var(--ink);
    padding: 9px 10px;
    font-size: 13px;
  }
  .text::placeholder { color: var(--ink-faint); }

  .switches { display: flex; gap: 8px; flex-wrap: wrap; }
  .sw {
    display: flex;
    align-items: center;
    gap: 7px;
    background: var(--bg-inset);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    color: var(--ink-dim);
    padding: 8px 10px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.08em;
    transition: border-color 0.12s, color 0.12s;
  }
  .sw.on { color: var(--ink); border-color: var(--line-bright); }

  .transport {
    margin-top: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    width: 100%;
    background: linear-gradient(180deg, #2a2113, #1b1610);
    border: 1px solid rgba(245, 166, 35, 0.5);
    border-radius: var(--radius);
    color: var(--amber);
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 0.18em;
    padding: 14px;
    text-shadow: 0 0 10px var(--amber-glow);
    transition: background 0.14s, box-shadow 0.14s;
  }
  .transport:not(:disabled):hover {
    background: linear-gradient(180deg, #34280f, #221a0e);
    box-shadow: 0 0 22px var(--amber-glow), inset 0 1px 0 rgba(255, 255, 255, 0.06);
  }
  .tri {
    width: 0; height: 0;
    border-left: 11px solid var(--amber);
    border-top: 7px solid transparent;
    border-bottom: 7px solid transparent;
    filter: drop-shadow(0 0 6px var(--amber-glow));
  }
</style>
