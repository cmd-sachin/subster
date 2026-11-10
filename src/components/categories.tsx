// Where the money goes by category, and how each subscription's category was decided.

import { CATEGORY_LABEL } from '@/domain/catalog';
import { money } from '@/domain/dates';
import type { Category, Classifier, Portfolio } from '@/domain/types';
import { CATEGORY_ICON } from './category-icon';

const DECIDED: Record<Classifier, string> = { catalog: 'known app', rules: 'keyword rules', ai: 'Gemini', user: 'you' };

export function Categories({ portfolio }: { portfolio: Portfolio }) {
  const live = portfolio.insights.filter((i) => i.sub.status !== 'cancelled' && i.sub.status !== 'paused');
  const groups = new Map<Category, typeof live>();
  for (const insight of live) groups.set(insight.sub.category, [...(groups.get(insight.sub.category) ?? []), insight]);
  const rows = [...groups.entries()]
    .map(([category, items]) => ({ category, items, spend: items.reduce((t, i) => t + i.monthlyCost, 0), hours: items.reduce((t, i) => t + i.hours30, 0) }))
    .sort((a, b) => b.spend - a.spend);
  const total = rows.reduce((t, r) => t + r.spend, 0) || 1;
  const by = live.reduce<Partial<Record<Classifier, number>>>((acc, i) => ({ ...acc, [i.sub.classifiedBy]: (acc[i.sub.classifiedBy] ?? 0) + 1 }), {});

  if (rows.length === 0) return null;
  return (
    <section className="panel" aria-label="Spending by category">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-white/[0.06] px-4 py-3">
        <h2 className="text-[14px] font-semibold">By category</h2>
        <p className="text-[12px] text-muted">
          Classified by{' '}
          {(Object.keys(by) as Classifier[])
            .map((k) => `${DECIDED[k]} (${by[k]})`)
            .join(', ')}
          . Change any of them in the table below.
        </p>
      </header>
      <ul className="grid gap-x-8 gap-y-3 p-4 md:grid-cols-2">
        {rows.map((row) => {
          const Icon = CATEGORY_ICON[row.category];
          return (
            <li key={row.category} className="flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/[0.07]" aria-hidden="true">
                <Icon size={16} strokeWidth={1.75} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3 text-[13px]">
                  <span className="truncate font-medium">
                    {CATEGORY_LABEL[row.category]} <span className="num font-normal text-faint">{row.items.length}</span>
                  </span>
                  <span className="num shrink-0">
                    {money(Math.round(row.spend * 100) / 100)}
                    <span className="text-faint">/mo</span>
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
                  <div className="h-full rounded-full bg-[var(--blue)]" style={{ width: `${Math.max(2, (row.spend / total) * 100)}%` }} />
                </div>
                <p className="mt-1 truncate text-[12px] text-faint">{row.items.map((i) => i.sub.name).join(', ')}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
