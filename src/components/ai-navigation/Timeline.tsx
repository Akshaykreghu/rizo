'use client';

import { motion } from 'framer-motion';
import { MousePointerClick, BrainCircuit, LayoutGrid, ArrowRight } from 'lucide-react';
import type { InteractionEvent } from '@/hooks/useNavigationAI';

interface TimelineProps {
  events: InteractionEvent[];
  pipelineKey: number;
}

const STAGES = [
  { label: 'Interaction', icon: MousePointerClick },
  { label: 'AI Analysis', icon: BrainCircuit },
  { label: 'Navigation Updated', icon: LayoutGrid },
];

export function Timeline({ events, pipelineKey }: TimelineProps) {
  const latest = events[0];

  return (
    <div className="rounded-3xl border border-gray-200 bg-gradient-to-br from-white to-gray-50/60 p-5">
      <h2 className="text-sm font-semibold text-gray-900">Learning Timeline</h2>

      <motion.div key={pipelineKey} className="mt-4 flex items-center justify-between">
        {STAGES.map((stage, i) => {
          const Icon = stage.icon;
          return (
            <div key={stage.label} className="flex flex-1 items-center">
              <div className="flex flex-col items-center gap-1.5">
                <motion.div
                  initial={{ scale: 0.7, opacity: 0.4 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: i * 0.25, type: 'spring', stiffness: 250, damping: 18 }}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-[0_4px_14px_-2px_rgba(99,102,241,0.5)]"
                >
                  <Icon className="h-4 w-4" />
                </motion.div>
                <span className="text-[10px] font-medium text-gray-500 text-center w-20">{stage.label}</span>
              </div>
              {i < STAGES.length - 1 && (
                <motion.div
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ delay: i * 0.25 + 0.15, duration: 0.3 }}
                  style={{ transformOrigin: 'left' }}
                  className="mx-1 mb-4 h-px flex-1 bg-gradient-to-r from-indigo-300 to-violet-200"
                />
              )}
            </div>
          );
        })}
      </motion.div>

      <div className="mt-5 space-y-2">
        {events.length === 0 && (
          <p className="text-xs text-gray-400">Interact with a card or search to see AI learning in action.</p>
        )}
        {events.map((event, index) => (
          <motion.div
            key={event.id}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex items-center gap-2 text-xs text-gray-500"
          >
            <ArrowRight className="h-3 w-3 flex-shrink-0 text-gray-300" />
            <span className={index === 0 ? 'text-gray-700 font-medium' : ''}>{event.label}</span>
          </motion.div>
        ))}
      </div>

      {latest && (
        <p className="mt-1 text-[10px] text-gray-400">
          Last updated {new Date(latest.timestamp).toLocaleTimeString()}
        </p>
      )}
    </div>
  );
}
