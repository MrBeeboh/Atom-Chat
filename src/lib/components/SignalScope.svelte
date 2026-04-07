<script>
  import { onMount } from 'svelte';
  import { models, selectedModelId, isStreaming } from '$lib/stores.js';
  import { parseSizeFromName } from '$lib/utils/modelSelection.js';
  import { modelDisplayName } from '$lib/api.js';
  /**
   * Signal Room: radar PPI — one dot shown (active model only), at that model's unique position on the scope.
   */
  const STORAGE_KEY = 'signal-scope-position';
  const DEFAULT_LEFT = 16;
  const DEFAULT_TOP = 64;
  const SWEEP_PERIOD_MS = 3500;
  const BLIP_FADE_DEG = 260;
  /** R1=inner (small models), R4=outer (large). Rings at 8, 18, 28, 38. Fixed scale by param size (B). */
  const RADIUS_MIN = 9;
  const RADIUS_MAX = 38;
  /** Max param size (B) that maps to R4; 21B is your largest so 20B+ → R4. */
  const SIZE_R4_B = 20;

  let left = $state(DEFAULT_LEFT);
  let top = $state(DEFAULT_TOP);
  let dragging = $state(false);
  let dragStart = $state({ x: 0, y: 0, left: 0, top: 0 });
  let sweepAngle = $state(0);
  let startTime = $state(0);

  onMount(() => {
    try {
      const s = localStorage.getItem(STORAGE_KEY);
      if (s) {
        const p = JSON.parse(s);
        if (typeof p?.left === 'number' && typeof p?.top === 'number') {
          left = p.left;
          top = p.top;
        }
      }
    } catch (_) {}
    startTime = performance.now();
    let raf;
    function tick() {
      sweepAngle = (360 - ((performance.now() - startTime) / SWEEP_PERIOD_MS) * 360 % 360) % 360;
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  });

  function savePosition() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ left, top }));
    } catch (_) {}
  }

  function startDrag(e) {
    if (e.cancelable) e.preventDefault();
    const x = e.clientX ?? e.touches?.[0]?.clientX;
    const y = e.clientY ?? e.touches?.[0]?.clientY;
    if (x == null || y == null) return;
    dragging = true;
    dragStart = { x, y, left, top };
  }

  function moveDrag(e) {
    if (!dragging) return;
    const x = e.clientX ?? e.touches?.[0]?.clientX;
    const y = e.clientY ?? e.touches?.[0]?.clientY;
    if (x == null || y == null) return;
    const dx = x - dragStart.x;
    const dy = y - dragStart.y;
    left = Math.max(0, dragStart.left + dx);
    top = Math.max(0, dragStart.top + dy);
  }

  function endDrag() {
    if (dragging) {
      dragging = false;
      savePosition();
    }
  }

  $effect(() => {
    if (!dragging) return;
    const onMove = (e) => moveDrag(e);
    const onEnd = () => endDrag();
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onEnd);
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onEnd);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
    };
  });

  const toXY = (r, deg) => {
    const rad = (deg * Math.PI) / 180;
    return { x: 50 + r * Math.sin(rad), y: 50 - r * Math.cos(rad) };
  };

  const activeBlip = $derived.by(() => {
    const sid = $selectedModelId;
    const list = $models ?? [];
    if (!sid || !list.length) return null;
    const idx = list.findIndex((x) => (x?.id ?? '') === sid);
    if (idx === -1) return null;
    const m = list[idx];
    const id = m?.id ?? '';
    const n = list.length;
    const step = 360 / n;
    const angle = (idx * step + step * 0.5) % 360;
    const sizeB = parseSizeFromName(id);
    const size = sizeB === Infinity || sizeB <= 0 ? SIZE_R4_B : sizeB;
    const t = Math.min(1, size / SIZE_R4_B);
    const radius = RADIUS_MIN + t * (RADIUS_MAX - RADIUS_MIN);
    return {
      ...toXY(radius, angle),
      angle,
      r: 1.5,
      id,
      name: modelDisplayName(id) || id,
    };
  });

  const blipData = $derived(activeBlip ? [activeBlip] : []);

  const labelOpacity = $derived(activeBlip ? blipOpacity(activeBlip.angle) : 0);

  function blipOpacity(blipAngle) {
    const diff = (blipAngle - sweepAngle + 360) % 360;
    const fade = Math.min(1, diff / BLIP_FADE_DEG);
    return Math.max(0.22, 1 - fade);
  }

  /** Trail fades over ~15° (~150ms at 3.5s/rev). */
  const TRAIL_FADE_DEG = 15;
  function trailOpacity(blipAngle) {
    const diff = (blipAngle - sweepAngle + 360) % 360;
    if (diff >= TRAIL_FADE_DEG) return 0;
    return Math.max(0, (1 - diff / TRAIL_FADE_DEG) * 0.22);
  }

  let prevModelId = $state('');
  let jitterActive = $state(false);
  $effect(() => {
    const sid = $selectedModelId;
    if (sid === prevModelId) return;
    if (prevModelId === '' && sid) {
      prevModelId = sid;
      return;
    }
    prevModelId = sid;
    let cancelled = false;
    jitterActive = false;
    const raf = requestAnimationFrame(() => {
      if (cancelled) return;
      jitterActive = true;
    });
    const t = setTimeout(() => {
      if (!cancelled) jitterActive = false;
    }, 280);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  });
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="signal-scope"
  class:dragging
  role="application"
  aria-label="Sonar scope, drag to reposition"
  style="left: {left}px; top: {top}px;"
  onmousedown={startDrag}
  ontouchstart={startDrag}
>
  <div class="signal-scope-label" style="opacity: {labelOpacity};">
    {activeBlip?.name ?? ''}
  </div>
  <svg viewBox="0 0 100 100" class="signal-scope-svg" class:scope-jitter={jitterActive}>
    <defs>
      <!-- Dark green/cyan tint face -->
      <linearGradient id="scope-face" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#051510" />
        <stop offset="100%" stop-color="#0a1c18" />
      </linearGradient>
      <!-- Sweep: leading edge brightest (100% at tip), fade to transparent toward trailing -->
      <linearGradient id="sweep-gradient" x1="78" y1="22" x2="50" y2="2" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="rgba(0,255,255,0)" />
        <stop offset="45%" stop-color="rgba(0,255,255,0.1)" />
        <stop offset="75%" stop-color="rgba(0,255,255,0.4)" />
        <stop offset="92%" stop-color="rgba(0,255,255,0.85)" />
        <stop offset="100%" stop-color="rgba(0,255,255,1)" />
      </linearGradient>
      <filter id="blip-bloom">
        <feGaussianBlur stdDeviation="1.2" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
      <filter id="sweep-glow">
        <feGaussianBlur stdDeviation="0.5" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
      <filter id="ring-glow">
        <feGaussianBlur stdDeviation="0.3" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
      <!-- CRT phosphor grain: very subtle noise overlay -->
      <filter id="crt-noise" x="-10%" y="-10%" width="120%" height="120%">
        <feTurbulence type="fractalNoise" baseFrequency="0.055" numOctaves="2" result="noise" />
        <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0.07 0" result="grain" />
        <feBlend in="SourceGraphic" in2="grain" mode="overlay" />
      </filter>
      <clipPath id="scope-clip">
        <circle cx="50" cy="50" r="48" />
      </clipPath>
    </defs>

    <!-- Background circle with dark green tint -->
    <circle cx="50" cy="50" r="48" fill="url(#scope-face)" />

    <!-- Noise texture clipped to circle -->
    <g clip-path="url(#scope-clip)">
      <rect width="100" height="100" x="0" y="0" fill="url(#scope-face)" filter="url(#crt-noise)" />
    </g>

    <!-- Range rings: subtle 15–20% opacity, slight glow -->
    <g filter="url(#ring-glow)">
      <circle cx="50" cy="50" r="38" fill="none" stroke="rgba(0,255,255,0.18)" stroke-width="0.4" />
      <circle cx="50" cy="50" r="28" fill="none" stroke="rgba(0,255,255,0.18)" stroke-width="0.4" />
      <circle cx="50" cy="50" r="18" fill="none" stroke="rgba(0,255,255,0.2)" stroke-width="0.4" />
      <circle cx="50" cy="50" r="8" fill="none" stroke="rgba(0,255,255,0.18)" stroke-width="0.4" />
    </g>
    <!-- Range labels: R1 (inner/small) to R4 (outer/large) at 12 o'clock -->
    <text x="50" y="41" class="range-label" text-anchor="middle" fill="rgba(0,255,255,0.32)">R1</text>
    <text x="50" y="31" class="range-label" text-anchor="middle" fill="rgba(0,255,255,0.3)">R2</text>
    <text x="50" y="21" class="range-label" text-anchor="middle" fill="rgba(0,255,255,0.28)">R3</text>
    <text x="50" y="11" class="range-label" text-anchor="middle" fill="rgba(0,255,255,0.26)">R4</text>

    <!-- Sweep: single 70° wedge with gradient fade, rotation synced to JS (3.5s) -->
    <g class="sweep-group" filter="url(#sweep-glow)" transform="rotate({sweepAngle} 50 50)">
      <path class="sweep-wedge" fill="url(#sweep-gradient)" d="M 50 50 L 50 2 A 48 48 0 0 1 91.4 22.9 Z" />
    </g>

    <!-- Single target: active model only; red when sending, green when idle; lights up when sweep passes -->
    {#each blipData as blip (blip.id)}
      <g class="blip-wrap">
        <!-- Faint trail (~150ms fade) behind blip -->
        <circle
          class="blip-trail"
          cx={blip.x}
          cy={blip.y}
          r={blip.r + 1}
          fill={$isStreaming ? 'rgba(255,70,70,0.5)' : 'rgba(0,255,220,0.5)'}
          style="opacity: {trailOpacity(blip.angle)};"
        />
        <circle
          class="blip blip-active"
          class:blip-sending={$isStreaming}
          cx={blip.x}
          cy={blip.y}
          r={blip.r}
          fill={$isStreaming ? 'rgba(255,70,70,0.98)' : 'rgba(0,255,220,0.98)'}
          filter="url(#blip-bloom)"
          style="opacity: {blipOpacity(blip.angle)};"
        />
        <circle
          class="blip-active-ring"
          cx={blip.x}
          cy={blip.y}
          r={blip.r + 1.2}
          fill="none"
          stroke={$isStreaming ? 'rgba(255,90,90,0.7)' : 'rgba(0,255,255,0.6)'}
          stroke-width="0.5"
          style="opacity: {blipOpacity(blip.angle)};"
        />
      </g>
    {/each}

    <!-- Edge: brighter border + 30° tick marks; slight glow when streaming -->
    <circle cx="50" cy="50" r="48" fill="none" stroke="rgba(0,255,255,0.4)" stroke-width="1" class="edge-ring" class:edge-ring-streaming={$isStreaming} />
    {#each Array(12) as _, i}
      {@const deg = i * 30}
      {@const rad = (deg * Math.PI) / 180}
      {@const x1 = 50 + 48 * Math.sin(rad)}
      {@const y1 = 50 - 48 * Math.cos(rad)}
      {@const x2 = 50 + 44 * Math.sin(rad)}
      {@const y2 = 50 - 44 * Math.cos(rad)}
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(0,255,255,0.35)" stroke-width="0.6" stroke-linecap="round" />
    {/each}

    <!-- Scanlines: faint horizontal lines, clipped to circle -->
    <g class="scanlines" clip-path="url(#scope-clip)">
      {#each Array(24) as _, i}
        <line x1="0" y1={2 + i * 4.2} x2="100" y2={2 + i * 4.2} stroke="rgba(0,0,0,0.08)" stroke-width="0.5" />
      {/each}
    </g>
  </svg>
</div>

<style>
  .signal-scope {
    position: fixed;
    display: flex;
    flex-direction: column;
    align-items: center;
    width: clamp(160px, 20vw, 220px);
    z-index: 10;
    cursor: move;
    user-select: none;
    -webkit-user-select: none;
    touch-action: none;
  }
  .signal-scope.dragging {
    cursor: grabbing;
  }
  .signal-scope-label {
    order: -1;
    width: 100%;
    max-width: 100%;
    padding-bottom: 0.35rem;
    font-family: 'Share Tech Mono', 'Orbitron', 'Courier New', monospace;
    font-size: clamp(8px, 2.2vw, 11px);
    font-weight: 700;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    text-align: center;
    color: rgba(0, 255, 255, 0.95);
    text-shadow: 0 0 8px rgba(0, 255, 255, 0.5);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    transition: opacity 0.08s linear;
  }
  .signal-scope-svg {
    width: 100%;
    aspect-ratio: 1;
    display: block;
    flex-shrink: 0;
    filter: drop-shadow(0 0 14px rgba(0, 200, 180, 0.12));
  }
  .range-label {
    font-family: system-ui, sans-serif;
    font-size: 5px;
    font-weight: 600;
    letter-spacing: 0.5px;
  }
  .blip-wrap {
    animation: blip-drift 8s ease-in-out infinite;
  }
  .blip {
    transform-origin: center;
    transition: opacity 0.08s linear;
  }
  .blip-active {
    filter: url(#blip-bloom) drop-shadow(0 0 3px rgba(0, 255, 255, 0.8));
  }
  .blip-active.blip-sending {
    filter: url(#blip-bloom) drop-shadow(0 0 4px rgba(255, 80, 80, 0.9));
  }
  .blip-active-ring {
    transition: opacity 0.08s linear;
    pointer-events: none;
  }
  @keyframes blip-drift {
    0%, 100% { transform: translate(0, 0); }
    25% { transform: translate(0.4px, -0.3px); }
    50% { transform: translate(-0.3px, 0.4px); }
    75% { transform: translate(0.2px, 0.2px); }
  }
  .edge-ring {
    filter: drop-shadow(0 0 2px rgba(0, 255, 255, 0.2));
  }
  .edge-ring.edge-ring-streaming {
    filter: drop-shadow(0 0 2px rgba(0, 255, 255, 0.2)) drop-shadow(0 0 8px rgba(255, 80, 80, 0.35));
  }
  .blip-trail {
    pointer-events: none;
    transition: opacity 0.05s linear;
  }
  .signal-scope-svg.scope-jitter {
    animation: gridJitter 0.25s ease-out;
  }
  @keyframes gridJitter {
    0% { transform: translate(0, 0); }
    33% { transform: translate(0.5px, -0.35px); }
    66% { transform: translate(-0.35px, 0.4px); }
    100% { transform: translate(0, 0); }
  }
  .scanlines {
    pointer-events: none;
  }
</style>
