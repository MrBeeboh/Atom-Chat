<script>
  import { getQuantization } from '$lib/modelIcons.js';
  import {
    modelPricingCatalog,
    lookupPricing,
    formatPriceTriple,
    formatContextTokens,
    formatUsdPerMillion,
    isLocalAtomModel,
  } from '$lib/modelPricing.js';
  import { providerStartupReport, startupPriceFor, providerStatusText } from '$lib/providerFunding.js';

  let { modelId = '', showQuant = true } = $props();

  const local = $derived(isLocalAtomModel(modelId));
  const info = $derived(lookupPricing(modelId, $modelPricingCatalog));
  const quant = $derived(showQuant ? getQuantization(modelId) : null);
  const ctx = $derived(formatContextTokens(local ? info.context : null));
  const meta = $derived([quant, ctx].filter(Boolean).join(' · '));
  const live = $derived(startupPriceFor(modelId, $providerStartupReport));
  const waiting = $derived(!local && $providerStartupReport.length === 0);
  const cloudPrice = $derived.by(() => {
    if (!live?.hit) return '';
    const inn = formatUsdPerMillion(live.hit.inPerM) ?? '?';
    const out = formatUsdPerMillion(live.hit.outPerM) ?? '?';
    return `In ${inn} · Out ${out}`;
  });
  const detailTitle = $derived.by(() => {
    if (local) return formatPriceTriple(info);
    if (live) return providerStatusText(live.row);
    return '';
  });
</script>

{#if meta}
  <span class="block text-[10px] leading-tight" style="color: var(--ui-text-secondary);">{meta}</span>
{/if}
{#if local}
  <span class="block text-[10px] leading-tight font-mono" style="color: var(--ui-text-secondary);" title={detailTitle}>
    {#if $modelPricingCatalog.status === 'loading' && info.source === 'unknown'}
      Prices…
    {:else}
      {formatPriceTriple(info)}
    {/if}
  </span>
{:else if waiting}
  <!-- Keep header quiet while the startup funding check finishes. -->
{:else if cloudPrice}
  <span class="block text-[10px] leading-tight font-mono" style="color: var(--ui-text-secondary);" title={detailTitle}>
    {cloudPrice}
  </span>
{:else if live}
  <span class="block text-[10px] leading-tight" style="color: var(--ui-text-secondary);" title={detailTitle}>Price unknown</span>
{/if}
