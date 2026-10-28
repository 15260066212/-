/**
 * Monitor and dashboard-related type definitions.
 */

import type { PublishLog } from './pipeline.types.js';

export interface MonitorArticleStats {
  total: number;
  draft: number;
  reviewing: number;
  approved: number;
  publishing: number;
  published: number;
  failed: number;
}

export interface MonitorPublishTaskStats {
  total: number;
  pending: number;
  publishing: number;
  published: number;
  failed: number;
  retrying: number;
}

export interface MonitorSessionStats {
  total: number;
}

export interface MonitorPipelineRunStats {
  total: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
}

export interface MonitorCredentialStats {
  total: number;
  active: number;
  expired: number;
  invalid: number;
}

export interface MonitorCredentialHealth {
  total: number;
  valid: number;
  checking: number;
  expired: number;
  invalid: number;
  lastCheckedAt?: string;
  byPlatform: Array<{ platform: string; total: number; valid: number; expired: number; healthRate: number }>;
}

export interface MonitorOverview {
  articles: MonitorArticleStats;
  publishTasks: MonitorPublishTaskStats;
  sessions: MonitorSessionStats;
  pipelineRuns: MonitorPipelineRunStats;
  credentials: MonitorCredentialStats;
  credentialHealth?: MonitorCredentialHealth;
  recentLogs: PublishLog[];
}

export interface ArticleTimelinePoint {
  date: string;
  count: number;
}

export interface PlatformCount {
  platform: string;
  count: number;
}

export interface StatusCount {
  status: string;
  count: number;
}

export interface ArticleChartdata {
  timeline: ArticleTimelinePoint[];
  byPlatform: PlatformCount[];
  byStatus: StatusCount[];
}

export interface PublishTimelinePoint {
  date: string;
  published: number;
  failed: number;
}

export interface PublishPlatformStat {
  platform: string;
  total: number;
  published: number;
  failed: number;
}

export interface PublishChartdata {
  timeline: PublishTimelinePoint[];
  successRate: number;
  byPlatform: PublishPlatformStat[];
}

export interface FailureTypeStat {
  type: string;
  category: string;
  count: number;
  percentage: number;
}

export interface SuccessRateTrendPoint {
  date: string;
  total: number;
  published: number;
  failed: number;
  successRate: number;
}

export interface PublishFailureAnalysis {
  byFailureType: FailureTypeStat[];
  byPlatform: PublishPlatformStat[];
  successRateTrend: SuccessRateTrendPoint[];
  overallSuccessRate: number;
  totalFailures: number;
  topErrors: { error: string; count: number; type: string }[];
}

export interface ScoreDistributionItem {
  range: string;
  count: number;
}

export interface ReviewChartdata {
  averageScore: number;
  passRate: number;
  scoreDistribution: ScoreDistributionItem[];
}
