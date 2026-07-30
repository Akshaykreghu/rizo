const CHECKBOX_FIELDS = [
  'IS_SANDWICH',
  'is_leave_encash',
  'ALLOW_NEGETIVE',
  'exceptions',
  'allow_all_leaves',
  'document_mandatory',
] as const;

export function normalizeLeavePolicyBody(body: Record<string, unknown>) {
  const checkboxes = Object.fromEntries(
    CHECKBOX_FIELDS.map((f) => [f, body[f] === 'Y' || body[f] === true ? 'Y' : 'N'])
  ) as Record<(typeof CHECKBOX_FIELDS)[number], 'Y' | 'N'>;

  return {
    LEAVEPOLICY_GROUP_ID: Number(body.LEAVEPOLICY_GROUP_ID),
    salary_head_item_fkey: Number(body.salary_head_item_fkey),
    leave_policy_type: (body.leave_policy_type as string) || 'M',
    leave_cycle_start_date: (body.leave_cycle_start_date as string) || null,
    leave_cycle_end_date: (body.leave_cycle_end_date as string) || null,
    alloted_leave_forthe_year:
      body.alloted_leave_forthe_year === '' || body.alloted_leave_forthe_year == null
        ? 0
        : Number(body.alloted_leave_forthe_year),
    alloted_leave_forthe_month:
      body.alloted_leave_forthe_month === '' || body.alloted_leave_forthe_month == null
        ? 0
        : Number(body.alloted_leave_forthe_month),
    CARRY_FORWARD_LIMIT:
      body.CARRY_FORWARD_LIMIT === '' || body.CARRY_FORWARD_LIMIT == null
        ? 0
        : Number(body.CARRY_FORWARD_LIMIT),
    sanction_by: body.sanction_by ? Number(body.sanction_by) : null,
    REMARKS: (body.REMARKS as string) || '',
    leave_encash_limit:
      body.leave_encash_limit === '' || body.leave_encash_limit == null
        ? 0
        : Number(body.leave_encash_limit),
    minimum_leave: body.minimum_leave === '' || body.minimum_leave == null ? null : Number(body.minimum_leave),
    maximum_leave: body.maximum_leave === '' || body.maximum_leave == null ? null : Number(body.maximum_leave),
    min_day_before_apply:
      body.min_day_before_apply === '' || body.min_day_before_apply == null
        ? null
        : Number(body.min_day_before_apply),
    minimum_service:
      body.minimum_service === '' || body.minimum_service == null ? null : Number(body.minimum_service),
    ...checkboxes,
  };
}
