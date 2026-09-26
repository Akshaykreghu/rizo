// Field rules for the "Other Details" rows (education / experience / family / documents), shared
// by the Employee Join wizard, the Employee Details form, ESS About Me, and the API routes behind
// them — so a rule can't be skipped by calling the API directly.

export const FAMILY_GENDERS = ['Male', 'Female', 'Other'];

// Legacy View/Employee/addfamily.ctp + passport.ctp: both Family's and Documents' Relation field
// are a fixed <select> with this exact option list, not free text.
export const FAMILY_RELATIONS = ['Self', 'Mother', 'Father', 'Sister', 'Brother', 'Cousin', 'Spouse', 'Other'];

// Education marks are a percentage: 0–100, up to 2 decimals.
export function marksError(v: unknown): string | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(s) || Number(s) > 100) return 'Marks must be a percentage between 0 and 100';
  return null;
}

// Previous-job salary: whole number, digits only (legacy maxlength 10).
export function salaryError(v: unknown): string | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  return /^\d{1,10}$/.test(s) ? null : 'Salary must be a whole number (digits only, up to 10)';
}

// Family contact numbers: digits only, 10–15 (15 covers international numbers).
export function contactNumberError(v: unknown, label = 'Contact number'): string | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  return /^\d{10,15}$/.test(s) ? null : `${label} must be 10 to 15 digits`;
}

export function familyGenderError(v: unknown): string | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  return FAMILY_GENDERS.some((g) => g.toLowerCase() === s.toLowerCase()) ? null : 'Gender must be Male, Female or Other';
}

// Document numbers: letters and digits only — no spaces, dashes or other special characters.
export function documentNumberError(v: unknown): string | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  return /^[A-Za-z0-9]+$/.test(s) ? null : 'Document number can only contain letters and numbers (no spaces or special characters)';
}

// Input sanitizers for the forms: drop characters the rule would reject as they're typed.
// Legacy View/EmployeeJoin/setup.ctp + View/Employee/setups.ctp have a single "Name" field (Last Name
// is commented out there): the full name is stored in first_name and last_name stays empty. Letters,
// digits, spaces and "." only — same as legacy's pattern/oninput filter.
export const cleanName = (v: string) => v.replace(/[^A-Za-z0-9.\s]/g, '');

// Capitalizes just the first character, leaving the rest of what's typed untouched — every plain
// text field on Employee Join / Employee Detail's Personal Info uses this, except email (an
// address is case-sensitive) and fields with their own transform (e.g. pan_no/lwf_code already
// force the whole value uppercase).
export const capitalizeFirst = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export const onlyDigits = (s: string) => s.replace(/\D/g, '');
export const onlyAlphanumeric = (s: string) => s.replace(/[^A-Za-z0-9]/g, '');
export const onlyPercent = (s: string) => {
  const cleaned = s.replace(/[^\d.]/g, '');
  const [int, ...dec] = cleaned.split('.');
  return dec.length ? `${int}.${dec.join('').slice(0, 2)}` : int;
};

// One call per API route: returns the first rule broken by the fields this row type sends.
export function childRowError(kind: 'education' | 'experience' | 'family' | 'documents', body: Record<string, unknown>): string | null {
  switch (kind) {
    case 'education':
      return marksError(body.mark ?? body.marks);
    case 'experience':
      return salaryError(body.salary);
    case 'family':
      return (
        familyGenderError(body.gender) ||
        contactNumberError(body.contact_number) ||
        contactNumberError(body.alternate_number, 'Alternative number')
      );
    case 'documents':
      return documentNumberError(body.document_number);
  }
}
