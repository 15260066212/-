interface TabConfig {
  key: string;
  label: string;
  completed: number;
  total: number;
}

interface ConfigTabsProps {
  tabs: TabConfig[];
  activeKey: string;
  onChange: (key: string) => void;
}

export function ConfigTabs({ tabs, activeKey, onChange }: ConfigTabsProps) {
  return (
    <div className="flex items-center gap-1 px-4 md:px-6 pt-4 border-b border-border bg-card">
      {tabs.map((tab) => {
        const isActive = activeKey === tab.key;
        return (
          <button
            key={tab.key}
            onClick={() => onChange(tab.key)}
            className={`relative px-4 py-2.5 text-sm font-medium transition-colors ${
              isActive
                ? 'text-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
            <span className={`ml-1.5 text-xs ${
              isActive ? 'text-primary/70' : 'text-muted-foreground/70'
            }`}>
              ({tab.completed}/{tab.total})
            </span>
            {/* Active indicator */}
            {isActive && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-t-full" />
            )}
          </button>
        );
      })}
    </div>
  );
}
