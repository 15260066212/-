import type { ArticleStatus } from '@zemingengine/shared';

interface Props {
  status: ArticleStatus;
}

const STATUS_CONFIG: Record<ArticleStatus, { label: string; className: string }> = {
  draft: {
    label: '草稿',
    className: 'bg-muted text-foreground/70',
  },
  reviewing: {
    label: '审核中',
    className: 'bg-warning-bg text-warning',
  },
  approved: {
    label: '已通过',
    className: 'bg-primary/10 text-primary',
  },
  publishing: {
    label: '发布中',
    className: 'bg-purple-100 text-purple-700',
  },
  published: {
    label: '已发布',
    className: 'bg-success-bg text-success',
  },
  failed: {
    label: '失败',
    className: 'bg-error-bg text-error',
  },
  draft_saved: {
    label: '仅存草稿',
    className: 'bg-amber-100 text-amber-700 border border-amber-300',
  },
  manual_edit: {
    label: '待人工改写',
    className: 'bg-orange-100 text-orange-700 border border-orange-300',
  },
};

export function ArticleStatusBadge({ status }: Props) {
  const config = STATUS_CONFIG[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${config.className}`}
    >
      {config.label}
    </span>
  );
}
