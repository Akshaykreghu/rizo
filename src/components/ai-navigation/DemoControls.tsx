'use client';

import { motion } from 'framer-motion';
import { Briefcase, Wallet, UserSearch, RotateCcw, PlayCircle, StopCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DemoControlsProps {
  personas: string[];
  onSimulate: (persona: string) => void;
  onReset: () => void;
  isReplaying: boolean;
  onToggleReplay: () => void;
}

const ICONS: Record<string, typeof Briefcase> = {
  'HR Manager': Briefcase,
  'Payroll Officer': Wallet,
  Recruiter: UserSearch,
};

export function DemoControls({ personas, onSimulate, onReset, isReplaying, onToggleReplay }: DemoControlsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        onClick={onToggleReplay}
        className={cn(
          'relative flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors shadow-sm',
          isReplaying
            ? 'bg-red-600 text-white hover:bg-red-700'
            : 'bg-gradient-to-r from-indigo-500 to-violet-600 text-white hover:from-indigo-600 hover:to-violet-700 shadow-[0_4px_14px_-2px_rgba(99,102,241,0.5)]'
        )}
      >
        {isReplaying && (
          <motion.span
            className="absolute inset-0 rounded-full bg-red-500"
            animate={{ opacity: [0.5, 0, 0.5], scale: [1, 1.15, 1] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
          />
        )}
        <span className="relative flex items-center gap-1.5">
          {isReplaying ? <StopCircle className="h-3.5 w-3.5" /> : <PlayCircle className="h-3.5 w-3.5" />}
          {isReplaying ? 'Stop Replay' : 'AI Replay'}
        </span>
      </button>

      {personas.map((persona) => {
        const Icon = ICONS[persona] ?? Briefcase;
        return (
          <button
            key={persona}
            onClick={() => onSimulate(persona)}
            disabled={isReplaying}
            className={cn(
              'flex items-center gap-1.5 rounded-full border border-gray-300 bg-white px-3.5 py-1.5',
              'text-xs font-medium text-gray-700 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700',
              'transition-colors disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white'
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            Simulate {persona}
          </button>
        );
      })}
      <button
        onClick={onReset}
        disabled={isReplaying}
        className="flex items-center gap-1.5 rounded-full border border-gray-300 bg-white px-3.5 py-1.5 text-xs font-medium text-gray-500 hover:border-red-300 hover:bg-red-50 hover:text-red-600 transition-colors disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white"
      >
        <RotateCcw className="h-3.5 w-3.5" />
        Reset Learning
      </button>
    </div>
  );
}
