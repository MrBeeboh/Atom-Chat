/**
 * @file api.js
 * @description Inference API client — backward-compatible facade.
 *
 * The implementation was split into single-concern modules (model id utils,
 * llama.cpp router, model listing, load/unload, chat, Grok, image generation,
 * hardware/TTS, Flash-Next). This file re-exports the original public surface so
 * every existing `import { … } from "$lib/api.js"` keeps working unchanged.
 */

// Cloud catalog (re-exported as before).
export { CLOUD_PROVIDERS, getModelTypeTag, invalidateCloudModelCache } from '$lib/cloudCatalog.js';

// Model id classification / normalization / display.
export {
  QWEN38_FLASH_NEXT_MODEL_ID,
  isQwen38FlashNextSelection,
  localChatModelIdForRequest,
  clampChatMaxTokens,
  modelDisplayName,
  modelSelectorPrimaryLine,
  modelSelectorSecondaryLine,
  mergeServerAndDiskModels,
  isGrokModel,
  isDeepSeekModel,
} from '$lib/modelIdUtils.js';

// Flash-Next special-casing.
export { flashNextHasVision, assertFlashNextCanChat } from '$lib/flashNext.js';

// llama.cpp router parsing + probes.
export {
  isLlamaRouterModelsPayload,
  probeLocalContextSize,
  probeLlamaRouterModelsList,
  checkLmStudioConnection,
} from '$lib/llamaRouter.js';

// Model discovery.
export { probeLmsRestModelsList, getModels } from '$lib/modelListing.js';

// Load / unload management.
export {
  getLoadedModelKeys,
  unloadByInstanceId,
  waitUntilUnloaded,
  throwIfAborted,
  isLocalModelChatReady,
  ensureLocalModelReadyForChat,
  waitUntilLoaded,
  loadModel,
  getLoadedInstanceIdsForModel,
  unloadModel,
  unloadAllLoadedModels,
  unloadAllModelsNative,
} from '$lib/modelLoadUnload.js';

// OpenAI-compatible chat.
export {
  messagesContainImages,
  firstTokenBudgetMs,
  openaiChatStreamOptions,
  openaiChatCompletionsUrl,
  decodeTokPerSec,
  requestChatCompletion,
  streamChatCompletion,
} from '$lib/openaiChat.js';

// Grok / xAI.
export { requestGrokImageGeneration } from '$lib/grok.js';

// Cloud image / video generation.
export {
  requestDeepSeekImageGeneration,
  requestTogetherImageGeneration,
  requestDeepInfraImageGeneration,
  requestDeepInfraVideoGeneration,
} from '$lib/imageGen.js';

// Hardware metrics + DeepInfra TTS.
export {
  fetchHardwareMetrics,
  deepinfraInferenceUrl,
  requestDeepInfraKokoroSpeech,
} from '$lib/hardwareMetrics.js';
