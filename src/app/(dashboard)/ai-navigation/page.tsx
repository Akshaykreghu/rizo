'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles } from 'lucide-react';
import { useNavigationAI } from '@/hooks/useNavigationAI';
import { NavigationCard } from '@/components/ai-navigation/NavigationCard';
import { SearchBar } from '@/components/ai-navigation/SearchBar';
import { AIInsights } from '@/components/ai-navigation/AIInsights';
import { Timeline } from '@/components/ai-navigation/Timeline';
import { Metrics } from '@/components/ai-navigation/Metrics';
import { DemoControls } from '@/components/ai-navigation/DemoControls';

export default function AiNavigationDemoPage() {
  const {
    modules,
    events,
    searchQuery,
    metrics,
    explanation,
    pipelineKey,
    registerClick,
    registerHover,
    registerSearch,
    applyPersona,
    reset,
    isReplaying,
    runReplay,
    cancelReplay,
    personas,
    formatLastAccessed,
  } = useNavigationAI();

  return (
    <div className="min-h-full relative px-6 py-6 overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(ellipse_80%_60%_at_50%_-10%,rgba(99,102,241,0.14),rgba(255,255,255,0))]"
      />
      <div className="mx-auto max-w-7xl relative">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2.5">
            <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-[0_6px_20px_-4px_rgba(99,102,241,0.55)]">
              <motion.span
                className="absolute inset-0 rounded-xl bg-gradient-to-br from-indigo-400 to-violet-500"
                animate={{ opacity: [0.6, 0, 0.6] }}
                transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
              />
              <Sparkles className="relative h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent">
                AI Navigation Demo
              </h1>
              <p className="text-xs text-gray-500">
                Proof of concept — navigation that learns from behaviour, in-memory only.
              </p>
            </div>
          </div>
          <span className="w-fit rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-medium text-amber-700 border border-amber-200">
            Demo only — does not affect the real application navigation
          </span>
        </div>

        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <DemoControls
            personas={personas}
            onSimulate={applyPersona}
            onReset={reset}
            isReplaying={isReplaying}
            onToggleReplay={isReplaying ? cancelReplay : runReplay}
          />
          <SearchBar value={searchQuery} onChange={registerSearch} />
        </div>

        <div className="mt-5">
          <Metrics {...metrics} />
        </div>

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_340px]">
          <div>
            <motion.div layout className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <AnimatePresence>
                {modules.map((module) => (
                  <NavigationCard
                    key={module.id}
                    module={module}
                    onClick={registerClick}
                    onHover={registerHover}
                    formatLastAccessed={formatLastAccessed}
                  />
                ))}
              </AnimatePresence>
            </motion.div>
          </div>

          <div className="flex flex-col gap-6">
            <AIInsights modules={modules} explanation={explanation} />
            <Timeline events={events} pipelineKey={pipelineKey} />
          </div>
        </div>
      </div>
    </div>
  );
}
