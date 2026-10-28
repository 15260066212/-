export { DialogueEngine } from './state-machine.js';
export type { StageHandler, Question, ValidationResult } from './types.js';

/** 公共重建入口：enterprise 字段变更时用于刷新已陈旧的编译式知识库。 */
export {
  rebuildKnowledgeBase,
  selectCitedSources,
  recordSourceUsage,
} from './stages/stage4-knowledge.js';
export type { SourceSelection } from './stages/stage4-knowledge.js';
