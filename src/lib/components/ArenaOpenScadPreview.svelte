<script module>
  const pngCache = new Map();
</script>

<script>
  /** One PNG from POST /api/openscad-render. A failure is a single short line. */
  let { source = '' } = $props();
  let pngUrl = $state('');
  let error = $state('');

  $effect(() => {
    const src = String(source || '');
    let stopped = false;
    error = '';
    pngUrl = '';
    if (!src) return;

    const apply = (hit) => {
      if (stopped || !hit) return;
      if (hit.url) pngUrl = hit.url;
      else if (hit.error) error = hit.error;
    };

    const hit = pngCache.get(src);
    if (hit?.url || hit?.error) {
      apply(hit);
      return () => { stopped = true; };
    }
    if (hit?.promise) {
      hit.promise.then(apply).catch(() => {});
      return () => { stopped = true; };
    }

    const ctrl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ctrl.abort();
    }, 70_000);

    const task = (async () => {
      const res = await fetch('/api/openscad-render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: src }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        let msg = 'render failed';
        try {
          const body = await res.json();
          if (body?.error) msg = String(body.error);
        } catch {
          /* keep the short line */
        }
        return { error: msg.replace(/\s+/g, ' ').slice(0, 160) };
      }
      const blob = await res.blob();
      if (!blob || blob.size < 32) return { error: 'render failed' };
      return { url: URL.createObjectURL(blob) };
    })();

    pngCache.set(src, { promise: task });
    task.then((result) => {
      pngCache.set(src, result);
      apply(result);
    }).catch((err) => {
      if (pngCache.get(src)?.promise === task) pngCache.delete(src);
      if (stopped && !timedOut) return;
      error = timedOut || err?.name === 'AbortError' ? 'render timed out' : 'render failed';
    }).finally(() => clearTimeout(timer));

    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  });
</script>

{#if pngUrl}
  <img class="arena-scad-png" src={pngUrl} alt="OpenSCAD render" />
{:else if error}
  <p class="arena-scad-err">{error}</p>
{:else}
  <p class="arena-scad-err">rendering…</p>
{/if}

<style>
  .arena-scad-png {
    display: block;
    max-width: 100%;
    height: auto;
    margin: 0 0 6px;
    background: #fffff0;
  }
  .arena-scad-err {
    margin: 0 0 6px;
    font-size: 12px;
    font-weight: 700;
    color: var(--arena-read, #12161c);
  }
</style>
