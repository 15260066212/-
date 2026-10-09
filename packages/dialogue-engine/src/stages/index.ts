import type { StageHandler } from '../types.js';
import { introStage } from './stage0-intro.js';
import { profileStage } from './stage1-profile.js';
import { keywordsStage } from './stage2-keywords.js';
import { wordbankStage } from './stage3-wordbank.js';
import { knowledgeStage } from './stage4-knowledge.js';
import { promptsStage } from './stage5-prompts.js';
import { platformsStage } from './stage6-platforms.js';

export const stageHandlers: StageHandler[] = [
  introStage,
  profileStage,
  keywordsStage,
  wordbankStage,
  knowledgeStage,
  promptsStage,
  platformsStage,
];

export function getStageHandler(stage: string): StageHandler | undefined {
  return stageHandlers.find((h) => h.stage === stage);
}
