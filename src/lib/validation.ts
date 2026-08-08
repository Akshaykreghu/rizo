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
