const MIN_WORKING_AGE_YEARS = 18;

export function dobError(value: string): string | null {
  if (!value) return null;
  const dob = new Date(value);
  if (Number.isNaN(dob.getTime())) return 'Invalid date of birth';
  const today = new Date();
  if (dob > today) return 'Date of birth cannot be in the future';
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
