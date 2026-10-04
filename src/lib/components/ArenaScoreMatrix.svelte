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

  const hasHistory = $derived(scoreHistory.length > 0);
</script>

{#if hasHistory}
  <div class="arena-score-matrix overflow-x-auto">
    <table class="w-full text-xs border-collapse">
      <thead>
        <tr>
          <th class="arena-matrix-label text-left px-2 py-1.5 border-b min-w-[50px]">Q#</th>
          <th class="arena-matrix-label text-left px-2 py-1.5 border-b max-w-[200px] truncate">Question</th>
          {#each visibleSlots as slot}
            <th class="arena-matrix-slot arena-col-{slot} text-center px-2 py-1.5 border-b tabular-nums min-w-[50px]">
              {slot}
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each scoreHistory as round, i}
          <tr class="arena-matrix-row {i % 2 === 0 ? 'arena-matrix-row-a' : 'arena-matrix-row-b'}">
            <td class="arena-matrix-num px-2 py-1 font-mono tabular-nums border-b">Q{round.questionIndex + 1}</td>
            <td class="arena-matrix-label px-2 py-1 border-b max-w-[200px] truncate" title={round.questionText}>
              {round.questionText.length > 60 ? round.questionText.slice(0, 57) + '…' : round.questionText}
            </td>
            {#each visibleSlots as slot}
              {@const s = round.scores[slot]}
              <td class="arena-matrix-num text-center px-2 py-1 font-mono tabular-nums border-b">
                {s != null ? `${s}/10` : '—'}
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
      <tfoot>
        <tr class="arena-matrix-total">
          <td class="arena-matrix-num px-2 py-1.5 border-t" colspan="2">Total</td>
          {#each visibleSlots as slot}
            <td class="arena-matrix-num text-center px-2 py-1.5 tabular-nums border-t">
              {totals[slot] ?? 0}
            </td>
          {/each}
        </tr>
      </tfoot>
    </table>
  </div>
{:else}
  <p class="text-xs py-2 font-semibold" style="color: var(--arena-read, #12161c);">No scores yet. Run questions; scoring runs automatically when all models finish.</p>
{/if}
