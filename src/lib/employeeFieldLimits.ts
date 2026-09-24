// Max lengths for the free-text fields of the Employee Join wizard (JoinDetail) and the Employee
// Details form (EmployeeDetail). Each is the smaller of legacy's own `maxlength`
// (View/EmployeeJoin/setup.ctp) and the DB column the value finally lands in — the company DB runs
// STRICT_TRANS_TABLES, so a value longer than its column fails the whole save instead of being
// truncated. Join-form values are copied into emp_details on onboarding, so a join field is capped
// at the smaller of its emp_join and emp_details columns (e.g. district -> emp_details.city, 50).
// Person names (employee, guardian, family, name on document) are all capped at 50.
export const EMPLOYEE_FIELD_LIMITS: Record<string, number> = {
  // Personal info (emp_join / emp_details)
  first_name: 50,
  last_name: 50,
  email: 100,
  mobile_no: 15,
  address: 250,
  pincode: 6,
  district: 50,
  state: 50,
  guradian: 50,
  relation_guardian: 100,
  id_card: 12,
  pan_no: 10,
  bank: 100,
  bank_name: 100,
  bank_branch: 100,
  bank_branch_name: 100,
  ifsc_code: 12,
  account_no: 18,
  esi: 10,
  esi_dispensary: 100,
  pf: 22,
  company_pf: 12,
  previous_member_id: 15,
  wps_code: 15,
  lwf_code: 15,

  // Onboarding (emp_proff / user_credentials)
  emp_company_id: 30,
  password: 50,
  probation: 3,
};

// Child rows (education / experience / family / documents). family and document text columns
// are varchar(50) in both the join and employee tables, even though legacy's form allowed 100.
export const CHILD_FIELD_LIMITS = {
  course: 100,
  university: 100,
  duration: 10,
  mark: 6,
  company: 100,
  designation: 100,
  department: 100,
  salary: 10,
  name: 50,
  relation: 50,
  nationality: 50,
  contact_number: 15,
  blood_group: 5,
  document_number: 50,
} as const;
