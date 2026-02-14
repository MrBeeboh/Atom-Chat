<script>
  /**
   * ArenaScoreMatrix: Per-question score breakdown table.
   * Shows which score each model got on each question, plus totals.
   */
  let {
    scoreHistory = [],
    totals = { A: 0, B: 0, C: 0, D: 0 },
    visibleSlots = ['A', 'B', 'C', 'D'],
  } = $props();

  const SLOT_COLORS = { A: '#3b82f6', B: '#10b981', C: '#f59e0b', D: '#8b5cf6' };

  const hasHistory = $derived(scoreHistory.length > 0);
</script>

{#if hasHistory}
  <div class="arena-score-matrix overflow-x-auto">
    <table class="w-full text-xs border-collapse">
      <thead>
        <tr>
          <th class="text-left px-2 py-1.5 font-semibold border-b" style="color: var(--ui-text-secondary); border-color: var(--ui-border); min-width: 50px;">Q#</th>
          <th class="text-left px-2 py-1.5 font-normal border-b max-w-[200px] truncate" style="color: var(--ui-text-secondary); border-color: var(--ui-border);">Question</th>
          {#each visibleSlots as slot}
            <th class="text-center px-2 py-1.5 font-bold border-b tabular-nums" style="color: {SLOT_COLORS[slot] ?? 'var(--ui-text-primary)'}; border-color: var(--ui-border); min-width: 50px;">
              {slot}
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each scoreHistory as round, i}
          <tr class="hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
            <td class="px-2 py-1 font-mono tabular-nums border-b" style="color: var(--ui-text-secondary); border-color: var(--ui-border);">Q{round.questionIndex + 1}</td>
            <td class="px-2 py-1 border-b max-w-[200px] truncate" style="color: var(--ui-text-primary); border-color: var(--ui-border);" title={round.questionText}>
              {round.questionText.length > 60 ? round.questionText.slice(0, 57) + '…' : round.questionText}
            </td>
            {#each visibleSlots as slot}
              {@const s = round.scores[slot]}
              <td class="text-center px-2 py-1 font-mono tabular-nums border-b" style="color: {s != null ? (s >= 7 ? '#22c55e' : s >= 4 ? '#f59e0b' : '#ef4444') : 'var(--ui-text-secondary)'}; border-color: var(--ui-border);">
                {s != null ? `${s}/10` : '—'}
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
      <tfoot>
        <tr>
          <td class="px-2 py-1.5 font-bold border-t" style="color: var(--ui-text-primary); border-color: var(--ui-border);" colspan="2">Total</td>
          {#each visibleSlots as slot}
            <td class="text-center px-2 py-1.5 font-bold tabular-nums border-t" style="color: {SLOT_COLORS[slot] ?? 'var(--ui-text-primary)'}; border-color: var(--ui-border);">
              {totals[slot] ?? 0}
            </td>
          {/each}
        </tr>
      </tfoot>
    </table>
  </div>
{:else}
  <p class="text-xs py-2" style="color: var(--ui-text-secondary);">No scores yet. Run questions; scoring runs automatically when all models finish.</p>
{/if}
