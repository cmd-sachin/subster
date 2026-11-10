
// Renewal timeline on Bryntum Scheduler. One row per subscription. Shaded spans are billing
// periods; diamonds are moments that matter: the next charge, a trial converting, a price rise,
// a failed payment, the agent's "decide by" deadline, and reviews the agent scheduled (which
// you can drag to another day).


import { useMemo } from 'react';
import { StringHelper } from '@bryntum/scheduler';
import { BryntumScheduler } from '@bryntum/scheduler-react';
import { addDays, addMonths, cycleMonths, cycleShort, iso, money, today } from '@/domain/dates';
import type { AppState, BillingCycle, Verdict } from '@/domain/types';
import { useApp } from './app-state';

const VENDOR_CSS = ['scheduler.css', 'svalbard-dark.css', 'fontawesome/css/fontawesome.css', 'fontawesome/css/solid.css'].map((file) => `/vendor/bryntum/${file}`);

type Kind = 'renewal' | 'trial' | 'price' | 'failed' | 'deadline' | 'done' | 'review' | 'webhook' | 'bank';

const KIND: Record<Kind, { color: string; legend: string }> = {
  renewal: { color: 'gray', legend: 'Next charge' },
  trial: { color: 'orange', legend: 'Trial converts' },
  price: { color: 'violet', legend: 'Price increase' },
  failed: { color: 'red', legend: 'Failed payment' },
  deadline: { color: 'red', legend: 'Decide by (agent proposal)' },
  done: { color: 'green', legend: 'Action executed' },
  review: { color: 'blue', legend: 'Review (drag to move)' },
  webhook: { color: 'teal', legend: 'PayPal webhook' },
  bank: { color: 'cyan', legend: 'Bank charge detected' },
};

const VERDICT_LABEL: Record<Verdict, string> = { great: 'Good value', fair: 'Fair', poor: 'Low value', unused: 'Unused', unmeasured: 'Not measured', essential: 'Essential' };
const VERDICT_COLOR: Record<Verdict, string> = { great: 'var(--good)', fair: 'var(--info)', poor: 'var(--warn)', unused: 'var(--bad)', unmeasured: 'var(--faint)', essential: 'var(--faint)' };

function build(state: AppState) {
  const now = today();
  const start = addDays(now, -16);
  const end = addDays(now, 44);
  const inWindow = (d: string) => d >= start && d <= end;
  const step = (d: string, cycle: BillingCycle) => addMonths(d, cycleMonths(cycle));

  const resources = state.portfolio.insights.map((i) => ({
    id: i.sub.id,
    name: i.sub.name,
    plan: i.sub.plan,
    price: `${money(i.sub.price)}/${cycleShort(i.sub.cycle)}`,
    verdict: i.verdict,
    status: i.sub.status,
    color: i.sub.color,
    rail: i.sub.rail,
  }));

  const ranges: object[] = [];
  const events: object[] = [];
  const marker = (id: string, resourceId: string, date: string, kind: Kind, name: string, note: string, draggable = false) => {
    if (!inWindow(date)) return;
    events.push({ id, resourceId, startDate: date, endDate: date, name, note, kind, eventColor: KIND[kind].color, draggable, resizable: false });
  };

  for (const i of state.portfolio.insights) {
    const { sub } = i;
    const charges = state.charges.filter((c) => c.subId === sub.id).sort((a, b) => a.date.localeCompare(b.date));
    const live = sub.status === 'active' || sub.status === 'trial' || sub.status === 'past_due';

    // Billing periods already paid for (or attempted).
    charges.forEach((c, n) => {
      const periodEnd = charges[n + 1]?.date ?? (live || sub.status === 'paused' ? sub.nextRenewal : step(c.date, sub.cycle));
      if (periodEnd < start || c.date > end) return;
      ranges.push({
        id: `period-${c.id}`,
        resourceId: sub.id,
        startDate: c.date,
        endDate: periodEnd,
        name: c.status === 'failed' ? `${money(c.amount)} failed` : `${money(c.amount)} paid`,
        timeRangeColor: c.status === 'failed' ? 'red' : 'gray',
      });
      if (c.status === 'failed') marker(`failed-${c.id}`, sub.id, c.date, 'failed', 'Payment failed', `${money(c.amount)} could not be collected.`);
      const prev = charges[n - 1];
      if (prev && c.amount > prev.amount) marker(`price-${c.id}`, sub.id, c.date, 'price', `${money(prev.amount)} to ${money(c.amount)}`, `Price rose from ${money(prev.amount)} to ${money(c.amount)}.`);
    });

    if (sub.status === 'trial' && sub.trialEndsAt) {
      ranges.push({ id: `trial-${sub.id}`, resourceId: sub.id, startDate: sub.startedAt, endDate: sub.trialEndsAt, name: 'Free trial', timeRangeColor: 'orange' });
      marker(`trialend-${sub.id}`, sub.id, sub.trialEndsAt, 'trial', `Converts to ${money(sub.price)}`, `The free trial ends and ${money(sub.price)} is charged.`);
    } else if (live) {
      // The period the next charge would buy. This is what an approved cancel or pause removes.
      ranges.push({
        id: `next-${sub.id}`,
        resourceId: sub.id,
        startDate: sub.nextRenewal,
        endDate: step(sub.nextRenewal, sub.cycle),
        name: `${money(sub.price)} due`,
        timeRangeColor: i.verdict === 'unused' || i.verdict === 'poor' ? 'orange' : 'green',
      });
      marker(`renew-${sub.id}`, sub.id, sub.nextRenewal, 'renewal', `Renews ${money(sub.price)}`, `${sub.name} charges ${money(sub.price)} via ${sub.rail === 'paypal' ? 'PayPal' : 'card'}.`);
    }
  }

  for (const a of state.actions) {
    if (a.status === 'pending') marker(`deadline-${a.id}`, a.subId, a.deadline, 'deadline', `Decide: ${a.title}`, a.reason);
    if (a.status === 'executed' && a.resolvedAt) marker(`done-${a.id}`, a.subId, iso(new Date(a.resolvedAt)), 'done', a.title, a.steps.at(-1)?.label ?? 'Done');
  }
  for (const n of state.notes) marker(n.id, n.subId, n.date, n.kind, n.kind === 'review' ? 'Review' : n.label, n.label, n.kind === 'review');

  return { resources, ranges, events, start, end };
}

export default function Timeline() {
  const { state, mutate, refresh } = useApp();
  const model = useMemo(() => (state ? build(state) : null), [state]);
  if (!state || !model) return <p className="p-8 text-muted">Loading timeline</p>;

  const pending = state.actions.filter((a) => a.status === 'pending').length;

  return (
    <div className="flex h-full min-h-[560px] flex-col">
      {/* Bryntum ships compiled CSS; it is served from public/vendor (see scripts/copy-vendor.mjs). */}
      {VENDOR_CSS.map((href) => (
        <link key={href} rel="stylesheet" href={href} precedence="vendor" />
      ))}
      <header className="flex flex-wrap items-end justify-between gap-3 px-4 pb-3 pt-6 md:px-8">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">Renewal timeline</h1>
          <p className="mt-1 text-[14px] text-muted">
            {money(state.portfolio.next30Total)} will be charged in the next 30 days.{' '}
            {pending > 0 ? `${pending} agent proposal${pending === 1 ? ' has' : 's have'} a deadline on this timeline.` : 'Run an audit and the agent pins its deadlines here.'}
          </p>
        </div>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted" aria-label="Legend">
          {(Object.keys(KIND) as Kind[]).map((k) => (
            <li key={k} className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rotate-45" style={{ background: `var(--b-color-${KIND[k].color}, ${KIND[k].color})` }} aria-hidden="true" />
              {KIND[k].legend}
            </li>
          ))}
        </ul>
      </header>

      <div className="subsense-timeline min-h-0 flex-1 border-t border-white/[0.06]">
        <BryntumScheduler
          startDate={model.start}
          endDate={model.end}
          viewPreset="weekAndDayLetter"
          milestoneLayoutMode="estimate"
          visibleDate={{ date: new Date(addDays(model.start, 10)), block: "start" }}
          rowHeight={54}
          barMargin={8}
          resources={model.resources}
          events={model.events}
          resourceTimeRanges={model.ranges}
          resourceTimeRangesFeature
          timeRangesFeature={{ showCurrentTimeLine: true }}
          // Only reviews move; everything else is a fact.
          eventDragFeature={{ constrainDragToResource: true }}
          eventResizeFeature={false}
          eventEditFeature={false}
          eventDragCreateFeature={false}
          eventMenuFeature={false}
          scheduleMenuFeature={false}
          cellMenuFeature={false}
          cellEditFeature={false}
          onBeforeEventAdd={() => false}
          zoomOnMouseWheel={false}
          eventTooltipFeature={{
            template: ({ eventRecord }: { eventRecord: { name: string; getData: (f: string) => string } }) =>
              `<div style="max-width:280px"><strong>${StringHelper.encodeHtml(eventRecord.name)}</strong><div style="margin-top:4px">${StringHelper.encodeHtml(eventRecord.getData('note') ?? '')}</div></div>`,
          }}
          columns={[
            {
              text: 'Subscription',
              field: 'name',
              width: 210,
              htmlEncode: false,
              renderer: ({ record }: { record: { getData: (f: string) => string } }) => {
                const off = ['cancelled', 'paused'].includes(record.getData('status'));
                return `<div style="display:flex;align-items:center;gap:10px;${off ? 'opacity:.5' : ''}">
                  <span style="width:4px;height:28px;border-radius:2px;background:${StringHelper.encodeHtml(record.getData('color'))}"></span>
                  <span><span style="display:block;font-weight:600">${StringHelper.encodeHtml(record.getData('name'))}</span>
                  <span style="display:block;font-size:12px;color:var(--faint)">${StringHelper.encodeHtml(record.getData('price'))} · ${record.getData('rail') === 'paypal' ? 'PayPal' : 'Card'}${off ? ` · ${StringHelper.encodeHtml(record.getData('status'))}` : ''}</span></span>
                </div>`;
              },
            },
            {
              text: 'Value',
              field: 'verdict',
              width: 120,
              htmlEncode: false,
              renderer: ({ value }: { value: Verdict }) =>
                `<span style="display:inline-flex;align-items:center;gap:6px;font-size:12px"><span style="width:8px;height:8px;border-radius:50%;background:${VERDICT_COLOR[value]}"></span>${VERDICT_LABEL[value]}</span>`,
            },
          ]}
          onEventDrop={({ eventRecords }) => {
            const moved = eventRecords[0];
            if (!moved || moved.getData('kind') !== 'review') return;
            const d = new Date(moved.startDate);
            const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            void mutate(`/api/notes/${moved.id}`, { date }).then((res) => {
              if (!res.ok) void refresh(); // snap back to the stored date
            });
          }}
        />
      </div>
    </div>
  );
}
