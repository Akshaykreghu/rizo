'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Check, Upload, Image as ImageIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useHeaderSlot } from '@/components/layout/HeaderSlotContext';
import {
  panError,
  tanError,
  cinError,
  pincodeError,
  emailError,
  websiteError,
  landlinePhoneError,
} from '@/lib/validation';

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

const TABS = [
  { value: 'profile' as const, label: 'Profile' },
  { value: 'compliance' as const, label: 'Statutory & Compliance' },
];

const LABEL_CLASS = 'block text-[13px] font-medium text-slate-600 mb-1.5';
const INPUT_BASE =
  'w-full px-3.5 py-2.5 rounded-lg border text-sm text-[#0F172A] bg-white transition-colors duration-150 focus:outline-none focus:ring-2 placeholder:text-slate-400';
const INPUT_NORMAL =
  'border-slate-200 hover:border-slate-300 focus:border-[color:var(--color-primary)]/60 focus:ring-[color:var(--color-primary)]/25';
const INPUT_ERROR =
  'border-[color:var(--color-danger)]/60 focus:border-[color:var(--color-danger)] focus:ring-[color:var(--color-danger)]/20';
const PRIMARY_BUTTON_CLASS =
  'inline-flex items-center px-5 py-2.5 rounded-lg text-sm font-semibold bg-[color:var(--color-primary)] text-white shadow-sm hover:bg-[color:var(--color-primary-dark)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-150';

/** Blank out legacy sentinel values ("0", "0.00") so inputs show a placeholder instead. */
function clean(v: unknown): string {
  if (v == null) return '';
  const s = String(v).trim();
  return s === '0' || s === '0.00' ? '' : String(v);
}

function SavedNote({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span className="flex items-center gap-1.5 text-sm font-medium text-[color:var(--color-success)]">
      <Check className="w-4 h-4" strokeWidth={2.5} />
      Saved successfully
    </span>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-[12px] font-semibold uppercase tracking-wide text-slate-400 pb-2 mb-4 border-b border-slate-100">
        {title}
      </h2>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

interface TextFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  required?: boolean;
  error?: string;
  /** Show the error / success affordance (typically once the field has been touched or Save attempted). */
  showState?: boolean;
  /** True for fields with a format check — enables the green success tick. */
  hasValidator?: boolean;
  type?: string;
}

function TextField({
  label,
  value,
  onChange,
  onBlur,
  placeholder,
  required,
  error,
  showState,
  hasValidator,
  type = 'text',
}: TextFieldProps) {
  const invalid = !!showState && !!error;
  const valid = !!showState && !!hasValidator && !error && value.trim() !== '';
  return (
    <div>
      <label className={LABEL_CLASS}>
        {label}
        {required && <span className="text-[color:var(--color-danger)]"> *</span>}
      </label>
      <div className="relative">
        <input
          type={type}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          className={cn(INPUT_BASE, invalid ? INPUT_ERROR : INPUT_NORMAL, valid && 'pr-9')}
        />
        {valid && (
          <Check className="w-4 h-4 text-[color:var(--color-success)] absolute right-3 top-1/2 -translate-y-1/2" />
        )}
      </div>
      {invalid && <p className="text-[11.5px] text-[color:var(--color-danger)] mt-1">{error}</p>}
    </div>
  );
}

interface LogoUploadFieldProps {
  value: string;
  onChange: (path: string) => void;
}

function LogoUploadField({ value, onChange }: LogoUploadFieldProps) {
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState('');

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!/(png|jpe?g|svg\+xml)$/i.test(file.type)) {
      setErr('Use a PNG, JPG or SVG file.');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setErr('File must be 2 MB or smaller.');
      return;
    }
    setErr('');
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      if (!res.ok) throw new Error('Upload failed');
      const data = await res.json();
      onChange(data.path);
    } catch {
      setErr('Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <label className={LABEL_CLASS}>Company Logo</label>
      <div className="flex items-center gap-4">
        <div className="w-16 h-16 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden flex-shrink-0">
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt="Company logo" className="w-full h-full object-contain" />
          ) : (
            <ImageIcon className="w-5 h-5 text-slate-300" />
          )}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-[13px] font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50 cursor-pointer transition-colors duration-150">
              <Upload className="w-3.5 h-3.5" />
              {uploading ? 'Uploading…' : value ? 'Change logo' : 'Upload logo'}
              <input
                type="file"
                accept="image/png,image/jpeg,image/svg+xml"
                className="hidden"
                onChange={handleFile}
                disabled={uploading}
              />
            </label>
            {value && !uploading && (
              <button
                type="button"
                onClick={() => onChange('')}
                className="text-[13px] text-slate-400 hover:text-[color:var(--color-danger)] transition-colors duration-150"
              >
                Remove
              </button>
            )}
          </div>
          <p className="text-[11.5px] text-slate-400 mt-1.5">PNG, JPG or SVG · up to 2 MB</p>
          {err && <p className="text-[11.5px] text-[color:var(--color-danger)] mt-1">{err}</p>}
        </div>
      </div>
    </div>
  );
}

export default function CompanyProfilePage() {
  const queryClient = useQueryClient();
  const { slotEl } = useHeaderSlot();
  const [tab, setTab] = useState<'profile' | 'compliance'>('profile');
  const [form, setForm] = useState<CompanyInfo>({});
  const [complianceForm, setComplianceForm] = useState<ComplianceInfo>({});
  const [saved, setSaved] = useState(false);
  const [complianceSaved, setComplianceSaved] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [attempted, setAttempted] = useState(false);
  const [cTouched, setCTouched] = useState<Record<string, boolean>>({});
  const [cAttempted, setCAttempted] = useState(false);

  const { data, isLoading } = useQuery<CompanyInfo>({
    queryKey: ['company'],
    queryFn: () => fetch('/api/company').then((r) => r.json()),
  });

  const { data: compliance, isLoading: complianceLoading } = useQuery<ComplianceInfo>({
    queryKey: ['setup/compliance'],
    queryFn: () => fetch('/api/setup/compliance').then((r) => r.json()),
  });

  useEffect(() => {
    if (!data) return;
    setForm({
      business_name: clean(data.business_name),
      business_type: clean(data.business_type),
      business_nature: clean(data.business_nature),
      address: clean(data.address),
      city: clean(data.city),
      state: clean(data.state),
      pincode: clean(data.pincode),
      phone: clean(data.phone),
      email: clean(data.email),
      website: clean(data.website),
      logo: clean(data.logo),
    });
  }, [data]);

  useEffect(() => {
    if (!compliance) return;
    setComplianceForm({
      cin_no: clean(compliance.cin_no),
      pan_no: clean(compliance.pan_no),
      service_tax: clean(compliance.service_tax),
      tan_no: clean(compliance.tan_no),
      pf_no: clean(compliance.pf_no),
      emp_state_ins_no: clean(compliance.emp_state_ins_no),
      pt_no_co: clean(compliance.pt_no_co),
      pt_no_dir: clean(compliance.pt_no_dir),
      pt_no_emp: clean(compliance.pt_no_emp),
    });
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

  const p = (key: keyof CompanyInfo) => ({
    value: form[key] ?? '',
    onChange: (v: string) => setForm((f) => ({ ...f, [key]: v })),
    onBlur: () => setTouched((t) => ({ ...t, [key]: true })),
  });
  const c = (key: keyof ComplianceInfo) => ({
    value: complianceForm[key] ?? '',
    onChange: (v: string) => setComplianceForm((f) => ({ ...f, [key]: v })),
    onBlur: () => setCTouched((t) => ({ ...t, [key]: true })),
  });

  const profileErrors: Record<string, string> = {
    business_name: (form.business_name ?? '').trim() ? '' : 'Company name is required',
    pincode: pincodeError(form.pincode ?? '') ?? '',
    phone: landlinePhoneError(form.phone ?? '') ?? '',
    email: emailError(form.email ?? '') ?? '',
    website: websiteError(form.website ?? '') ?? '',
  };
  const hasProfileErrors = Object.values(profileErrors).some(Boolean);

  const complianceErrors: Record<string, string> = {
    cin_no: cinError(complianceForm.cin_no ?? '') ?? '',
    pan_no: panError(complianceForm.pan_no ?? '') ?? '',
    tan_no: tanError(complianceForm.tan_no ?? '') ?? '',
  };
  const hasComplianceErrors = Object.values(complianceErrors).some(Boolean);

  function submitProfile(e: React.FormEvent) {
    e.preventDefault();
    setAttempted(true);
    if (hasProfileErrors) return;
    save.mutate();
  }

  function submitCompliance(e: React.FormEvent) {
    e.preventDefault();
    setCAttempted(true);
    if (hasComplianceErrors) return;
    saveCompliance.mutate();
  }

  return (
    <div>
      {/* Page title sits in the global Header row, left-aligned with this content, alongside the account controls. */}
      {slotEl &&
        createPortal(
          <div className="min-w-0">
            <h1 className="font-heading text-2xl font-bold text-[#0F172A] tracking-tight leading-tight truncate">
              Company Profile
            </h1>
            <p className="text-sm text-[#64748B] mt-0.5 truncate">
              Your organisation&apos;s registration and statutory details
            </p>
          </div>,
          slotEl
        )}

      <div className="sticky top-0 z-20 glass-card-strong rounded-2xl px-3 py-2.5 flex items-center mb-5">
        <div className="flex items-center gap-1 text-sm bg-slate-900/[0.03] rounded-xl p-1">
          {TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => setTab(t.value)}
              className={cn(
                'px-3.5 py-1.5 rounded-lg transition-all duration-[180ms] font-medium border',
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

      {tab === 'profile' &&
        (isLoading ? (
          <div className="text-slate-500 text-sm">Loading…</div>
        ) : (
          <form onSubmit={submitProfile} className="glass-card rounded-2xl p-6 sm:p-7 space-y-8 max-w-3xl">
            <Section title="Basic Information">
              <LogoUploadField value={form.logo ?? ''} onChange={(path) => setForm((f) => ({ ...f, logo: path }))} />
              <TextField
                label="Company Name"
                required
                placeholder="Registered legal name"
                error={profileErrors.business_name}
                showState={touched.business_name || attempted}
                {...p('business_name')}
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4">
                <TextField label="Type of Business" placeholder="e.g. Private Limited" {...p('business_type')} />
                <TextField label="Nature of Business" placeholder="e.g. IT Services" {...p('business_nature')} />
              </div>
            </Section>

            <Section title="Address">
              <TextField label="Address" placeholder="Street address" {...p('address')} />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4">
                <TextField label="City" placeholder="City" {...p('city')} />
                <TextField label="State" placeholder="State" {...p('state')} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4">
                <TextField
                  label="Pincode"
                  placeholder="6-digit PIN code"
                  hasValidator
                  error={profileErrors.pincode}
                  showState={touched.pincode || attempted}
                  {...p('pincode')}
                />
                <TextField
                  label="Phone"
                  placeholder="Landline or mobile number"
                  hasValidator
                  error={profileErrors.phone}
                  showState={touched.phone || attempted}
                  {...p('phone')}
                />
              </div>
            </Section>

            <Section title="Contact Information">
              <TextField
                label="Email"
                type="email"
                placeholder="name@company.com"
                hasValidator
                error={profileErrors.email}
                showState={touched.email || attempted}
                {...p('email')}
              />
              <TextField
                label="Website"
                placeholder="https://example.com"
                hasValidator
                error={profileErrors.website}
                showState={touched.website || attempted}
                {...p('website')}
              />
            </Section>

            <div className="flex items-center gap-4 pt-1">
              <button type="submit" disabled={save.isPending || hasProfileErrors} className={PRIMARY_BUTTON_CLASS}>
                {save.isPending ? 'Saving…' : 'Save Changes'}
              </button>
              <SavedNote show={saved} />
            </div>
          </form>
        ))}

      {tab === 'compliance' &&
        (complianceLoading ? (
          <div className="text-slate-500 text-sm">Loading…</div>
        ) : (
          <form onSubmit={submitCompliance} className="glass-card rounded-2xl p-6 sm:p-7 space-y-8 max-w-3xl">
            <Section title="Company Registration">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4">
                <TextField
                  label="CIN Number"
                  placeholder="L12345MH2000PLC123456"
                  hasValidator
                  error={complianceErrors.cin_no}
                  showState={cTouched.cin_no || cAttempted}
                  {...c('cin_no')}
                />
                <TextField
                  label="PAN Number"
                  placeholder="ABCDE1234F"
                  hasValidator
                  error={complianceErrors.pan_no}
                  showState={cTouched.pan_no || cAttempted}
                  {...c('pan_no')}
                />
              </div>
            </Section>

            <Section title="Tax & Statutory Registrations">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4">
                <TextField
                  label="TAN Number"
                  placeholder="ABCD12345E"
                  hasValidator
                  error={complianceErrors.tan_no}
                  showState={cTouched.tan_no || cAttempted}
                  {...c('tan_no')}
                />
                <TextField label="Service Tax Number" placeholder="Service tax registration no." {...c('service_tax')} />
                <TextField label="PF Number" placeholder="PF establishment code" {...c('pf_no')} />
                <TextField label="ESI Number" placeholder="ESI registration no." {...c('emp_state_ins_no')} />
              </div>
            </Section>

            <Section title="Professional Tax">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-5 gap-y-4">
                <TextField label="Professional Tax Number — Company" placeholder="PT registration no." {...c('pt_no_co')} />
                <TextField label="Professional Tax Number — Director" placeholder="PT registration no." {...c('pt_no_dir')} />
                <TextField label="Professional Tax Number — Employee" placeholder="PT registration no." {...c('pt_no_emp')} />
              </div>
            </Section>

            <div className="flex items-center gap-4 pt-1">
              <button
                type="submit"
                disabled={saveCompliance.isPending || hasComplianceErrors}
                className={PRIMARY_BUTTON_CLASS}
              >
                {saveCompliance.isPending ? 'Saving…' : 'Save Changes'}
              </button>
              <SavedNote show={complianceSaved} />
            </div>
          </form>
        ))}
    </div>
  );
}
