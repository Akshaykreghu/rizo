'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { SetupCrudPage } from '@/components/setup/SetupCrudPage';
import { cn } from '@/lib/utils';
import { useHeaderSlot } from '@/components/layout/HeaderSlotContext';

interface Branch {
  branch_code: string;
  branch_name: string;
}

interface HolidayGroup {
  HOLIDAY_GROUP_ID: number;
  HOLIDAY_GROUP_NAME: string;
}

const TABS = [
  { value: 'groups' as const, label: 'Holiday Groups' },
  { value: 'holidays' as const, label: 'Holidays' },
];
type Tab = (typeof TABS)[number]['value'];

const INPUT_CLASS =
  'border border-slate-200 bg-white rounded-[9px] px-2.5 py-1.5 text-[12.5px] text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/25 focus:border-[color:var(--color-primary)] transition-colors';

export default function HolidaysPage() {
  const { slotEl } = useHeaderSlot();
  const [tab, setTab] = useState<Tab>('groups');
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);

  const { data: branches = [] } = useQuery<Branch[]>({
    queryKey: ['setup/branches'],
    queryFn: () => fetch('/api/setup/branches').then((r) => r.json()),
  });

  const { data: groups = [] } = useQuery<HolidayGroup[]>({
    queryKey: ['setup/holiday-groups'],
    queryFn: () => fetch('/api/setup/holiday-groups').then((r) => r.json()),
  });

  const activeGroupId = selectedGroupId ?? groups[0]?.HOLIDAY_GROUP_ID ?? null;

  const groupSelect = (
    <select
      value={activeGroupId ?? ''}
      onChange={(e) => setSelectedGroupId(Number(e.target.value))}
      className={INPUT_CLASS}
    >
      {groups.map((g) => (
        <option key={g.HOLIDAY_GROUP_ID} value={g.HOLIDAY_GROUP_ID}>
          {g.HOLIDAY_GROUP_NAME}
        </option>
      ))}
    </select>
  );

  return (
    <div>
      {slotEl &&
        createPortal(
          <div className="min-w-0">
            <h1 className="font-heading text-2xl font-bold text-[#0F172A] tracking-tight leading-tight truncate">
              Holidays
            </h1>
            <p className="text-sm text-[#64748B] mt-0.5 truncate">
              Holiday groups and the company holiday calendar
            </p>
          </div>,
          slotEl
        )}

      <div className="sticky top-0 z-20 glass-card-strong rounded-xl px-3 py-2 flex items-center mb-5">
        <div className="flex items-center gap-1 flex-wrap text-[12.5px] bg-slate-900/[0.03] rounded-lg p-0.5">
          {TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => setTab(t.value)}
              className={cn(
                'px-3 py-1 rounded-md transition-all duration-[180ms] font-medium border whitespace-nowrap',
                tab === t.value
                  ? 'bg-[color:var(--color-primary-light)] text-[color:var(--color-primary)] border-[color:var(--color-primary)]/30'
                  : 'bg-white text-slate-500 border-transparent hover:bg-white/70'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'groups' && (
        <SetupCrudPage
          hideTitle
          title="Holiday Groups"
          apiPath="setup/holiday-groups"
          primaryKey="HOLIDAY_GROUP_ID"
          displayKey="HOLIDAY_GROUP_NAME"
          fields={[
            { key: 'HOLIDAY_GROUP_NAME', label: 'Group Name', required: true },
            {
              key: 'BRANCH_CODE',
              label: 'Branch',
              type: 'select',
              options: branches.map((b) => ({ value: b.branch_code, label: b.branch_name })),
            },
          ]}
          columns={[
            { key: 'HOLIDAY_GROUP_NAME', label: 'Group Name' },
            { key: 'BRANCH_CODE', label: 'Branch' },
          ]}
        />
      )}

      {tab === 'holidays' && (
        groups.length === 0 ? (
          <p className="text-[12.5px] text-slate-400">Create a Holiday Group first, on the &quot;Holiday Groups&quot; tab.</p>
        ) : (
          activeGroupId && (
            <SetupCrudPage
              hideTitle
              title="Holidays"
              apiPath="setup/holidays"
              queryParams={{ groupId: String(activeGroupId) }}
              primaryKey="HOLIDAYID"
              displayKey="HOLIDAYNAME"
              headerExtra={groupSelect}
              fields={[
                { key: 'HOLIDAYNAME', label: 'Holiday Name', required: true },
                { key: 'HOLIDAYDATE', label: 'Date', type: 'date', required: true },
                { key: 'DESCRIPTION', label: 'Description', required: true },
              ]}
              columns={[
                { key: 'HOLIDAYNAME', label: 'Name' },
                { key: 'HOLIDAYDATE', label: 'Date' },
                { key: 'DESCRIPTION', label: 'Description' },
              ]}
            />
          )
        )
      )}
    </div>
  );
}
