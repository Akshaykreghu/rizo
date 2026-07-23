'use client';

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';

interface EmployeeOption {
  emp_pkey: number;
  first_name: string;
  last_name: string;
  emp_id: string;
}

interface EmployeeSearchProps {
  value: string;
  onChange: (empPkey: string) => void;
  placeholder?: string;
}

export function EmployeeSearch({ value, onChange, placeholder }: EmployeeSearchProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState('');

  const { data } = useQuery<{ data: EmployeeOption[] }>({
    queryKey: ['employees', 'search', query],
    queryFn: () => fetch(`/api/employees?search=${encodeURIComponent(query)}&pageSize=10`).then((r) => r.json()),
    enabled: query.length > 1,
  });

  useEffect(() => {
    if (!value) setSelectedLabel('');
  }, [value]);

  const options = data?.data ?? [];

  return (
    <div className="relative">
      <input
        type="text"
        value={open ? query : selectedLabel}
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
                onChange(String(emp.emp_pkey));
                setSelectedLabel(`${emp.first_name} ${emp.last_name} (${emp.emp_id})`);
                setOpen(false);
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
