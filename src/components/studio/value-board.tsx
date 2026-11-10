// Custom AG Studio widget: subscriptions as a ranked list, worst value first, in the manner of a
// track list (rank, artwork tile, title and detail, score). It is a normal Studio widget: it
// declares data mappings, queries through the widget API, and so follows page filters and
// cross-filters like the built-in charts.

import type { AgWidgetField, AgWidgetParams } from 'ag-studio';
import { AgNoDataOverlay } from 'ag-studio-react';
import { useEffect, useState } from 'react';
import { money } from '@/domain/dates';

type Mapping = Partial<Record<'label' | 'score' | 'cost' | 'hours', AgWidgetField[]>>;

interface Row {
  label: string;
  score: number | null;
  cost: number;
  hours: number;
}

const tone = (score: number | null) => (score === null ? '#636a77' : score >= 65 ? '#d4ff24' : score >= 40 ? '#7aa7f7' : score > 0 ? '#ffb547' : '#ff6b6b');
const verdict = (score: number | null) => (score === null ? 'Not scored' : score >= 65 ? 'Earning its place' : score >= 40 ? 'Fair' : score > 0 ? 'Low value' : 'Unused');

export function ValueBoard({ widgetApi, dataMapping }: AgWidgetParams) {
  const mapping = dataMapping as Mapping;
  const [rows, setRows] = useState<Row[] | null>(null);
  const label = mapping.label?.[0];
  const score = mapping.score?.[0];
  const cost = mapping.cost?.[0];
  const hours = mapping.hours?.[0];
  const signature = [label, score, cost, hours].map((f) => f?.key).join('|');

  useEffect(() => {
    if (!label) return;
    let cancelled = false;
    const fields = [label, score, cost, hours].filter((f): f is AgWidgetField => Boolean(f));
    const load = () =>
      widgetApi
        .getData({ fields }, { queryId: 'value-board', onDataUpdated: load })
        .then((response) => {
          if (cancelled || response.replaced) return;
          const num = (row: Record<string, unknown>, field?: AgWidgetField) => (field && row[field.key] !== null && row[field.key] !== undefined ? Number(row[field.key]) : null);
          setRows(
            response.results.rows
              .map((row) => ({ label: String(row[label.key] ?? ''), score: num(row, score), cost: num(row, cost) ?? 0, hours: num(row, hours) ?? 0 }))
              // Worst value first; unscored subscriptions go last.
              .sort((a, b) => (a.score ?? 1000) - (b.score ?? 1000)),
          );
        })
        .catch(() => !cancelled && setRows([]));
    void load();
    return () => {
      cancelled = true;
    };
    // The mapped fields are captured through `signature`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widgetApi, signature]);

  if (!label) return <AgNoDataOverlay />;
  if (rows === null) return null;
  if (rows.length === 0) return <AgNoDataOverlay />;

  return (
    <ol style={{ height: '100%', overflow: 'auto', margin: 0, padding: 0, listStyle: 'none' }}>
      {rows.map((row, index) => (
        <li
          key={row.label}
          style={{ display: 'grid', gridTemplateColumns: '22px 40px minmax(0, 1fr) 120px', alignItems: 'center', gap: 12, padding: '8px 4px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}
        >
          <span style={{ color: '#9aa1ad', fontSize: 13, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{index + 1}</span>
          <span
            aria-hidden="true"
            style={{
              width: 40,
              height: 40,
              borderRadius: 8,
              display: 'grid',
              placeItems: 'center',
              fontWeight: 800,
              fontSize: 16,
              color: '#030407',
              background: tone(row.score),
            }}
          >
            {row.label.charAt(0)}
          </span>
          <span style={{ minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.label}</span>
            <span style={{ display: 'block', fontSize: 12, color: '#9aa1ad', fontVariantNumeric: 'tabular-nums' }}>
              {money(row.cost)} a month · {row.hours > 0 ? `${row.hours.toFixed(1)} h used` : 'no recorded use'}
            </span>
          </span>
          <span title={row.score === null ? 'No usage-based score' : `Value score ${row.score} of 100`}>
            <span style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: tone(row.score), fontWeight: 600 }}>
              <span>{verdict(row.score)}</span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{row.score ?? ''}</span>
            </span>
            <span style={{ display: 'block', height: 3, marginTop: 5, borderRadius: 2, background: 'rgba(255,255,255,0.12)', overflow: 'hidden' }}>
              <span style={{ display: 'block', height: '100%', width: `${row.score ?? 0}%`, background: tone(row.score) }} />
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}
