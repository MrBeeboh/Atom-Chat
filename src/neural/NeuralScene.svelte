<script>
  /**
   * Neural Observatory v1 — Svelte container.
   * Mounts neuralEngine canvas; subscribes only to themeMetrics. No chat/message imports.
   * On WebGL failure shows fallback static gradient. Full dispose on unmount.
   */
  import { themeMetrics } from '$lib/stores.js';
  import { createNeuralEngine } from './neuralEngine.js';

  let containerEl = $state(/** @type {HTMLElement | null} */ (null));
  let failed = $state(false);
  let engine = null;
  let unsubMetrics = null;

  $effect(() => {
    const el = containerEl;
    if (!el) return;
    engine = createNeuralEngine(el, () => {
      failed = true;
    });
    engine.start();
    unsubMetrics = themeMetrics.subscribe((m) => {
      if (engine) engine.updateMetrics({ isStreaming: m.isStreaming, liveChunksPerSec: m.liveChunksPerSec });
    });
    return () => {
      if (unsubMetrics) {
        unsubMetrics();
        unsubMetrics = null;
      }
      if (engine) {
        engine.stop();
        engine = null;
      }
    };
  });
</script>

{#if failed}
  <div
    class="neural-fallback"
    role="img"
    aria-label="Neural background unavailable"
    style="
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      z-index: 0;
      background: linear-gradient(135deg, #0a0a12 0%, #0d1b2a 40%, #1b263b 70%, #0a0a12 100%);
      pointer-events: none;
    "
  ></div>
{:else}
  <div
    class="neural-scene"
    style="position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 0; pointer-events: none;"
    bind:this={containerEl}
  ></div>
{/if}
