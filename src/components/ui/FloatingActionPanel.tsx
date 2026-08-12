'use client';

import { cn } from '@/lib/utils';

type ActionVariant = 'primary' | 'success' | 'danger' | 'default';

const VARIANT_CLASSES: Record<ActionVariant, string> = {
  primary: 'bg-[color:var(--color-primary)] text-white hover:scale-[1.03] shadow-sm',
  success: 'bg-[color:var(--color-success)] text-white hover:opacity-90',
  danger: 'text-[color:var(--color-danger)] hover:bg-[color:var(--color-danger)]/10',
  default: 'text-slate-600 hover:bg-slate-100',
};

export interface FloatingAction {
  key: string;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  variant?: ActionVariant;
}

interface FloatingActionPanelProps {
  visible: boolean;
  actions: FloatingAction[];
}

export function FloatingActionPanel({ visible, actions }: FloatingActionPanelProps) {
  if (!visible || actions.length === 0) return null;

  return (
    <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-40 animate-float-in">
      <div className="bg-white/90 backdrop-blur-xl border border-slate-200 rounded-full p-1.5 flex items-center gap-1 shadow-xl">
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <button
              key={action.key}
              onClick={action.onClick}
              className={cn(
                'flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-full transition-all duration-[180ms]',
                VARIANT_CLASSES[action.variant ?? 'default']
              )}
            >
              {Icon && <Icon className="w-4 h-4" />}
              {action.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
