'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, ArrowUpRight, ArrowDownRight, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { RankedModule } from '@/hooks/useNavigationAI';

interface NavigationCardProps {
  module: RankedModule;
  onClick: (id: RankedModule['id']) => void;
  onHover: (id: RankedModule['id'], seconds: number) => void;
  formatLastAccessed: (timestamp: number | null) => string;
}

const HOVER_EXPAND_MS = 500;

export function NavigationCard({ module, onClick, onHover, formatLastAccessed }: NavigationCardProps) {
  const router = useRouter();
  const [hoverExpanded, setHoverExpanded] = useState(false);
  const hoverStart = useRef<number | null>(null);
  const expandTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const Icon = module.icon;
  const heat = module.confidence >= 80 ? 'hot' : module.confidence >= 60 ? 'warm' : 'neutral';
  const rankChange = module.previousRank - module.rank;
  const expanded = hoverExpanded || Boolean(module.matchedSubmenu);

  function handleMouseEnter() {
    hoverStart.current = Date.now();
    expandTimer.current = setTimeout(() => setHoverExpanded(true), HOVER_EXPAND_MS);
  }

  function handleMouseLeave() {
    if (expandTimer.current) clearTimeout(expandTimer.current);
    setHoverExpanded(false);
    if (hoverStart.current) {
      const seconds = (Date.now() - hoverStart.current) / 1000;
      hoverStart.current = null;
      if (seconds >= 0.5) onHover(module.id, seconds);
    }
  }

  function handleSubmenuClick(e: React.MouseEvent, href?: string) {
    e.stopPropagation();
    onClick(module.id);
    if (href) router.push(href);
  }

  return (
    <motion.div
      layout
      layoutId={module.id}
      transition={{ type: 'spring', stiffness: 300, damping: 28 }}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={() => onClick(module.id)}
      className={cn(
        'relative cursor-pointer rounded-3xl border p-4 transition-colors bg-gradient-to-br',
        heat === 'hot' && 'from-white to-indigo-50/60 border-indigo-400 shadow-[0_0_0_1px_rgba(99,102,241,0.35),0_10px_30px_-10px_rgba(99,102,241,0.45)]',
        heat === 'warm' && 'from-white to-indigo-50/30 border-indigo-200 shadow-sm',
        heat === 'neutral' && 'from-white to-gray-50/50 border-gray-200'
      )}
    >
      {heat === 'hot' && (
        <motion.div
          className="pointer-events-none absolute inset-0 rounded-3xl border-2 border-indigo-400"
          animate={{ opacity: [0.5, 0.15, 0.5] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}

      <div className="flex items-start justify-between">
        <div
          className={cn(
            'flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br shadow-sm',
            heat === 'hot' ? 'from-indigo-500 to-violet-600 text-white shadow-[0_4px_14px_-2px_rgba(99,102,241,0.5)]' : 'from-indigo-50 to-violet-50 text-indigo-600'
          )}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div className="flex items-center gap-1.5">
          {rankChange !== 0 && (
            <motion.span
              key={`${module.id}-${module.rank}`}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className={cn(
                'flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                rankChange > 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-500'
              )}
            >
              {rankChange > 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
              {Math.abs(rankChange)}
            </motion.span>
          )}
          {heat === 'hot' && (
            <span className="flex items-center gap-1 rounded-full bg-indigo-600 px-2 py-0.5 text-[10px] font-semibold text-white">
              <Sparkles className="h-3 w-3" /> AI
            </span>
          )}
        </div>
      </div>

      <h3 className="mt-3 text-sm font-semibold text-gray-900">{module.title}</h3>
      <p className="mt-0.5 text-xs text-gray-500">{module.description}</p>

      {module.matchedSubmenu && (
        <motion.span
          initial={{ opacity: 0, y: -2 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-2 inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-600"
        >
          <Search className="h-2.5 w-2.5" />
          Matched: {module.matchedSubmenu.label}
        </motion.span>
      )}

      <div className="mt-3 flex items-center justify-between text-[11px] text-gray-500">
        <span>Usage score: <strong className="text-gray-700">{module.score}</strong></span>
        <span>{formatLastAccessed(module.lastAccessed)}</span>
      </div>

      <div className="mt-2">
        <div className="flex items-center justify-between text-[11px] text-gray-500 mb-1">
          <span>AI confidence</span>
          <span className="font-medium text-indigo-600">{module.confidence}%</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
          <motion.div
            className={cn('h-full rounded-full bg-gradient-to-r', heat === 'hot' ? 'from-indigo-500 to-violet-600' : 'from-indigo-300 to-violet-300')}
            initial={false}
            animate={{ width: `${module.confidence}%` }}
            transition={{ type: 'spring', stiffness: 120, damping: 20 }}
          />
        </div>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="mt-3 border-t border-gray-100 pt-3">
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-400">
                {module.matchedSubmenu ? 'Matched submenu' : 'Recent actions'}
              </p>
              <ul className="space-y-1">
                {module.submenus.map((item) => {
                  const isHighlighted = module.matchedSubmenu?.label === item.label;
                  return (
                    <li key={item.label}>
                      <button
                        onClick={(e) => handleSubmenuClick(e, item.href)}
                        className={cn(
                          'flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs transition-colors',
                          isHighlighted
                            ? 'bg-indigo-600 text-white font-medium shadow-sm'
                            : 'text-gray-600 hover:bg-gray-50'
                        )}
                      >
                        <span className={cn('h-1 w-1 rounded-full flex-shrink-0', isHighlighted ? 'bg-white' : 'bg-indigo-400')} />
                        <span className="flex-1">{item.label}</span>
                        {!item.href && (
                          <span className={cn('text-[9px]', isHighlighted ? 'text-indigo-100' : 'text-gray-400')}>
                            preview
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
