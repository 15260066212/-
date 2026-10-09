import type { Article, SessionData } from '@zemingengine/shared';

export interface ReviewRequest {
  article: Article;
  session: SessionData;
  round: number;
}

export interface ReviewerOptions {
  passThreshold: number;
  fallbackMode: boolean;
}
