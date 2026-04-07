<script>
  import { get } from 'svelte/store';
  import { setPerModelOverride, presetDefaultModels, selectedModelId, models, settings } from '$lib/stores.js';

  const PRESETS = [
    { name: 'General', prompt: 'You are a helpful assistant.' },
    { name: 'Code', prompt: 'You are an expert programmer. Be concise. Prefer code over prose when relevant.' },
    { name: 'Research', prompt: 'You are a thorough researcher. Cite sources when possible. Structure answers with clear sections.' },
    { name: 'Creative', prompt: 'You are a creative writer. Use vivid language and varied structure. Be engaging and original.' },
  ];

  let { compact = false } = $props();
  let currentPresetName = $state('');

  $effect(() => {
    const unsub = settings.subscribe((s) => {
      currentPresetName = PRESETS.find((p) => (s?.system_prompt ?? '').trim() === p.prompt.trim())?.name ?? '';
    });
    return () => unsub();
  });

  function applyPreset(name) {
    const preset = PRESETS.find((p) => p.name === name);
    if (!preset) return;
    const byPreset = get(presetDefaultModels) ?? {};
    const defaultModel = byPreset[name];
    const list = get(models) ?? [];
    const modelId = defaultModel && list.some((m) => m.id === defaultModel) ? defaultModel : get(selectedModelId);
    if (modelId) setPerModelOverride(modelId, { system_prompt: preset.prompt });
    if (defaultModel && list.some((m) => m.id === defaultModel)) selectedModelId.set(defaultModel);
  }
</script>

<select
  class="rounded-lg px-2 text-xs font-medium cursor-pointer border transition-colors focus:outline-none focus:ring-1 {compact ? 'py-1.5' : 'py-2'}"
  style="background: var(--ui-input-bg); color: var(--ui-text-primary); border-color: var(--ui-border); min-width: {compact ? '6rem' : '8rem'};"
  value={currentPresetName}
  onchange={(e) => {
    const v = e.currentTarget.value;
    if (v) applyPreset(v);
  }}
  title="Preset (system prompt + default model)"
  aria-label="Preset">
  <option value="">Preset</option>
  {#each PRESETS as p}
    <option value={p.name}>{p.name}</option>
  {/each}
</select>
