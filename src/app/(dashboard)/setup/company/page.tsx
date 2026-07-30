'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import { FileUploadField } from '@/components/employees/FileUploadField';

interface CompanyInfo {
  business_name?: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  phone?: string;
  email?: string;
  website?: string;
  business_nature?: string;
  business_type?: string;
  logo?: string;
}

interface ComplianceInfo {
  cin_no?: string;
  pan_no?: string;
  service_tax?: string;
  tan_no?: string;
  pf_no?: string;
  emp_state_ins_no?: string;
  pt_no_co?: string;
  pt_no_dir?: string;
  pt_no_emp?: string;
}

export default function CompanyProfilePage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<CompanyInfo>({});
  const [complianceForm, setComplianceForm] = useState<ComplianceInfo>({});
  const [saved, setSaved] = useState(false);
  const [complianceSaved, setComplianceSaved] = useState(false);

  const { data, isLoading } = useQuery<CompanyInfo>({
    queryKey: ['company'],
    queryFn: () => fetch('/api/company').then((r) => r.json()),
  });

  const { data: compliance, isLoading: complianceLoading } = useQuery<ComplianceInfo>({
    queryKey: ['setup/compliance'],
    queryFn: () => fetch('/api/setup/compliance').then((r) => r.json()),
  });

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  useEffect(() => {
    if (compliance) setComplianceForm(compliance);
  }, [compliance]);

  const save = useMutation({
    mutationFn: () =>
      fetch('/api/company', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['company'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  const saveCompliance = useMutation({
    mutationFn: () =>
      fetch('/api/setup/compliance', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(complianceForm),
      }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['setup/compliance'] });
      setComplianceSaved(true);
      setTimeout(() => setComplianceSaved(false), 2500);
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

  function complianceField(key: keyof ComplianceInfo, label: string) {
    return (
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
        <input
          type="text"
          value={complianceForm[key] ?? ''}
          onChange={(e) => setComplianceForm((f) => ({ ...f, [key]: e.target.value }))}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>
    );
  }

  if (isLoading) return <div className="text-gray-500 text-sm">Loading...</div>;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 mb-6">Company Profile</h1>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
          className="bg-white rounded-xl border border-gray-200 p-6 space-y-4 max-w-2xl"
        >
          <FileUploadField
            label="Company Logo"
            value={form.logo ?? ''}
            onChange={(path) => setForm((f) => ({ ...f, logo: path }))}
          />
          {field('business_name', 'Company Name')}
          <div className="grid grid-cols-2 gap-4">
            {field('business_type', 'Type of Business')}
            {field('business_nature', 'Nature of Business')}
          </div>
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

      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Statutory & Compliance</h2>
        {complianceLoading ? (
          <div className="text-gray-500 text-sm">Loading...</div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              saveCompliance.mutate();
            }}
            className="bg-white rounded-xl border border-gray-200 p-6 space-y-4 max-w-2xl"
          >
            <div className="grid grid-cols-2 gap-4">
              {complianceField('cin_no', 'CIN No')}
              {complianceField('pan_no', 'PAN No')}
            </div>
            <div className="grid grid-cols-2 gap-4">
              {complianceField('tan_no', 'TAN No')}
              {complianceField('service_tax', 'Service Tax No')}
            </div>
            <div className="grid grid-cols-2 gap-4">
              {complianceField('pf_no', 'PF No')}
              {complianceField('emp_state_ins_no', 'ESI No')}
            </div>
            <div className="grid grid-cols-3 gap-4">
              {complianceField('pt_no_co', 'Prof Tax No (Company)')}
              {complianceField('pt_no_dir', 'Prof Tax No (Director)')}
              {complianceField('pt_no_emp', 'Prof Tax No (Employee)')}
            </div>

            <div className="flex items-center gap-4 pt-2">
              <button
                type="submit"
                disabled={saveCompliance.isPending}
                className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                {saveCompliance.isPending ? 'Saving…' : 'Save Changes'}
              </button>
              {complianceSaved && <span className="text-green-600 text-sm">Saved successfully.</span>}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
