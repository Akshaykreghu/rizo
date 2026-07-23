'use client';

import { useQuery, useMutation } from '@tanstack/react-query';
import { useState, useEffect } from 'react';

interface CompanyInfo {
  business_name?: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  phone?: string;
  email?: string;
  website?: string;
}

export default function CompanyProfilePage() {
  const [form, setForm] = useState<CompanyInfo>({});
  const [saved, setSaved] = useState(false);

  const { data, isLoading } = useQuery<CompanyInfo>({
    queryKey: ['company'],
    queryFn: () => fetch('/api/company').then((r) => r.json()),
  });

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const save = useMutation({
    mutationFn: () =>
      fetch('/api/company', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      }).then((r) => r.json()),
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  function field(key: keyof CompanyInfo, label: string, placeholder?: string) {
    return (
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
        <input
          type="text"
          placeholder={placeholder}
          value={form[key] ?? ''}
          onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>
    );
  }

  if (isLoading) return <div className="text-gray-500 text-sm">Loading...</div>;

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Company Profile</h1>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
        className="bg-white rounded-xl border border-gray-200 p-6 space-y-4 max-w-2xl"
      >
        {field('business_name', 'Company Name')}
        {field('address', 'Address')}
        <div className="grid grid-cols-2 gap-4">
          {field('city', 'City')}
          {field('state', 'State')}
        </div>
        <div className="grid grid-cols-2 gap-4">
          {field('pincode', 'Pincode')}
          {field('phone', 'Phone')}
        </div>
        {field('email', 'Email')}
        {field('website', 'Website')}

        <div className="flex items-center gap-4 pt-2">
          <button
            type="submit"
            disabled={save.isPending}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            {save.isPending ? 'Saving…' : 'Save Changes'}
          </button>
          {saved && <span className="text-green-600 text-sm">Saved successfully.</span>}
        </div>
      </form>
    </div>
  );
}
