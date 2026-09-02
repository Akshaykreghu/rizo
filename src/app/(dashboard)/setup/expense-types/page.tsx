'use client';

import { createPortal } from 'react-dom';
import { SetupCrudPage } from '@/components/setup/SetupCrudPage';
import { useHeaderSlot } from '@/components/layout/HeaderSlotContext';

export default function ExpenseTypesPage() {
  const { slotEl } = useHeaderSlot();

  return (
    <div>
      {slotEl &&
        createPortal(
          <div className="min-w-0">
            <h1 className="font-heading text-2xl font-bold text-[#0F172A] tracking-tight leading-tight truncate">
              Expense Types
            </h1>
            <p className="text-sm text-[#64748B] mt-0.5 truncate">
              Manage employee expense claim categories
            </p>
          </div>,
          slotEl
        )}

      <SetupCrudPage
        hideTitle
        title="Expense Types"
        apiPath="setup/expense-types"
        primaryKey="expense_type_pkey"
        displayKey="expense_type_name"
        fields={[
          { key: 'expense_type_name', label: 'Expense Type Name', required: true, placeholder: 'e.g. Travelling Allowance' },
          { key: 'expense_type_code', label: 'Code', placeholder: 'e.g. TA' },
        ]}
        columns={[
          { key: 'expense_type_code', label: 'Code' },
          { key: 'expense_type_name', label: 'Name' },
        ]}
      />
    </div>
  );
}
