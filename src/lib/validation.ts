const MIN_WORKING_AGE_YEARS = 18;

// Parses a plain "YYYY-MM-DD" field value as *local* midnight, matching how every cutoff/"today"
// below is built with `new Date(y, m, d)`. Passing the string straight to `new Date(value)`
// instead parses a date-only ISO string as UTC midnight — which drifts against a local-time
// cutoff by the timezone offset, and in any positive-UTC-offset zone (e.g. India, +5:30) that
// made someone turning exactly 18 *today* fail the check, and could flag "today" itself as a
// future date. Every date comparison in this file must go through this, not `new Date(string)`.
function parseLocalDate(value: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return new Date(NaN);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

// The inverse of parseLocalDate: a Date's own "YYYY-MM-DD" in *local* time, for building a
// DatePicker's min/max (e.g. today, or today minus 18 years). `d.toISOString().slice(0, 10)`
// looks equivalent but reports the UTC calendar date, which is a day behind the local one for
// part of the day in any positive-UTC-offset timezone (e.g. India, for the first ~5.5 hours after
// local midnight) — so a cutoff built that way could reject an otherwise-valid pick, or briefly
// re-enable one that shouldn't be, depending on what time of day it's computed.
export function localDateStr(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Generic "not in the future" check, shared by every date field that's turned out to need this
// exact validation (Employee Join's Date of Birth, Allocate Assets' Allocated Date, and any
// future one) — confirmed as a recurring gap across 3+ date fields rather than fixing it per-field.
export function futureDateError(value: string, label = 'Date'): string | null {
  if (!value) return null;
  const date = parseLocalDate(value);
  if (Number.isNaN(date.getTime())) return `Invalid ${label.toLowerCase()}`;
  const today = new Date();
  const todayLocalMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (date > todayLocalMidnight) return `${label} cannot be in the future`;
  return null;
}

export function dobError(value: string): string | null {
  if (!value) return null;
  const futureCheck = futureDateError(value, 'Date of birth');
  if (futureCheck) return futureCheck;
  const dob = parseLocalDate(value);
  const today = new Date();
  const cutoff = new Date(today.getFullYear() - MIN_WORKING_AGE_YEARS, today.getMonth(), today.getDate());
  if (dob > cutoff) return `Employee must be at least ${MIN_WORKING_AGE_YEARS} years old`;
  return null;
}

export function mobileError(value: string): string | null {
  if (!value) return null;
  // 10 digits minimum (a local number); up to 15 for international (E.164) numbers.
  return /^\d{10,15}$/.test(value) ? null : 'Mobile number must be at least 10 digits';
}

export function aadhaarError(value: string): string | null {
  if (!value) return null;
  return /^\d{12}$/.test(value) ? null : 'Aadhaar/ID Card must be exactly 12 digits';
}

// Statutory registration formats — shared by Company Setup and any future statutory forms.
// Each returns null for an empty value so a blank field is never treated as invalid.

export function panError(value: string): string | null {
  if (!value) return null;
  return /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(value.toUpperCase())
    ? null
    : 'PAN must be 5 letters, 4 digits, 1 letter (e.g. ABCDE1234F)';
}

export function tanError(value: string): string | null {
  if (!value) return null;
  return /^[A-Z]{4}[0-9]{5}[A-Z]$/.test(value.toUpperCase())
    ? null
    : 'TAN must be 4 letters, 5 digits, 1 letter (e.g. ABCD12345E)';
}

export function cinError(value: string): string | null {
  if (!value) return null;
  return /^[LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/.test(value.toUpperCase())
    ? null
    : 'CIN must be 21 characters (e.g. L12345MH2000PLC123456)';
}

export function pincodeError(value: string): string | null {
  if (!value) return null;
  return /^[1-9][0-9]{5}$/.test(value) ? null : 'PIN Code must be 6 digits';
}

export function emailError(value: string): string | null {
  if (!value) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? null : 'Enter a valid email address';
}

export function websiteError(value: string): string | null {
  if (!value) return null;
  return /^(https?:\/\/)?[^\s.]+\.[^\s]{2,}$/.test(value) ? null : 'Enter a valid website URL';
}

export function landlinePhoneError(value: string): string | null {
  if (!value) return null;
  const digits = value.replace(/[^\d]/g, '');
  return /^[\d+\-()\s]+$/.test(value) && digits.length >= 8 && digits.length <= 15
    ? null
    : 'Enter a valid phone number';
}

// Employee Join statutory formats — legacy View/EmployeeJoin/setup.ctp, each optional (blank
// is always valid) except where the caller marks it required via statutoryFieldErrors' opts.

export function esiError(value: string): string | null {
  if (!value) return null;
  return /^\d{10}$/.test(value) ? null : 'ESI number must be exactly 10 digits';
}

export function uanError(value: string): string | null {
  if (!value) return null;
  return /^\d{12}$/.test(value) ? null : 'UAN must be exactly 12 digits';
}

export function lwfError(value: string): string | null {
  if (!value) return null;
  return /^[A-Za-z0-9]{5,15}$/.test(value.toUpperCase())
    ? null
    : 'LWF code must be 5-15 alphanumeric characters';
}

export function accountNoError(value: string): string | null {
  if (!value) return null;
  return /^\d+$/.test(value) ? null : 'Account number must contain digits only';
}

export function pfNumberError(value: string): string | null {
  if (!value) return null;
  return /^[A-Za-z0-9]+$/.test(value) ? null : 'PF number must be alphanumeric';
}

// Runs every statutory-format check legacy's Employee Join form enforces. Returns the first
// error message, or null. `aadhaarRequired` toggles required behaviour (join form requires
// Aadhaar; edit form only format-checks when present unless the caller passes it too).
//
// `pfUanSwapped` accounts for a genuine legacy quirk: EmployeeJoinController.php's
// saveonboarding() swaps pf/company_pf when copying an emp_join draft into the permanent
// emp_details row, and the real edit screen (View/Employee/setups.ctp) reads them back swapped
// to compensate — so on emp_join (the Join wizard, still pf=PF/company_pf=UAN as typed) this
// must stay false, but on emp_details (the Employee Detail / ESS About Me edit, post-onboarding)
// it must be true, or this ends up validating the PF number as a UAN and vice versa — exactly
// backwards, and confirmed the hard way (see EmployeeDetail.tsx's fieldValidators comment for the
// full trace through the legacy source).
export function statutoryFieldErrors(
  v: {
    id_card?: string; pan_no?: string; esi?: string; company_pf?: string;
    lwf_code?: string; account_no?: string; pf?: string; pincode?: string;
  },
  opts?: { aadhaarRequired?: boolean; pfUanSwapped?: boolean }
): string | null {
  if (opts?.aadhaarRequired && !v.id_card) return 'Aadhaar/ID Card is required';
  const [uanValue, pfValue] = opts?.pfUanSwapped ? [v.pf, v.company_pf] : [v.company_pf, v.pf];
  return (
    aadhaarError(v.id_card ?? '') ||
    panError(v.pan_no ?? '') ||
    esiError(v.esi ?? '') ||
    uanError(uanValue ?? '') ||
    lwfError(v.lwf_code ?? '') ||
    accountNoError(v.account_no ?? '') ||
    pfNumberError(pfValue ?? '') ||
    pincodeError(v.pincode ?? '') ||
    null
  );
}

// DOB must be at least MIN_WORKING_AGE_YEARS before `onDate` (the joining date). Legacy
// View/Employee/setup.ctp:1001-1037 blocks submit unless the person is 18+ at joining.
export function ageAtDateError(dob: string, onDate: string): string | null {
  if (!dob || !onDate) return null;
  const dobDate = parseLocalDate(dob);
  const on = parseLocalDate(onDate);
  if (Number.isNaN(dobDate.getTime()) || Number.isNaN(on.getTime())) return null;
  const cutoff = new Date(on.getFullYear() - MIN_WORKING_AGE_YEARS, on.getMonth(), on.getDate());
  return dobDate > cutoff
    ? `Employee must be at least ${MIN_WORKING_AGE_YEARS} years old on the joining date`
    : null;
}
