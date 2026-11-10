// Parser for bank and card statement exports (delimited text as downloaded from net banking).
// Pure TypeScript with no runtime imports so it can be used from the server, a worker or a test script.

import type { BankTransaction } from '@/domain/types';

export interface ParsedStatement {
  /** Debits only (money leaving the account), amount positive. */
  transactions: BankTransaction[];
  /** Detected from symbols, headers and codes; null if unknown. */
  currency: 'INR' | 'USD' | 'EUR' | 'GBP' | null;
  /** Data rows seen. */
  rowsRead: number;
  /** Rows that could not be parsed or were credits. */
  rowsSkipped: number;
  /** Short human description of what was recognised, or of what was not understood. */
  format: string;
}

type Currency = NonNullable<ParsedStatement['currency']>;
type Role = 'date' | 'desc' | 'debit' | 'credit' | 'amount' | 'indicator';
type Columns = Partial<Record<Role, number>>;

type RawDate =
  | { kind: 'fixed'; y: number; m: number; d: number }
  // Numeric date whose first two components may be day/month or month/day.
  | { kind: 'numeric'; a: number; b: number; y: number };

interface ParsedAmount {
  value: number; // signed
  marker: 'dr' | 'cr' | null; // trailing Dr/Cr inside the cell
}

interface Candidate {
  result: ParsedStatement;
  hasHeader: boolean;
}

const DELIMITERS: Array<{ char: string; name: string }> = [
  { char: ',', name: 'CSV' },
  { char: ';', name: 'Semicolon-separated file' },
  { char: '\t', name: 'Tab-separated file' },
  { char: '|', name: 'Pipe-separated file' },
];

// Ordered by preference: when a file has several description-like columns
// (Chase has both "Details" and "Description") the earlier word wins.
const DESC_WORDS = [
  'narration', 'description', 'particulars', 'remarks', 'merchant', 'payee', 'details', 'memo',
  'verwendungszweck', 'buchungstext', 'beschreibung', 'libelle', 'concepto', 'name',
];
const DATE_WORDS = ['date', 'dt', 'datum', 'buchungstag', 'fecha'];
const AMOUNT_WORDS = ['amount', 'amt', 'betrag', 'montant', 'importe'];
const DEBIT_WORDS = ['withdrawal', 'withdrawals', 'debit', 'debits', 'dr', 'wdl'];
const CREDIT_WORDS = ['deposit', 'deposits', 'credit', 'credits', 'cr'];

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

export function parseStatement(text: string): ParsedStatement {
  try {
    if (typeof text !== 'string' || text.trim() === '') return empty('Not recognised: the file is empty');
    const clean = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');

    // The right delimiter is the one under which the file makes sense as a statement,
    // so every plausible delimiter is tried and the best reading kept.
    let best: Candidate | null = null;
    for (const delim of DELIMITERS) {
      if (delim.char !== ',' && !clean.includes(delim.char)) continue;
      const candidate = parseRows(splitRows(clean, delim.char, true), delim.name);
      if (!best || rank(candidate) > rank(best)) best = candidate;
    }
    return best ? best.result : empty('Not recognised: the file is empty');
  } catch (err) {
    // Uploads are untrusted input; the caller gets a description instead of an exception.
    return empty(`Not recognised: unexpected parser error (${err instanceof Error ? err.message : 'unknown'})`);
  }
}

function empty(format: string): ParsedStatement {
  return { transactions: [], currency: null, rowsRead: 0, rowsSkipped: 0, format };
}

function rank(c: Candidate): number {
  return (c.hasHeader ? 1e9 : 0) + c.result.transactions.length * 1000 + c.result.rowsRead;
}

// ---- Tokenising -----------------------------------------------------------------------

function splitRows(text: string, delim: string, quotes: boolean): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let wasQuoted = false;

  const endField = () => {
    row.push(field.trim());
    field = '';
    wasQuoted = false;
  };
  const endRow = () => {
    endField();
    if (row.some((c) => c !== '')) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (quotes && ch === '"' && !wasQuoted && field.trim() === '') {
      // A quote only opens a quoted field at the start of the field; a stray quote
      // inside narration text is ordinary data.
      inQuotes = true;
      wasQuoted = true;
      field = '';
    } else if (ch === delim) {
      endField();
    } else if (ch === '\n') {
      endRow();
    } else {
      field += ch;
    }
  }
  // An unbalanced quote (often in a free-text preamble) would swallow the rest of the
  // file into one field, so re-read the file treating quotes as plain characters.
  if (inQuotes) return splitRows(text, delim, false);
  endRow();
  return rows;
}

// ---- Header recognition ---------------------------------------------------------------

function headerTokens(cell: string): string[] {
  return cell.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(Boolean);
}

function classifyHeader(cell: string): Role | null {
  if (cell.length > 40) return null;
  const tokens = headerTokens(cell);
  if (tokens.length === 0 || tokens.length > 5) return null;
  const has = (words: string[]) => words.some((w) => tokens.includes(w));

  // Running balance columns look like amounts but must never be read as one.
  if (has(['balance', 'bal', 'saldo'])) return null;
  const debit = has(DEBIT_WORDS);
  const credit = has(CREDIT_WORDS);
  if (debit && credit) return 'indicator'; // "Dr/Cr", "Debit/Credit"
  if (has(['type'])) return 'indicator'; // "Type", "Transaction Type"
  if (has(DATE_WORDS)) return 'date';
  if (debit) return 'debit';
  if (credit) return 'credit';
  if (has(AMOUNT_WORDS)) return 'amount';
  if (has(DESC_WORDS)) return 'desc';
  return null;
}

// Lower is better. The transaction date is when the user paid; value and posting
// dates can trail it by days.
function dateRank(cell: string): number {
  const t = headerTokens(cell);
  if (t.some((w) => ['txn', 'tran', 'trans', 'transaction'].includes(w))) return 0;
  if (t.includes('value')) return 3;
  if (t.some((w) => ['posting', 'post', 'posted', 'booking'].includes(w))) return 2;
  return 1;
}

function descRank(cell: string): number {
  const t = headerTokens(cell);
  const i = DESC_WORDS.findIndex((w) => t.includes(w));
  return i === -1 ? DESC_WORDS.length : i;
}

function readHeader(row: string[]): Columns | null {
  const cols: Columns = {};
  let bestDate = Infinity;
  let bestDesc = Infinity;
  row.forEach((cell, i) => {
    const role = classifyHeader(cell);
    if (!role) return;
    if (role === 'date') {
      const r = dateRank(cell);
      if (r < bestDate) { bestDate = r; cols.date = i; }
    } else if (role === 'desc') {
      const r = descRank(cell);
      if (r < bestDesc) { bestDesc = r; cols.desc = i; }
    } else if (cols[role] === undefined) {
      cols[role] = i;
    }
  });
  const hasAmount = cols.amount !== undefined || cols.debit !== undefined || cols.credit !== undefined;
  return cols.date !== undefined && hasAmount ? cols : null;
}

// ---- Cell parsers ---------------------------------------------------------------------

function parseRawDate(cell: string): RawDate | null {
  const s = cell.trim();
  const end = '(?=$|[\\sT,])';
  let m = s.match(new RegExp(`^(\\d{4})[-/.](\\d{1,2})[-/.](\\d{1,2})${end}`));
  if (m) return { kind: 'fixed', y: +m[1], m: +m[2], d: +m[3] };

  m = s.match(new RegExp(`^(\\d{1,2})[-/.](\\d{1,2})[-/.](\\d{4}|\\d{2})${end}`));
  if (m) return { kind: 'numeric', a: +m[1], b: +m[2], y: fullYear(m[3]) };

  m = s.match(new RegExp(`^(\\d{1,2})[-/. ]\\s*([A-Za-z]{3,9})\\.?[-/. ,]\\s*(\\d{4}|\\d{2})${end}`));
  if (m) {
    const month = monthNumber(m[2]);
    return month ? { kind: 'fixed', y: fullYear(m[3]), m: month, d: +m[1] } : null;
  }

  m = s.match(new RegExp(`^([A-Za-z]{3,9})\\.?[-/ ]\\s*(\\d{1,2}),?[-/ ]\\s*(\\d{4})${end}`));
  if (m) {
    const month = monthNumber(m[1]);
    return month ? { kind: 'fixed', y: +m[3], m: month, d: +m[2] } : null;
  }
  return null;
}

function fullYear(y: string): number {
  if (y.length === 4) return +y;
  return +y < 70 ? 2000 + +y : 1900 + +y;
}

function monthNumber(word: string): number {
  const w = word.toLowerCase();
  if (w === 'sept') return 9;
  const i = MONTHS.findIndex((name) => name.startsWith(w));
  return i === -1 ? 0 : i + 1;
}

function toIso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || y < 1900 || y > 2200) return null;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d > daysInMonth) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function resolveDate(raw: RawDate, dayFirst: boolean): string | null {
  if (raw.kind === 'fixed') return toIso(raw.y, raw.m, raw.d);
  return dayFirst ? toIso(raw.y, raw.b, raw.a) : toIso(raw.y, raw.a, raw.b);
}

function parseAmount(cell: string, european: boolean): ParsedAmount | null {
  let s = cell.replace(/[\s\u00A0]/g, '').replace(/−/g, '-');
  if (!s) return null;

  let marker: ParsedAmount['marker'] = null;
  const tail = s.match(/([\d)])(dr|cr)\.?$/i);
  if (tail) {
    marker = tail[2].toLowerCase() as 'dr' | 'cr';
    s = s.slice(0, s.length - tail[0].length + 1);
  }
  s = s.replace(/₹|\$|€|£|Rs\.?|INR|USD|EUR|GBP/gi, '');

  let negative = false;
  if (/^\(.+\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  if (s.startsWith('-') || s.endsWith('-')) { negative = true; s = s.replace(/^-|-$/g, ''); }
  else if (s.startsWith('+')) s = s.slice(1);

  if (!/^\d[\d.,']*$/.test(s) && !/^[.,]\d+$/.test(s)) return null;
  s = s.replace(/'/g, '');

  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  let decimal = '';
  if (lastDot >= 0 && lastComma >= 0) {
    decimal = lastDot > lastComma ? '.' : ',';
  } else if (lastComma >= 0) {
    // "12,50" is a decimal comma; "1,234" and "1,23,456" are grouping unless the file is European.
    const single = s.indexOf(',') === lastComma;
    if (single && (european || /,\d{1,2}$/.test(s))) decimal = ',';
  } else if (lastDot >= 0) {
    const single = s.indexOf('.') === lastDot;
    const groupedThousands = /^\d{1,3}(\.\d{3})+$/.test(s);
    if (single && !(european && groupedThousands)) decimal = '.';
  }
  const digits = decimal
    ? s.slice(0, s.lastIndexOf(decimal)).replace(/[.,]/g, '') + '.' + s.slice(s.lastIndexOf(decimal) + 1)
    : s.replace(/[.,]/g, '');
  const value = Number(digits);
  if (!Number.isFinite(value)) return null;
  return { value: negative ? -value : value, marker };
}

// Decides per file whether the comma is the decimal separator, because a lone
// "1.234" or "1,234" cannot be read correctly without knowing the convention.
function looksEuropean(cells: string[]): boolean {
  let euro = 0;
  let other = 0;
  for (const c of cells) {
    const s = c.replace(/[^\d.,]/g, '');
    if (/\.\d{3},\d{1,2}$/.test(s) || /^\d+,\d{2}$/.test(s)) euro++;
    else if (/,\d{3}\.\d/.test(s) || /^\d+\.\d{2}$/.test(s)) other++;
  }
  return euro > other;
}

function parseIndicator(cell: string): 'dr' | 'cr' | null {
  const s = cell.trim().toLowerCase().replace(/\.$/, '');
  if (!s) return null;
  if (/^(d|dr|db|debit|withdrawal|wdl)$/.test(s)) return 'dr';
  if (/^(c|cr|credit|deposit|dep)$/.test(s)) return 'cr';
  // Values such as ACH_DEBIT or "Credit Interest".
  const debit = /debit|withdraw/.test(s);
  const credit = /credit|deposit/.test(s);
  if (debit !== credit) return debit ? 'dr' : 'cr';
  return null;
}

function detectCurrency(text: string): Currency | null {
  const count = (re: RegExp) => (text.match(re) ?? []).length;
  const scores: Array<[Currency, number]> = [
    ['INR', count(/₹|\bINR\b|(?:^|[^A-Za-z])Rs\.?(?![A-Za-z])/gim)],
    ['USD', count(/\$|\bUSD\b/gi)],
    ['EUR', count(/€|\bEUR\b/gi)],
    ['GBP', count(/£|\bGBP\b/gi)],
  ];
  let best: [Currency, number] | null = null;
  for (const s of scores) if (s[1] > 0 && (!best || s[1] > best[1])) best = s;
  return best ? best[0] : null;
}

// ---- Day-first versus month-first -----------------------------------------------------

function decideDayFirst(dates: RawDate[], currency: Currency | null, indianHints: boolean): boolean {
  const numeric = dates.filter((d): d is Extract<RawDate, { kind: 'numeric' }> => d.kind === 'numeric');
  const firstOver12 = numeric.some((d) => d.a > 12);
  const secondOver12 = numeric.some((d) => d.b > 12);
  if (firstOver12) return true;
  if (secondOver12) return false;

  // Statements are sorted by date, so a reading that keeps the rows in order
  // beats one that scrambles them.
  if (numeric.length >= 3) {
    const disorder = (dayFirst: boolean) => {
      const keys = numeric.map((d) => d.y * 10000 + (dayFirst ? d.b * 100 + d.a : d.a * 100 + d.b));
      let down = 0;
      let up = 0;
      for (let i = 1; i < keys.length; i++) {
        if (keys[i] < keys[i - 1]) down++;
        if (keys[i] > keys[i - 1]) up++;
      }
      return Math.min(down, up);
    };
    const dayFirstDisorder = disorder(true);
    const monthFirstDisorder = disorder(false);
    if (dayFirstDisorder === 0 && monthFirstDisorder > 0) return true;
    if (monthFirstDisorder === 0 && dayFirstDisorder > 0) return false;
  }

  if (currency === 'USD' && !indianHints) return false;
  // INR, EUR, GBP and unknown: day-first is the convention almost everywhere outside the US.
  return true;
}

// ---- Rows to transactions -------------------------------------------------------------

function parseRows(rows: string[][], delimName: string): Candidate {
  let headerIndex = -1;
  let cols: Columns | null = null;
  for (let i = 0; i < rows.length; i++) {
    cols = readHeader(rows[i]);
    if (cols) { headerIndex = i; break; }
  }

  const hasHeader = cols !== null;
  if (!cols) {
    cols = guessHeaderlessColumns(rows);
    if (!cols) {
      return {
        hasHeader: false,
        result: empty('Not recognised: no header row with date and amount columns, and no rows that look like date, description, amount'),
      };
    }
  }

  const dateCol = cols.date as number;
  const body = rows.slice(headerIndex + 1);
  const rawDates = body.map((r) => parseRawDate(r[dateCol] ?? ''));
  let lastDated = -1;
  rawDates.forEach((d, i) => { if (d) lastDated = i; });
  if (lastDated === -1) {
    return { hasHeader, result: empty(`Not recognised: ${delimName} has a header row but no rows with a readable date`) };
  }
  // Everything after the last dated row is trailer (totals, disclaimers, end markers).
  const data = body.slice(0, lastDated + 1);

  if (cols.desc === undefined) cols.desc = longestTextColumn(data, cols);
  const descCol = cols.desc;

  const amountCols = [cols.amount, cols.debit, cols.credit].filter((c): c is number => c !== undefined);
  const amountCells = data.flatMap((r) => amountCols.map((c) => r[c] ?? ''));
  const european = looksEuropean(amountCells);

  // Narration text is left out of currency detection: a rupee statement can
  // legitimately mention "USD 9.99" for a foreign card charge.
  const currencyText = rows
    .map((r, i) => {
      const isData = i > headerIndex && i <= headerIndex + 1 + lastDated;
      return (isData ? r.filter((_, c) => c !== descCol) : r).join(' ');
    })
    .join('\n');
  const currency = detectCurrency(currencyText);

  const headerWords = headerIndex >= 0 ? rows[headerIndex].flatMap(headerTokens) : [];
  const indianHints =
    headerWords.some((w) => ['narration', 'withdrawal', 'particulars', 'remarks', 'chq'].includes(w)) ||
    data.some((r) => /\b(UPI|NEFT|IMPS|RTGS|IFSC)\b/.test(r.join(' ')));
  const dayFirst = decideDayFirst(
    rawDates.filter((d): d is RawDate => d !== null),
    currency,
    indianHints,
  );

  const split = cols.debit !== undefined || (cols.credit !== undefined && cols.amount === undefined);
  const amounts = split ? [] : data.map((r) => parseAmount(r[cols.amount as number] ?? '', european));

  let useIndicator = false;
  if (!split && cols.indicator !== undefined) {
    const indicatorCol = cols.indicator;
    const recognised = data.filter((r) => parseIndicator(r[indicatorCol] ?? '') !== null).length;
    // A "Type" column holding values like "Sale" says nothing about direction; fall back to signs.
    useIndicator = recognised * 2 >= data.length;
  }
  const unmarked = amounts.filter((a): a is ParsedAmount => a !== null && a.marker === null && a.value !== 0);
  const anyNegative = unmarked.some((a) => a.value < 0);
  const anyPositive = unmarked.some((a) => a.value > 0);
  // Mixed signs: negatives are money out. One sign only: the export lists spending either way.
  const signedDebit = (value: number) => (anyNegative && anyPositive ? value < 0 : true);

  const transactions: BankTransaction[] = [];
  const seen = new Map<string, number>();
  let rowsRead = 0;
  let rowsSkipped = 0;

  data.forEach((row, i) => {
    // Paged exports repeat the header; that is neither data nor an error.
    if (classifyHeader(row[dateCol] ?? '') === 'date') return;
    rowsRead++;
    const raw = rawDates[i];
    const date = raw ? resolveDate(raw, dayFirst) : null;

    let debit: number | null = null;
    if (split) {
      const parsed = cols.debit !== undefined ? parseAmount(row[cols.debit] ?? '', european) : null;
      if (parsed && parsed.value !== 0) debit = Math.abs(parsed.value);
    } else {
      const parsed = amounts[i];
      if (parsed && parsed.value !== 0) {
        const direction = parsed.marker ?? (useIndicator ? parseIndicator(row[cols.indicator as number] ?? '') : null);
        const isDebit = direction ? direction === 'dr' : !useIndicator && signedDebit(parsed.value);
        if (isDebit) debit = Math.abs(parsed.value);
      }
    }

    if (!date || debit === null) { rowsSkipped++; return; }

    const amount = Math.round(debit * 100) / 100;
    const description = (row[descCol] ?? '').replace(/\s+/g, ' ').trim();
    const key = `${date}|${description}|${amount.toFixed(2)}`;
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);
    transactions.push({ id: makeId(date, description, amount, occurrence), date, description, amount });
  });

  let layout: string;
  if (split) layout = 'separate withdrawal/deposit columns';
  else if (useIndicator) layout = 'an amount column plus a Dr/Cr indicator column';
  else if (anyNegative && anyPositive) layout = 'one signed amount column (negatives read as debits)';
  else layout = 'one amount column (all rows read as debits)';
  const numericDates = rawDates.some((d) => d?.kind === 'numeric');
  const dateNote = numericDates ? (dayFirst ? ', day-first dates' : ', month-first dates') : '';
  const prefix = hasHeader ? delimName : `Headerless ${delimName} (date, description, amount)`;

  return {
    hasHeader,
    result: { transactions, currency, rowsRead, rowsSkipped, format: `${prefix} with ${layout}${dateNote}` },
  };
}

// For files with no header: find the date column, the first numeric column after it
// and the wordiest remaining column.
function guessHeaderlessColumns(rows: string[][]): Columns | null {
  const dated = rows.filter((r) => r.length >= 3 && r.some((c) => parseRawDate(c) !== null));
  if (dated.length === 0) return null;

  const dateCol = mostCommon(dated.map((r) => r.findIndex((c) => parseRawDate(c) !== null)));
  const isAmount = (c: string) => parseRawDate(c) === null && parseAmount(c, false) !== null;
  const amountCol = mostCommon(
    dated.map((r) => r.findIndex((c, i) => i !== dateCol && isAmount(c))).filter((i) => i >= 0),
  );
  if (dateCol === undefined || amountCol === undefined) return null;

  const cols: Columns = { date: dateCol, amount: amountCol };
  const descCol = longestTextColumn(dated, cols);
  if (descCol === dateCol || descCol === amountCol) return null;
  cols.desc = descCol;
  return cols;
}

function mostCommon(values: number[]): number | undefined {
  const counts = new Map<number, number>();
  let best: number | undefined;
  for (const v of values) {
    const n = (counts.get(v) ?? 0) + 1;
    counts.set(v, n);
    if (best === undefined || n > (counts.get(best) ?? 0)) best = v;
  }
  return best;
}

function longestTextColumn(rows: string[][], cols: Columns): number {
  const taken = new Set(Object.values(cols));
  const letters = new Map<number, number>();
  for (const row of rows) {
    row.forEach((cell, i) => {
      if (taken.has(i)) return;
      letters.set(i, (letters.get(i) ?? 0) + cell.replace(/[^\p{L}]/gu, '').length);
    });
  }
  let best = -1;
  let bestCount = 0;
  for (const [i, n] of letters) if (n > bestCount) { best = i; bestCount = n; }
  // No free text column at all: point at the date column so callers can detect the miss.
  return best === -1 ? (cols.date as number) : best;
}

// ---- Ids ------------------------------------------------------------------------------

// Built only from the row's own content so that importing the same file twice
// produces the same ids and the store can de-duplicate.
function makeId(date: string, description: string, amount: number, occurrence: number): string {
  const slug = description.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24);
  const cents = Math.round(amount * 100);
  return `stmt-${date}-${slug || 'x'}-${hash(description)}-${cents}-${occurrence}`;
}

// FNV-1a. The slug is truncated, so the hash keeps long narrations that share a prefix apart.
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
