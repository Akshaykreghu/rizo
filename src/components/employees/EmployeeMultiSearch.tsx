'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';

interface EmployeeOption {
  emp_pkey: number;
  first_name: string;
  last_name: string;
  emp_id: string;
}

interface Selected {
  empPkey: number;
  label: string;
}

interface EmployeeMultiSearchProps {
  value: Selected[];
  onChange: (value: Selected[]) => void;
  placeholder?: string;
}

// Multi-select counterpart to EmployeeSearch — for flows that add several employees to one
// action at once (e.g. Special Events Attendance's bulk add-to-date).
export function EmployeeMultiSearch({ value, onChange, placeholder }: EmployeeMultiSearchProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const { data } = useQuery<{ data: EmployeeOption[] }>({
    queryKey: ['employees', 'search', query],
    queryFn: () => fetch(`/api/employees?search=${encodeURIComponent(query)}&pageSize=10`).then((r) => r.json()),
    enabled: query.length > 1,
  });

  const selectedPkeys = new Set(value.map((v) => v.empPkey));
  const options = (data?.data ?? []).filter((emp) => !selectedPkeys.has(emp.emp_pkey));

  return (
    <div className="relative">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-1.5">
          {value.map((v) => (
            <span
              key={v.empPkey}
              className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full bg-[color:var(--color-primary-light)] text-[color:var(--color-primary-dark)] text-[11.5px] font-medium"
            >
              {v.label}
              <button
                type="button"
                onClick={() => onChange(value.filter((x) => x.empPkey !== v.empPkey))}
                className="p-0.5 rounded-full hover:bg-black/10"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        type="text"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder ?? 'Search employee by name or ID'}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
      {open && options.length > 0 && (
        <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
          {options.map((emp) => (
            <button
              key={emp.emp_pkey}
              type="button"
              onMouseDown={() => {
                onChange([...value, { empPkey: emp.emp_pkey, label: `${emp.first_name} ${emp.last_name} (${emp.emp_id})` }]);
                setQuery('');
              }}
              className="block w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
            >
              {emp.first_name} {emp.last_name} <span className="text-gray-400">({emp.emp_id})</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
