'use client';

import { Search } from 'lucide-react';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
}

export function SearchBar({ value, onChange }: SearchBarProps) {
  return (
    <div className="relative w-full max-w-md group">
      <div className="pointer-events-none absolute -inset-0.5 rounded-full bg-gradient-to-r from-indigo-400 to-violet-400 opacity-0 blur transition-opacity duration-300 group-focus-within:opacity-40" />
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-indigo-400" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder='Try "payslip", "leave balance", or "pay"...'
        className="relative w-full rounded-full border border-gray-300 bg-white py-2.5 pl-9 pr-4 text-sm text-gray-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
      />
    </div>
  );
}
