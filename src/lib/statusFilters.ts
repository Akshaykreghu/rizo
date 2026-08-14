/** Shared employee status filter options — Active/Inactive/Resigned — with their brand-token selected-state styling. */
export const STATUS_FILTERS = [
  { value: '1', label: 'Active', selectedClass: 'bg-[color:var(--color-success-light)] text-[color:var(--color-success-dark)]' },
  { value: '0', label: 'Inactive', selectedClass: 'bg-slate-50 text-slate-500' },
  { value: '2', label: 'Resigned', selectedClass: 'bg-[color:var(--color-danger-light)] text-[color:var(--color-danger-dark)]' },
] as const;
