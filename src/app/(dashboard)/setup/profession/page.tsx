'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { useHeaderSlot } from '@/components/layout/HeaderSlotContext';
import { SetupCrudPage } from '@/components/setup/SetupCrudPage';
import {
  DEPARTMENT_FIELDS,
  DEPARTMENT_COLUMNS,
  DESIGNATION_FIELDS,
  DESIGNATION_COLUMNS,
  GRADE_FIELDS,
  GRADE_COLUMNS,
  NOTICE_PERIOD_FIELDS,
  NOTICE_PERIOD_COLUMNS,
  DIVISION_FIELDS,
  DIVISION_COLUMNS,
  SECTION_FIELDS,
  SECTION_COLUMNS,
} from '@/lib/setupFieldConfigs';

const TABS = [
  { value: 'departments' as const, label: 'Departments' },
  { value: 'designations' as const, label: 'Designations' },
  { value: 'grades' as const, label: 'Grades' },
  { value: 'notice-periods' as const, label: 'Notice Period' },
  { value: 'divisions' as const, label: 'Division' },
  { value: 'sections' as const, label: 'Section' },
];
type Tab = (typeof TABS)[number]['value'];

export default function ProfessionPage() {
  const { slotEl } = useHeaderSlot();
  const [tab, setTab] = useState<Tab>('departments');

  return (
    <div>
      {/* Page title sits in the global Header row, left-aligned with this content, alongside the account controls. */}
      {slotEl &&
        createPortal(
          <div className="min-w-0">
            <h1 className="font-heading text-2xl font-bold text-[#0F172A] tracking-tight leading-tight truncate">
              Profession
            </h1>
            <p className="text-sm text-[#64748B] mt-0.5 truncate">
              Departments, designations, grades and other role classifications
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

      {tab === 'departments' && (
        <SetupCrudPage
          hideTitle
          title="Departments"
          apiPath="setup/departments"
          primaryKey="id"
          displayKey="dept_name"
          fields={DEPARTMENT_FIELDS}
          columns={DEPARTMENT_COLUMNS}
        />
      )}

      {tab === 'designations' && (
        <SetupCrudPage
          hideTitle
          title="Designations"
          apiPath="setup/designations"
          primaryKey="id"
          displayKey="desig_name"
          fields={DESIGNATION_FIELDS}
          columns={DESIGNATION_COLUMNS}
        />
      )}

      {tab === 'grades' && (
        <SetupCrudPage
          hideTitle
          title="Grades"
          apiPath="setup/grades"
          primaryKey="grade_pkey"
          displayKey="grade_name"
          fields={GRADE_FIELDS}
          columns={GRADE_COLUMNS}
        />
      )}

      {tab === 'notice-periods' && (
        <SetupCrudPage
          hideTitle
          title="Notice Period"
          apiPath="setup/notice-periods"
          primaryKey="notice_pkey"
          displayKey="description"
          fields={NOTICE_PERIOD_FIELDS}
          columns={NOTICE_PERIOD_COLUMNS}
        />
      )}

      {tab === 'divisions' && (
        <SetupCrudPage
          hideTitle
          title="Division"
          apiPath="setup/divisions"
          primaryKey="id"
          displayKey="div_name"
          fields={DIVISION_FIELDS}
          columns={DIVISION_COLUMNS}
        />
      )}

      {tab === 'sections' && (
        <SetupCrudPage
          hideTitle
          title="Section"
          apiPath="setup/sections"
          primaryKey="id"
          displayKey="section_name"
          fields={SECTION_FIELDS}
          columns={SECTION_COLUMNS}
        />
      )}
    </div>
  );
}
