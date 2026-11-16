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
    <div class="arena-scoreboard-head">
      <h3 class="arena-scoreboard-title">Scoreboard</h3>
      <p class="arena-scoreboard-sub">{scoreHistory.length} judged · totals update when a question is re-scored</p>
    </div>
    <table class="w-full text-sm border-collapse">
      <thead>
        <tr>
          <th class="arena-matrix-label text-left px-2.5 py-2 border-b min-w-[52px]">Q</th>
          <th class="arena-matrix-label text-left px-2.5 py-2 border-b max-w-[240px] truncate">Challenge</th>
          {#each visibleSlots as slot (slot)}
            <th class="arena-matrix-slot arena-col-{slot} text-center px-2.5 py-2 border-b tabular-nums min-w-[56px]">
              {slot}
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each scoreHistory as round, i (round.questionIndex)}
          <tr class="arena-matrix-row {i % 2 === 0 ? 'arena-matrix-row-a' : 'arena-matrix-row-b'}">
            <td class="arena-matrix-num px-2.5 py-1.5 font-mono tabular-nums border-b">Q{round.questionIndex + 1}</td>
            <td class="arena-matrix-label px-2.5 py-1.5 border-b max-w-[240px] truncate" title={round.questionText}>
              {round.questionText.length > 72 ? round.questionText.slice(0, 69) + '…' : round.questionText}
            </td>
            {#each visibleSlots as slot (slot)}
              {@const s = round.scores[slot]}
              <td class="arena-matrix-num text-center px-2.5 py-1.5 font-mono tabular-nums border-b">
                {s != null ? `${s}` : '—'}
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
      <tfoot>
        <tr class="arena-matrix-total">
          <td class="arena-matrix-num px-2.5 py-2 border-t" colspan="2">Total</td>
          {#each visibleSlots as slot (slot)}
            <td class="arena-matrix-num text-center px-2.5 py-2 tabular-nums border-t">
              {totals[slot] ?? 0}
            </td>
          {/each}
        </tr>
      </tfoot>
    </table>
  </div>
{:else}
  <p class="arena-scoreboard-empty">No scores yet. Ask a question; the judge fills the board when every lane finishes.</p>
{/if}

<style>
  .arena-scoreboard-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 8px;
  }
  .arena-scoreboard-title {
    margin: 0;
    font-family: var(--font-display);
    font-size: 1rem;
    font-weight: 800;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .arena-scoreboard-sub,
  .arena-scoreboard-empty {
    margin: 0;
    font-size: 12px;
    font-weight: 650;
    color: var(--ui-text-secondary);
  }
  .arena-scoreboard-empty {
    padding: 10px 0;
  }
</style>
