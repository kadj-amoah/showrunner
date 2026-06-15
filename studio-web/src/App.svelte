<script lang="ts">
  import Voice from './screens/Voice.svelte';

  const screens = [
    { id: 'voice', label: 'Voice', live: true },
    { id: 'understand', label: 'Understand', live: false },
    { id: 'manifest', label: 'Manifest', live: false },
    { id: 'run', label: 'Run', live: false },
    { id: 'approve', label: 'Approve', live: false },
    { id: 'output', label: 'Output', live: false },
    { id: 'trace', label: 'Trace', live: false },
    { id: 'billing', label: 'Billing', live: false },
  ];

  let active = $state('voice');
</script>

<div class="studio">
  <aside class="rail">
    <div class="brand">
      <div class="brand-mark">▌▌</div>
      <div>
        <div class="brand-name">SHOWRUNNER</div>
        <div class="brand-sub">STUDIO</div>
      </div>
    </div>

    <nav>
      <div class="eyebrow nav-head">Bench</div>
      {#each screens as s}
        <button
          class="nav-item"
          class:active={active === s.id}
          disabled={!s.live}
          onclick={() => s.live && (active = s.id)}
        >
          <span class="led" class:on={active === s.id && s.live}></span>
          <span class="nav-label">{s.label}</span>
          {#if !s.live}<span class="soon">SOON</span>{/if}
        </button>
      {/each}
    </nav>

    <div class="rail-foot">
      <span class="eyebrow">Engine</span>
      <span class="rail-foot-val">voiceover · v1</span>
    </div>
  </aside>

  <main class="stage">
    {#if active === 'voice'}
      <Voice />
    {/if}
  </main>
</div>

<style>
  .studio {
    display: grid;
    grid-template-columns: 232px 1fr;
    height: 100%;
  }

  .rail {
    border-right: 1px solid var(--line);
    background: linear-gradient(180deg, #101316, #0c0e10);
    display: flex;
    flex-direction: column;
    padding: 20px 14px;
    gap: 22px;
  }

  .brand { display: flex; align-items: center; gap: 12px; padding: 0 6px; }
  .brand-mark {
    font-family: var(--font-display);
    color: var(--amber);
    font-size: 22px;
    line-height: 1;
    letter-spacing: -2px;
    text-shadow: 0 0 12px var(--amber-glow);
  }
  .brand-name { font-family: var(--font-display); font-weight: 700; font-size: 15px; letter-spacing: 0.12em; }
  .brand-sub { font-family: var(--font-display); font-weight: 500; font-size: 11px; letter-spacing: 0.42em; color: var(--ink-faint); }

  nav { display: flex; flex-direction: column; gap: 2px; }
  .nav-head { padding: 0 8px 8px; }

  .nav-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius);
    color: var(--ink-dim);
    padding: 9px 8px;
    font-size: 13px;
    font-weight: 500;
    letter-spacing: 0.04em;
    text-align: left;
    transition: background 0.12s, color 0.12s, border-color 0.12s;
  }
  .nav-item:not(:disabled):hover { background: rgba(255, 255, 255, 0.03); color: var(--ink); }
  .nav-item.active {
    background: rgba(245, 166, 35, 0.08);
    border-color: rgba(245, 166, 35, 0.25);
    color: var(--ink);
  }
  .nav-label { flex: 1; }
  .soon {
    font-family: var(--font-display);
    font-size: 9px;
    letter-spacing: 0.18em;
    color: var(--ink-faint);
    border: 1px solid var(--line);
    padding: 1px 5px;
    border-radius: 2px;
  }

  .rail-foot {
    margin-top: auto;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 12px 8px 0;
    border-top: 1px solid var(--line);
  }
  .rail-foot-val { color: var(--ink-dim); font-size: 12px; }

  .stage { overflow-y: auto; padding: 32px 40px 56px; }
</style>
