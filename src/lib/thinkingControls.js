/**
 * Per-model thinking / speed knobs.
 * Only advertise levels the backend actually accepts. Qwen3.8 GGUF templates
 * take enable_thinking plus reasoning_effort low|medium|xhigh (default xhigh).
 * llama.cpp also accepts a per-request reasoning_budget_tokens cap.
 */

export const THINKING_OFF = 'off';
export const SPEED_FAST = 'fast';
export const SPEED_BALANCED = 'balanced';
export const SPEED_THOROUGH = 'thorough';

const SPEED_BUDGET = {
  [SPEED_FAST]: 256,
  [SPEED_BALANCED]: 1024,
  [SPEED_THOROUGH]: -1,
};

const QWEN38_LEVELS = [THINKING_OFF, 'low', 'medium', 'xhigh'];
const GROK_LEVELS = [THINKING_OFF, 'low', 'medium', 'high'];
const ON_OFF_LEVELS = [THINKING_OFF, 'on'];
const GPT_OSS_LEVELS = [THINKING_OFF, 'low', 'medium', 'high'];
const SPEED_LEVELS = [SPEED_FAST, SPEED_BALANCED, SPEED_THOROUGH];

const EMPTY = {
  thinkingLevels: [],
  speedLevels: [],
  defaultThinking: THINKING_OFF,
  defaultSpeed: SPEED_THOROUGH,
  kind: 'none',
};

function idParts(modelId) {
  const raw = String(modelId || '');
  const colon = raw.indexOf(':');
  const provider = colon > 0 ? raw.slice(0, colon).toLowerCase() : '';
  const name = (colon > 0 ? raw.slice(colon + 1) : raw).toLowerCase();
  return { raw, provider, name, local: !provider };
}

function isQwen38(name) {
  return /qwen3\.8|qwen[-_.]?3\.8|qwen38/.test(name);
}

function isGptOss(name) {
  return /gpt[-_.]?oss|oss[-_.]?120b/.test(name);
}

function grokHasReasoning(name) {
  if (/imagine|voice|non[-_.]?reasoning|image|video/.test(name)) return false;
  return /grok[-_.]?[34]|grok[-_.]?build/.test(name) || /reasoning/.test(name);
}

function localHasThinkingToggle(name) {
  return (
    isQwen38(name) ||
    /qwen3|qwen[-_.]?3/.test(name) ||
    /deepseek[-_.]?r1|[-_.]r1[-_.]/.test(name) ||
    /gpt[-_.]?oss|oss[-_.]?120b/.test(name) ||
    /glm[-_.]?4|glm[-_.]?5/.test(name) ||
    /\b(thinking|reasoning)\b/.test(name)
  );
}

/**
 * @param {string} [modelId]
 * @returns {{ thinkingLevels: string[], speedLevels: string[], defaultThinking: string, defaultSpeed: string, kind: string }}
 */
export function getThinkingProfile(modelId) {
  const { provider, name, local } = idParts(modelId);
  if (!name) return { ...EMPTY };

  if (provider === 'grok') {
    if (!grokHasReasoning(name)) return { ...EMPTY };
    return {
      thinkingLevels: GROK_LEVELS,
      speedLevels: [],
      defaultThinking: 'low',
      defaultSpeed: SPEED_THOROUGH,
      kind: 'grok',
    };
  }

  if (provider === 'deepseek') {
    if (/reasoner/.test(name)) {
      return {
        thinkingLevels: ['on'],
        speedLevels: [],
        defaultThinking: 'on',
        defaultSpeed: SPEED_THOROUGH,
        kind: 'deepseek-locked',
      };
    }
    const effort = /v4[-_.]?pro|thinking|reason/.test(name);
    return {
      thinkingLevels: effort ? GROK_LEVELS : ON_OFF_LEVELS,
      speedLevels: [],
      defaultThinking: effort ? 'low' : THINKING_OFF,
      defaultSpeed: SPEED_THOROUGH,
      kind: 'deepseek',
    };
  }

  if (local && isQwen38(name)) {
    return {
      thinkingLevels: QWEN38_LEVELS,
      speedLevels: SPEED_LEVELS,
      defaultThinking: 'medium',
      defaultSpeed: SPEED_BALANCED,
      kind: 'qwen38',
    };
  }

  if (local && localHasThinkingToggle(name)) {
    const levels = isGptOss(name) ? GPT_OSS_LEVELS : isQwen38(name) ? QWEN38_LEVELS : ON_OFF_LEVELS;
    return {
      thinkingLevels: levels,
      speedLevels: SPEED_LEVELS,
      defaultThinking: THINKING_OFF,
      defaultSpeed: SPEED_BALANCED,
      kind: isGptOss(name) ? 'gpt-oss' : 'local-think',
    };
  }

  if ((provider === 'nous' || provider === 'cerebras' || provider === 'deepinfra') && isQwen38(name)) {
    return {
      thinkingLevels: QWEN38_LEVELS,
      speedLevels: [],
      defaultThinking: 'medium',
      defaultSpeed: SPEED_THOROUGH,
      kind: 'cloud-qwen38',
    };
  }

  if ((provider === 'nous' || provider === 'cerebras' || provider === 'deepinfra') && isGptOss(name)) {
    return {
      thinkingLevels: GPT_OSS_LEVELS,
      speedLevels: [],
      defaultThinking: 'low',
      defaultSpeed: SPEED_THOROUGH,
      kind: 'gpt-oss',
    };
  }

  return { ...EMPTY };
}

export function modelSupportsThinking(modelId) {
  return getThinkingProfile(modelId).thinkingLevels.length > 0;
}

export function thinkingLevelLabel(level) {
  switch (level) {
    case THINKING_OFF:
      return 'Off';
    case 'on':
      return 'On';
    case 'low':
      return 'Low';
    case 'medium':
      return 'Med';
    case 'high':
      return 'High';
    case 'xhigh':
      return 'Max';
    default:
      return String(level || '');
  }
}

export function thinkingSpeedLabel(level) {
  switch (level) {
    case SPEED_FAST:
      return 'Fast';
    case SPEED_BALANCED:
      return 'Normal';
    case SPEED_THOROUGH:
      return 'Full';
    default:
      return String(level || '');
  }
}

function pickLevel(value, allowed, fallback) {
  const v = String(value || '').toLowerCase();
  if (allowed.includes(v)) return v;
  if (v === 'high' && allowed.includes('xhigh')) return 'xhigh';
  if (v === 'xhigh' && allowed.includes('high')) return 'high';
  if (v === 'max' && allowed.includes('xhigh')) return 'xhigh';
  if (v === 'max' && allowed.includes('high')) return 'high';
  if ((v === 'true' || v === '1' || v === 'on') && allowed.includes('on')) return 'on';
  if ((v === 'false' || v === '0' || v === 'none') && allowed.includes(THINKING_OFF)) return THINKING_OFF;
  return fallback;
}

/**
 * @param {string} modelId
 * @param {{ thinking?: string, thinking_speed?: string, disable_thinking?: boolean }} [opts]
 */
export function resolveThinkingChoice(modelId, opts = {}) {
  const profile = getThinkingProfile(modelId);
  if (opts.disable_thinking === true) {
    const thinking = profile.thinkingLevels.includes(THINKING_OFF)
      ? THINKING_OFF
      : profile.thinkingLevels[0] || THINKING_OFF;
    return { thinking, speed: SPEED_FAST, profile, forcedOff: true };
  }
  if (!profile.thinkingLevels.length) {
    return { thinking: THINKING_OFF, speed: SPEED_THOROUGH, profile, forcedOff: false };
  }
  const thinking = pickLevel(opts.thinking, profile.thinkingLevels, profile.defaultThinking);
  const speed = profile.speedLevels.length
    ? pickLevel(opts.thinking_speed, profile.speedLevels, profile.defaultSpeed)
    : SPEED_THOROUGH;
  return { thinking, speed, profile, forcedOff: false };
}

export function pickThinkingOptions(src = {}) {
  const out = {};
  if (src.thinking != null && src.thinking !== '') out.thinking = src.thinking;
  if (src.thinking_speed != null && src.thinking_speed !== '') out.thinking_speed = src.thinking_speed;
  if (src.disable_thinking != null) out.disable_thinking = src.disable_thinking;
  return out;
}

function thinkingOn(choice) {
  return choice.thinking !== THINKING_OFF;
}

function qwen38Effort(thinking) {
  if (thinking === THINKING_OFF) return 'low';
  if (thinking === 'high') return 'xhigh';
  if (thinking === 'on') return 'medium';
  return thinking;
}

function grokEffort(thinking) {
  if (thinking === THINKING_OFF) return 'none';
  if (thinking === 'xhigh' || thinking === 'on') return 'high';
  return thinking;
}

/**
 * Mutates an OpenAI-style chat body (llama.cpp, DeepSeek, Nous, Cerebras).
 * @param {Record<string, unknown>} body
 * @param {{ model: string, options?: object, local?: boolean }} args
 */
export function applyThinkingToChatBody(body, { model, options = {}, local = false }) {
  const choice = resolveThinkingChoice(model, options);
  const { profile } = choice;
  if (profile.kind === 'none' && options.disable_thinking !== true) return body;

  if (profile.kind === 'grok') {
    body.reasoning = { effort: grokEffort(choice.thinking) };
    return body;
  }

  if (profile.kind === 'deepseek' || profile.kind === 'deepseek-locked') {
    if (profile.kind === 'deepseek') {
      body.thinking = { type: thinkingOn(choice) ? 'enabled' : 'disabled' };
    }
    if (thinkingOn(choice) && ['low', 'medium', 'high', 'xhigh'].includes(choice.thinking)) {
      body.reasoning_effort = grokEffort(choice.thinking);
    }
    return body;
  }

  const kwargs = { ...(body.chat_template_kwargs || {}) };
  kwargs.enable_thinking = thinkingOn(choice);
  if (profile.kind === 'qwen38' || profile.kind === 'cloud-qwen38') {
    if (thinkingOn(choice)) kwargs.reasoning_effort = qwen38Effort(choice.thinking);
  } else if (profile.kind === 'gpt-oss' && thinkingOn(choice)) {
    kwargs.reasoning_effort = grokEffort(choice.thinking);
  }
  body.chat_template_kwargs = kwargs;

  if (local || profile.kind === 'qwen38' || profile.kind === 'local-think' || profile.kind === 'gpt-oss') {
    if (!thinkingOn(choice)) {
      body.reasoning_effort = 'none';
      body.reasoning_budget_tokens = 0;
    } else {
      if (choice.thinking !== 'on') body.reasoning_effort = qwen38Effort(choice.thinking);
      if (profile.speedLevels.length) {
        body.reasoning_budget_tokens = SPEED_BUDGET[choice.speed] ?? -1;
      }
    }
  }

  return body;
}

/**
 * Mutates an xAI Responses API body.
 * @param {Record<string, unknown>} body
 * @param {{ model: string, options?: object }} args
 */
export function applyThinkingToGrokBody(body, { model, options = {} }) {
  const choice = resolveThinkingChoice(model, options);
  if (choice.profile.kind !== 'grok' && options.disable_thinking !== true) return body;
  body.reasoning = { effort: grokEffort(choice.thinking) };
  return body;
}
