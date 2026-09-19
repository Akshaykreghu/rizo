// emp_menu.iconCls carries the legacy CakePHP app's Font Awesome 4 icon class for each menu
// item (e.g. "fa fa-bed icon-content"). ESS Others originally showed a hand-picked emoji per
// hardcoded tile (💎 Salary Advance, 🏦 Loan Requests, 🌴 Leave Encashment, ...) — this keeps
// that exact plain-emoji look for the now-live, admin-allocated list by mapping each legacy FA
// glyph to the closest emoji instead of switching to a boxed icon-library badge.
const FA_TO_EMOJI: Record<string, string> = {
  'fa-bed': '🏖️',
  'fa-envelope': '📨',
  'fa-check-square-o': '✅',
  'fa-book': '📘',
  'fa-calendar-o': '📅',
  'fa-calendar': '🗓️',
  'fa-file-text-o': '📃',
  'fa-file-pdf-o': '🧾',
  'fa-money': '💰',
  'fa-clock-o': '⏰',
  'fa-gavel': '⚖️',
  'fa-cog': '⚙️',
  'fa-circle-o': '⚪',
  'fa-hand-o-up': '✋',
  'fa-tasks': '📋',
  'fa-user-plus': '🧑‍💼',
  'fa-spinner': '🔄',
};

export function resolveMenuEmoji(iconCls: string | null | undefined): string {
  if (!iconCls) return '🔗';
  const glyph = iconCls.split(/\s+/).find((cls) => cls in FA_TO_EMOJI);
  return glyph ? FA_TO_EMOJI[glyph] : '🔗';
}
