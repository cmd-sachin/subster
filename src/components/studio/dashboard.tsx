import { Link } from '@tanstack/react-router';
import { AgStudioAiModule, type AgStudioApi, type AgStudioMode } from 'ag-studio';
import { AgStudio, AgStudioProvider, createWidgets } from 'ag-studio-react';
import { Eye, Pencil } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { AppLogo } from '@/components/app-logo';
import { useApp } from '@/components/app-state';
import { CATEGORY_LABEL } from '@/domain/catalog';
import { money, shortDate } from '@/domain/dates';
import type { Category, Portfolio, Subscription } from '@/domain/types';
import { buildAi } from './ai';
import { buildStudioData } from './data';
import { buildReport, PAGES } from './report';
import { substerStudioTheme } from './theme';
import { subscriptionLooks, ValueBoard } from './value-board';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the custom widget extends Studio's default registry at runtime
const widgets = (defaults: any) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createWidgets<any>({
    additionalTypes: [
      {
        id: 'valueBoard',
        label: 'Value board',
        dataMapping: {
          label: { type: 'field', supportedRoles: ['category'], requires: { cardinality: 'many' }, required: true, aiDescription: 'The subscription name' },
          score: { type: 'field', supportedRoles: ['numeric'], requires: { cardinality: 'one', per: 'dataMapping.label' }, aiDescription: 'Value score, 0 to 100' },
          cost: { type: 'field', supportedRoles: ['numeric'], requires: { cardinality: 'one', per: 'dataMapping.label' }, aiDescription: 'Monthly cost' },
          hours: { type: 'field', supportedRoles: ['numeric'], requires: { cardinality: 'one', per: 'dataMapping.label' }, aiDescription: 'Hours used' },
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        form: (params: any) =>
          params.createDefaults({
            dataMappingItems: [
              { key: 'label', label: 'Subscription' },
              { key: 'score', label: 'Value score' },
              { key: 'cost', label: 'Cost' },
              { key: 'hours', label: 'Hours' },
            ],
          }),
        comp: ValueBoard,
        defaultSize: { width: 520, height: 460 },
        minSize: { width: 300, height: 180 },
        ai: { description: 'Ranked list of subscriptions, worst value first, with a 0-100 value score, monthly cost and hours used. Use it to show which subscriptions earn their place.' },
      },
    ],
    menu: [...defaults.menu, { label: 'Subster', widgetIds: ['valueBoard'] }],
  });

export default function Dashboard() {
  const { state } = useApp();
  const apiRef = useRef<AgStudioApi | null>(null);
  const [mode, setMode] = useState<AgStudioMode>('view');
  const [pageId, setPageId] = useState(PAGES[0].id);
  const aiEnabled = state?.integrations.agent === 'gemini';
  const licenseKey = state?.integrations.agStudioLicense;
  const currency = state?.settings.currency ?? 'USD';

  // Data follows live state; Studio picks up changed rows without losing the report.
  const data = useMemo(() => {
    if (!state) return null;
    // The value board draws each subscription's logo, which it looks up by name.
    subscriptionLooks.clear();
    for (const { sub } of state.portfolio.insights) subscriptionLooks.set(sub.name, { providerId: sub.providerId, category: sub.category, color: sub.color });
    return buildStudioData(state);
  }, [state]);
  // `ai`, `widgets` and `initialState` are read once, when Studio is created.
  const ai = useMemo(() => (aiEnabled ? buildAi() : undefined), [aiEnabled]);
  const initialState = useMemo(() => buildReport(currency), [currency]);

  if (!state || !data) return <p className="p-8 text-muted">Loading analytics</p>;

  const selectPage = (id: string) => {
    setPageId(id);
    const api = apiRef.current;
    if (api) api.setState({ ...api.getState(), selectedPageId: id });
  };

  if (state.portfolio.insights.length === 0) {
    return (
      <div className="library flex h-full flex-col px-4 py-8 md:px-8">
        <h1>Analytics</h1>
        <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted">
          There is nothing to analyse yet. Add your subscriptions or link your bank and your spend, charges and usage appear here.
        </p>
        <Link to="/connect" className="mt-5 w-fit rounded-full bg-accent px-4 py-2 text-[14px] font-semibold text-canvas hover:opacity-90">
          Bring in your data
        </Link>
      </div>
    );
  }

  return (
    <div className="library flex h-full min-h-[720px] flex-col">
      <header className="px-4 pt-7 md:px-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h1>Analytics</h1>
          <div className="flex items-center gap-2">
            <div className="flex rounded-full bg-white/[0.06] p-1" role="tablist" aria-label="Report pages">
              {PAGES.map((p) => (
                <button
                  key={p.id}
                  role="tab"
                  aria-selected={pageId === p.id}
                  onClick={() => selectPage(p.id)}
                  className={`rounded-full px-4 py-1.5 text-[13px] font-semibold transition-colors ${pageId === p.id ? 'bg-accent text-canvas' : 'text-muted hover:text-ink'}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <button onClick={() => setMode(mode === 'view' ? 'edit' : 'view')} className="flex items-center gap-1.5 rounded-full bg-accent-soft px-4 py-2 text-[13px] font-semibold text-accent hover:brightness-125">
              {mode === 'view' ? <Pencil size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
              {mode === 'view' ? 'Edit' : 'Done'}
            </button>
          </div>
        </div>
        <Shelf portfolio={state.portfolio} />
      </header>

      <div className="min-h-0 flex-1">
        <AgStudioProvider licenseKey={licenseKey} modules={ai ? [AgStudioAiModule] : undefined}>
          <AgStudio
            // A new currency changes chart titles, which Studio only reads at creation.
            key={currency}
            style={{ height: '100%', width: '100%' }}
            theme={substerStudioTheme}
            data={data}
            ai={ai}
            widgets={widgets}
            initialState={initialState}
            mode={mode}
            onApiReady={(event) => {
              apiRef.current = event.api;
            }}
          />
        </AgStudioProvider>
      </div>
    </div>
  );
}

// The first card is the logo's yellow with dark text; the rest step through its blues.
const CARDS = [
  { background: '#fed106', dark: true },
  { background: 'linear-gradient(135deg,#0473fd,#0035c5)', dark: false },
  { background: 'linear-gradient(135deg,#0a4fd6,#06206e)', dark: false },
  { background: 'linear-gradient(135deg,#2a86ff,#0473fd)', dark: false },
  { background: 'linear-gradient(135deg,#0035c5,#060f3a)', dark: false },
  { background: 'linear-gradient(135deg,#0473fd,#07154a)', dark: false },
];

/** The headline numbers, as a shelf of cards you scroll sideways. */
function Shelf({ portfolio: p }: { portfolio: Portfolio }) {
  const scored = p.insights.filter((i) => i.valueScore !== null && i.sub.status === 'active');
  const best = [...scored].sort((a, b) => (b.valueScore ?? 0) - (a.valueScore ?? 0))[0];
  const priciest = [...p.insights].filter((i) => i.costPerHour !== null).sort((a, b) => (b.costPerHour ?? 0) - (a.costPerHour ?? 0))[0];
  const next = p.upcoming[0];
  const byCategory = new Map<Category, number>();
  for (const i of p.insights) if (i.sub.status !== 'cancelled' && i.sub.status !== 'paused') byCategory.set(i.sub.category, (byCategory.get(i.sub.category) ?? 0) + i.monthlyCost);
  const top = [...byCategory.entries()].sort((a, b) => b[1] - a[1])[0];

  const cards = [
    { label: 'Every month', value: money(p.monthlySpend), detail: `${p.activeCount} subscriptions · ${money(Math.round(p.yearlySpend))} a year` },
    p.potentialSavingsMonthly > 0 && { label: 'You could save', value: `${money(p.potentialSavingsMonthly)}`, detail: `a month, ${money(Math.round(p.potentialSavingsMonthly * 12))} a year` },
    best && { logo: best.sub, label: 'Best value', value: best.sub.name, detail: `Score ${best.valueScore} · ${best.hours30} h for ${money(best.monthlyCost)}` },
    priciest && priciest !== best && { logo: priciest.sub, label: 'Costs most per hour', value: priciest.sub.name, detail: `${money(priciest.costPerHour ?? 0)} for each hour you use it` },
    next && { logo: p.insights.find((i) => i.sub.id === next.subId)?.sub, label: 'Next charge', value: next.name, detail: `${money(next.amount)} on ${shortDate(next.date)}` },
    top && { label: 'Biggest category', value: CATEGORY_LABEL[top[0]], detail: `${money(Math.round(top[1] * 100) / 100)} a month` },
  ].filter((c): c is { logo?: Subscription; label: string; value: string; detail: string } => Boolean(c));

  return (
    <ul className="shelf -mx-4 mt-5 flex gap-3 overflow-x-auto px-4 pb-4 md:-mx-8 md:px-8" aria-label="Highlights">
      {cards.map((card, i) => {
        const look = CARDS[i % CARDS.length];
        return (
          <li key={card.label} className={`flex h-[132px] w-[236px] shrink-0 snap-start flex-col justify-between rounded-2xl p-4 ${look.dark ? 'text-canvas' : 'text-white'}`} style={{ background: look.background }}>
            <span className="flex items-start justify-between gap-2">
              <span className="text-[11px] font-bold uppercase tracking-[0.08em] opacity-80">{card.label}</span>
              {card.logo && <AppLogo providerId={card.logo.providerId} category={card.logo.category} color={card.logo.color} size={34} />}
            </span>
            <span>
              <span className="num block truncate text-[24px] font-extrabold leading-tight tracking-tight">{card.value}</span>
              <span className="num block truncate text-[12px] font-medium opacity-80">{card.detail}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
