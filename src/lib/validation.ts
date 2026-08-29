const MIN_WORKING_AGE_YEARS = 18;

// Generic "not in the future" check, shared by every date field that's turned out to need this
// exact validation (Employee Join's Date of Birth, Allocate Assets' Allocated Date, and any
// future one) — confirmed as a recurring gap across 3+ date fields rather than fixing it per-field.
export function futureDateError(value: string, label = 'Date'): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return `Invalid ${label.toLowerCase()}`;
  if (date > new Date()) return `${label} cannot be in the future`;
  return null;
}

export function dobError(value: string): string | null {
  if (!value) return null;
  const futureCheck = futureDateError(value, 'Date of birth');
  if (futureCheck) return futureCheck;
  const dob = new Date(value);
  const today = new Date();
  const cutoff = new Date(today.getFullYear() - MIN_WORKING_AGE_YEARS, today.getMonth(), today.getDate());
  if (dob > cutoff) return `Employee must be at least ${MIN_WORKING_AGE_YEARS} years old`;
  return null;
}

export function mobileError(value: string): string | null {
  if (!value) return null;
  return /^\d{10}$/.test(value) ? null : 'Mobile number must be exactly 10 digits';
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
