<script lang="ts">
  let { src }: { src: string } = $props();

  // Decorative fixed "waveform" bars — purely visual texture, not analysis.
  const bars = Array.from({ length: 48 }, (_, i) => 22 + Math.abs(Math.sin(i * 1.7) * 64) + (i % 5) * 4);
</script>

<section class="panel player">
  <header class="bar">
    <span class="eyebrow">Master take</span>
    <span class="led ok"></span>
  </header>

  <div class="wave">
    {#each bars as h}
      <span class="bar-tick" style="height: {Math.min(h, 92)}%"></span>
    {/each}
  </div>

  <audio class="audio" controls src={src}></audio>
</section>

<style>
  .player { padding: var(--pad); display: flex; flex-direction: column; gap: 14px; }
  .bar { display: flex; justify-content: space-between; align-items: center; }

  .wave {
    display: flex;
    align-items: center;
    gap: 3px;
    height: 84px;
    padding: 0 4px;
    background: var(--bg-inset);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    box-shadow: inset 0 2px 6px rgba(0, 0, 0, 0.4);
  }
  .bar-tick {
    flex: 1;
    background: linear-gradient(180deg, var(--amber), rgba(245, 166, 35, 0.35));
    border-radius: 1px;
    opacity: 0.75;
  }

  .audio { width: 100%; height: 38px; filter: saturate(0.6) brightness(0.95); }
</style>
