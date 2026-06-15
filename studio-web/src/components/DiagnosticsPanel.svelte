<script lang="ts">
  import type { VoiceoverSummary } from '../lib/api';

  let { summary }: { summary: VoiceoverSummary } = $props();

  const n = $derived(summary.normalization);
  const g = $derived(summary.gate);
  const nat = $derived(summary.naturalness);
  const phon = $derived(Object.entries(summary.phonemes ?? {}));
  const mosPct = $derived(nat.score != null ? Math.max(0, Math.min(100, (nat.score / 5) * 100)) : 0);
</script>

<section class="panel diag">
  <header class="bar"><span class="eyebrow">Diagnostics</span></header>

  <!-- Normalization -->
  <div class="row">
    <span class="led" class:on={n.substitutions > 0}></span>
    <span class="rlabel">Normalization</span>
    <span class="rval">{n.enabled ? `${n.substitutions} subs` : 'off'}</span>
  </div>
  {#if n.diffs.length}
    <ul class="diffs">
      {#each n.diffs as d}
        <li><span class="from">{d.from}</span><span class="arrow">→</span><span class="to">{d.to}</span><span class="rule">{d.rule}</span></li>
      {/each}
    </ul>
  {/if}

  <!-- Phonemized (G2P → IPA) -->
  {#if phon.length}
    <div class="row">
      <span class="led on"></span>
      <span class="rlabel">Phonemized</span>
      <span class="rval">{phon.length}</span>
    </div>
    <ul class="diffs">
      {#each phon as [token, ipa]}
        <li><span class="to">{token}</span><span class="arrow">→</span><span class="to">/{ipa}/</span><span class="rule">g2p</span></li>
      {/each}
    </ul>
  {/if}

  <!-- Freeze -->
  <div class="row">
    <span class="led" class:ok={summary.freeze.reused} class:on={!summary.freeze.reused}></span>
    <span class="rlabel">Freeze</span>
    <span class="rval" class:good={summary.freeze.reused}>
      {summary.freeze.reused ? 'HIT · reused' : 'MISS · synthesized'}
    </span>
  </div>

  <!-- Gate -->
  <div class="row">
    <span class="led" class:ok={g.ok} class:fault={!g.ok}></span>
    <span class="rlabel">QA gate</span>
    <span class="rval" class:good={g.ok} class:bad={!g.ok}>{g.ok ? '✓ passed' : '⚠ flagged'}</span>
  </div>
  {#if !g.ok && g.issues.length}
    <ul class="issues">
      {#each g.issues as issue}<li>{issue}</li>{/each}
    </ul>
  {/if}

  <!-- Naturalness -->
  <div class="row">
    <span class="led" class:on={nat.available && !nat.belowFloor} class:fault={nat.belowFloor}></span>
    <span class="rlabel">Naturalness</span>
    <span class="rval" class:bad={nat.belowFloor}>
      {#if !nat.available}not scored{:else}MOS {nat.score?.toFixed(2)}{#if nat.belowFloor} · below {nat.floor}{/if}{/if}
    </span>
  </div>
  {#if nat.available}
    <div class="meter"><span class="meter-fill" class:bad={nat.belowFloor} style="width: {mosPct}%"></span></div>
  {/if}
</section>

<style>
  .diag { padding: var(--pad); display: flex; flex-direction: column; gap: 10px; }
  .bar { margin-bottom: 2px; }

  .row { display: flex; align-items: center; gap: 11px; padding: 6px 0; border-bottom: 1px dashed var(--line); }
  .rlabel { font-family: var(--font-display); font-size: 13px; letter-spacing: 0.04em; color: var(--ink-dim); flex: 1; }
  .rval { font-size: 13px; color: var(--ink); }
  .rval.good { color: var(--green); }
  .rval.bad { color: var(--red); }

  .diffs, .issues { list-style: none; margin: 0 0 4px; padding: 4px 0 8px 20px; display: flex; flex-direction: column; gap: 4px; }
  .diffs li { display: flex; align-items: center; gap: 8px; font-size: 12px; }
  .from { color: var(--ink-faint); text-decoration: line-through; }
  .arrow { color: var(--amber); }
  .to { color: var(--ink); }
  .rule { margin-left: auto; color: var(--ink-faint); font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; }
  .issues li { color: var(--red); font-size: 12px; }

  .meter { height: 8px; background: var(--bg-inset); border: 1px solid var(--line); border-radius: 4px; overflow: hidden; }
  .meter-fill { display: block; height: 100%; background: linear-gradient(90deg, var(--green), var(--amber)); box-shadow: 0 0 10px var(--green-glow); }
  .meter-fill.bad { background: var(--red); box-shadow: 0 0 10px var(--red-glow); }
</style>
