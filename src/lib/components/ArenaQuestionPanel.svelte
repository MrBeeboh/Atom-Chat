<script>
  import { makeDraggable, makeResizable } from "$lib/utils.js";
  import { onMount } from "svelte";

  let {
    open = true,
    onClose = () => {},
    questionPanelPos = $bindable({ x: 20, y: 80 }),
    questionPanelSize = $bindable({ w: 300, h: 150 }),
    currentQuestionText = "",
    currentQuestionNum = 0,
  } = $props();

  onMount(() => {
    if (typeof localStorage === "undefined") return;
    try {
      const posStr = localStorage.getItem("arenaQuestionPanelPos");
      const sizeStr = localStorage.getItem("arenaQuestionPanelSize");
      if (posStr) {
        const pos = JSON.parse(posStr);
        if (typeof pos.x === "number" && typeof pos.y === "number") questionPanelPos = pos;
      }
      if (sizeStr) {
        const size = JSON.parse(sizeStr);
        if (typeof size.w === "number" && typeof size.h === "number") questionPanelSize = size;
      }
    } catch (_) {}
  });

  $effect(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("arenaQuestionPanelPos", JSON.stringify(questionPanelPos));
    }
  });
  $effect(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("arenaQuestionPanelSize", JSON.stringify(questionPanelSize));
    }
  });

  let panelElement = $state(null);
</script>

{#if open && currentQuestionText}
  <div
    bind:this={panelElement}
    class="arena-question-panel rounded-lg border shadow-lg overflow-hidden"
    style="position: fixed; left: {questionPanelPos.x}px; top: {questionPanelPos.y}px; width: {questionPanelSize.w}px; height: {questionPanelSize.h}px; z-index: 40; background-color: var(--ui-bg-sidebar); border-color: var(--ui-border);"
    use:makeResizable={{
      storageKey: "arenaQuestionPanelSize",
      getSize: () => questionPanelSize,
      setSize: (s) => (questionPanelSize = s),
      minWidth: 200,
      minHeight: 100,
    }}
  >
    <div
      class="flex items-center justify-between px-3 py-2 cursor-grab active:cursor-grabbing border-b"
      style="border-color: var(--ui-border); color: var(--ui-text-primary);"
      use:makeDraggable={{
        storageKey: "arenaQuestionPanelPos",
        getPos: () => questionPanelPos,
        setPos: (p) => (questionPanelPos = p),
      }}
    >
      <span class="text-xs font-semibold">
        {#if currentQuestionNum > 0}Q{currentQuestionNum}{/if} Question
      </span>
      <button
        type="button"
        class="p-1 rounded opacity-70 hover:opacity-100"
        style="color: var(--ui-text-secondary);"
        onclick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label="Close floating question panel"
        >×</button>
    </div>
    <div class="p-3 overflow-auto h-full" style="color: var(--ui-text-primary);">
      <div class="text-sm whitespace-pre-wrap">{currentQuestionText}</div>
    </div>
  </div>
{/if}
