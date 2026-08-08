'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { Brain, Sparkles } from 'lucide-react';
import type { RankedModule } from '@/hooks/useNavigationAI';

interface AIInsightsProps {
  modules: RankedModule[];
  explanation: string;
}

export function AIInsights({ modules, explanation }: AIInsightsProps) {
  const top = modules.slice(0, 3);

  return (
    <div className="rounded-3xl border border-gray-200 bg-gradient-to-br from-white to-indigo-50/40 p-5">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-[0_4px_14px_-2px_rgba(99,102,241,0.5)]">
          <Brain className="h-4 w-4" />
        </div>
        <h2 className="text-sm font-semibold text-gray-900">AI Navigation Assistant</h2>
      </div>

      <AnimatePresence mode="wait">
        <motion.p
          key={explanation}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className="mt-3 rounded-xl bg-gradient-to-br from-indigo-50 to-violet-50 border border-indigo-100 px-3 py-2.5 text-xs leading-relaxed text-indigo-800"
        >
          {explanation}
        </motion.p>
      </AnimatePresence>

      <div className="mt-4 space-y-3">
        {top.map((module, index) => (
          <motion.div
            key={module.id}
            layout
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.05 }}
            className="rounded-xl border border-gray-100 bg-white/60 p-3"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-800">
                #{index + 1} {module.title}
              </span>
              {index === 0 && (
                <span className="flex items-center gap-1 text-[10px] font-medium text-indigo-600">
                  <Sparkles className="h-3 w-3" /> Top pick
                </span>
              )}
            </div>
            <ul className="mt-1.5 space-y-0.5">
              {module.reasons.map((reason) => (
                <li key={reason} className="text-[11px] text-gray-500">
                  • {reason}
                </li>
              ))}
            </ul>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
