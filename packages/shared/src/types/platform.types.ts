/**
 * Platform-related type definitions.
 */

/** Publishing platform IDs (actual content distribution platforms). */
export type PlatformId =
  | 'weixin' | 'zhihu' | 'toutiao'
  | 'csdn' | 'juejin'
  | 'sohu' | 'netease' | 'baike'
  | 'baijia' | 'bilibili' | 'zhidao';

export interface PlatformStrategy {
  platform: string;
  focus: string;
  adaptations: string[];
  order?: number;
  tone?: string;
  publishTime?: string;
  frequency?: string;
  audience?: string;
}

export type ArticleContentType =
  | 'tutorial' | 'case' | 'comparison' | 'popularization'
  | 'faq' | 'whitepaper';

export type ArticleStatus =
  | 'draft' | 'reviewing' | 'approved'
  | 'publishing' | 'published' | 'failed'
  | 'draft_saved' | 'manual_edit';
