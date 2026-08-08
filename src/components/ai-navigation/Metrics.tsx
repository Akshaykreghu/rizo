'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Gauge, Target, MousePointerClick, GraduationCap } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MetricsProps {
  navigationEfficiency: number;
  predictionAccuracy: number;
  clicksSaved: number;
  modulesLearned: number;
}

function AnimatedNumber({ value, suffix = '' }: { value: number; suffix?: string }) {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    const start = display;
    const delta = value - start;
    if (delta === 0) return;
    const duration = 500;
    const startTime = performance.now();

    let frame: number;
    function tick(now: number) {
      const progress = Math.min(1, (now - startTime) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(start + delta * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <span>
      {display}
      {suffix}
    </span>
  );
}

const TILES = (m: MetricsProps) => [
  { label: 'Navigation Efficiency', value: m.navigationEfficiency, suffix: '%', icon: Gauge, from: 'from-indigo-500', to: 'to-violet-600' },
  { label: 'Prediction Accuracy', value: m.predictionAccuracy, suffix: '%', icon: Target, from: 'from-sky-500', to: 'to-indigo-600' },
  { label: 'Clicks Saved', value: m.clicksSaved, suffix: '', icon: MousePointerClick, from: 'from-emerald-500', to: 'to-teal-600' },
  { label: 'Modules Learned', value: m.modulesLearned, suffix: '/8', icon: GraduationCap, from: 'from-amber-500', to: 'to-orange-600' },
];

export function Metrics(props: MetricsProps) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {TILES(props).map((tile, i) => {
        const Icon = tile.icon;
        return (
          <motion.div
            key={tile.label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="rounded-2xl border border-gray-200 bg-gradient-to-br from-white to-gray-50/60 p-4"
          >
            <div className="flex items-center gap-2">
              <div className={cn('flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br text-white', tile.from, tile.to)}>
                <Icon className="h-3.5 w-3.5" />
              </div>
              <span className="text-[11px] font-medium uppercase tracking-wide text-gray-500">{tile.label}</span>
            </div>
            <p className="mt-2.5 text-2xl font-semibold text-gray-900">
              <AnimatedNumber value={tile.value} suffix={tile.suffix} />
            </p>
          </motion.div>
        );
      })}
    </div>
  );
}
