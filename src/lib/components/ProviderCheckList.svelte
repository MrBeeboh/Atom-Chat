<script>
  import { providerStartupReport, providerStatusText } from '$lib/providerFunding.js';
</script>

<section class="provider-check" aria-label="Cloud funding and pricing">
  {#if $providerStartupReport.length > 0}
    {@const issues = $providerStartupReport.filter((row) => row.fundingState === 'error' || row.priceState === 'error' || row.priceState === 'stale' || row.fundingState === 'stale' || !row.funded)}
    {#if issues.length}
      <p class="issues" title={issues.map((row) => providerStatusText(row)).join('\n')}>
        {issues.length} issue{issues.length === 1 ? '' : 's'}
        <span class="sr-only">{issues.map((row) => providerStatusText(row)).join('. ')}</span>
      </p>
    {/if}
  {/if}
</section>

<style>
  .provider-check {
    padding: 0 4px;
    background: transparent;
  }
  .provider-check .issues {
    margin: 0;
    border-radius: 999px;
    border: 1px solid var(--ui-border);
    background: color-mix(in srgb, #d97706 16%, var(--ui-bg-main));
    padding: 4px 10px;
    font-size: 11px;
    font-weight: 700;
    color: var(--ui-text-primary);
    white-space: nowrap;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
