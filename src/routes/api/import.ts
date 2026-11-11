import { createFileRoute } from '@tanstack/react-router';
import { body, fail, handle, json, type RouteContext } from '@/server/http';
import { log } from '@/server/logger';
import { classifyUnknownWithAi } from '@/server/services/classifier';
import { ingest } from '@/server/services/discovery';
import { buildState } from '@/server/services/state';
import { parseStatement } from '@/server/services/statement';
import { db, save } from '@/server/store';

// Statement upload: works with any bank or card, using the export the user downloads themselves.
async function POST({ request }: RouteContext) {
  const { csv = '', filename } = await body<{ csv: string; filename: string }>(request);
  if (!csv.trim()) return fail(400, 'The file is empty.');
  if (csv.length > 5_000_000) return fail(413, 'The file is too large (5 MB max).');

  const parsed = parseStatement(csv);
  log.info('statement', `Parsed ${filename ?? 'statement'}`, { format: parsed.format, rowsRead: parsed.rowsRead, rowsSkipped: parsed.rowsSkipped, debits: parsed.transactions.length, currency: parsed.currency });
  if (parsed.transactions.length === 0) return fail(400, `No payments found in this file. ${parsed.format}. Export the statement as CSV or delimited text (PDF and Excel files are not supported yet).`);

  const data = db();
  // The first statement tells us what currency the user's money is in.
  // Indian bank exports (HDFC, ICICI, SBI ...) often carry no currency symbol at all, so their
  // column names and payment rails stand in for one.
  const indianLayout = /\b(narration|withdrawal amt|chq\.?\s*\/\s*ref|value dt|upi-|neft|imps|ifsc)\b/i.test(csv.slice(0, 20_000));
  const currency = parsed.currency ?? (indianLayout ? 'INR' : null);
  if (currency && data.bankTransactions.length === 0 && data.subscriptions.length === 0) data.settings.currency = currency;
  const result = ingest(parsed.transactions, 'statement');
  if (result.discovered.length > 0) await classifyUnknownWithAi();
  save('statement import');
  return json({ result: { ...result, rows: parsed.rowsRead, format: parsed.format, currency }, state: buildState() });
}

export const Route = createFileRoute('/api/import')({
  server: { handlers: { POST: handle('import', POST, { needs: 'connect' }) } },
});
