export type { GenerateRequest, GenerateResult } from './types.js';
export { buildPrompt } from './prompt-builder.js';
export { adaptForPlatform, countWords } from './platform-adapter.js';
export {
  ContentGenerator,
  FALLBACK_MODEL_ID,
  normalizeContentType,
  enforceCitationCoverage,
} from './generator.js';
