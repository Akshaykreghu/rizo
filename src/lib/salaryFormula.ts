// Salary structure formula engine — matches legacy's real, confirmed-live token grammar
// (legacy/View/SalaryStructure/form.ctp:113,548-579) exactly, so it stays compatible with
// existing stored `structure_det_calequation` data, but replaces legacy's client-side
// `eval()` on a hand-built string with a real recursive-descent arithmetic parser (safe:
// no code execution, only +-*/() and numeric literals ever reach it).
//
// Grammar: a space-delimited token stream. Each token is one of:
//   - a symbol: + - * / . ( )        (note: '.' is its own token, e.g. ". 4" means 0.4)
//   - a number segment (digits)
//   - the keyword `monthsal`          (Monthly Gross Salary)
//   - an item identifier `<salary_head_item_pkey>_<ItemName>`, where ItemName has
//     spaces/parens/'&' replaced with '_' (mirrors legacy's str_replace(['(',')',' ','&'], '_', ...))

const IDENTIFIER_RE = /^\d+_/;

export function buildItemToken(salaryHeadItemPkey: number, itemName: string): string {
  const cleaned = itemName.trim().replace(/[()&\s]/g, '_');
  return `${salaryHeadItemPkey}_${cleaned}`;
}

// Renders a stored token formula back into admin-facing text (e.g. "monthsal * . 4" ->
// "Monthly Gross Salary * . 4") so the UI never has to show the raw `<pkey>_<Item_Name>`
// grammar. `itemLabelByToken` maps buildItemToken(...) -> the item's real display name;
// any token not found there (including legacy free-text formulas this grammar doesn't
// cover) is passed through unchanged rather than guessed at.
export function formatFormulaForDisplay(
  formula: string,
  itemLabelByToken: Record<string, string>
): string {
  if (!formula.trim()) return '';
  return formula
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => {
      if (token === 'monthsal') return 'Monthly Gross Salary';
      if (IDENTIFIER_RE.test(token)) return itemLabelByToken[token] ?? token;
      return token;
    })
    .join(' ');
}

export class FormulaError extends Error {}

// Resolves identifier/monthsal tokens to their numeric values and concatenates the token
// stream into a plain numeric expression string, exactly mirroring legacy's `final_eq`
// string-building loop — the only difference is what happens to that string next.
function resolveToNumericExpression(
  formula: string,
  itemValues: Record<string, number>,
  monthlyGross: number
): string {
  const tokens = formula.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) throw new FormulaError('Empty formula');

  let expr = '';
  for (const token of tokens) {
    if (token === 'monthsal') {
      expr += String(monthlyGross);
    } else if (IDENTIFIER_RE.test(token)) {
      const value = itemValues[token];
      if (value === undefined) {
        throw new FormulaError(`Formula references an unknown or unincluded item: "${token}"`);
      }
      expr += String(value);
    } else if (/^[0-9+\-*/.()]+$/.test(token)) {
      expr += token;
    } else {
      throw new FormulaError(`Unrecognized token in formula: "${token}"`);
    }
  }
  return expr;
}

// Minimal recursive-descent parser/evaluator for +-*/() with decimals and unary minus.
// Deliberately does not use eval()/Function() — only ever sees a string built entirely
// from resolved numeric literals and the symbol set above.
function evaluateNumericExpression(expr: string): number {
  let pos = 0;

  function peek(): string {
    return expr[pos];
  }
  function error(msg: string): never {
    throw new FormulaError(`${msg} at position ${pos} in "${expr}"`);
  }

  function parseNumber(): number {
    const start = pos;
    while (pos < expr.length && /[0-9.]/.test(expr[pos])) pos++;
    const text = expr.slice(start, pos);
    if (text === '' || text === '.') error('Expected a number');
    const value = Number(text);
    if (Number.isNaN(value)) error(`Invalid number "${text}"`);
    return value;
  }

  function parseFactor(): number {
    if (peek() === '(') {
      pos++;
      const value = parseExpression();
      if (peek() !== ')') error('Expected ")"');
      pos++;
      return value;
    }
    if (peek() === '-') {
      pos++;
      return -parseFactor();
    }
    if (peek() === '+') {
      pos++;
      return parseFactor();
    }
    return parseNumber();
  }

  function parseTerm(): number {
    let value = parseFactor();
    while (peek() === '*' || peek() === '/') {
      const op = expr[pos];
      pos++;
      const rhs = parseFactor();
      value = op === '*' ? value * rhs : value / rhs;
    }
    return value;
  }

  function parseExpression(): number {
    let value = parseTerm();
    while (peek() === '+' || peek() === '-') {
      const op = expr[pos];
      pos++;
      const rhs = parseTerm();
      value = op === '+' ? value + rhs : value - rhs;
    }
    return value;
  }

  const result = parseExpression();
  if (pos !== expr.length) error('Unexpected trailing characters');
  return result;
}

export function evaluateSalaryFormula(
  formula: string,
  itemValues: Record<string, number>,
  monthlyGross: number
): number {
  const expr = resolveToNumericExpression(formula, itemValues, monthlyGross);
  return evaluateNumericExpression(expr);
}
