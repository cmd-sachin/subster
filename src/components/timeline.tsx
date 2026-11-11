// The renewal timeline, built on Bryntum Scheduler and using it for what it is good at.
//
// One row per subscription, grouped by category. Shaded spans are billing periods. Milestones are
// the moments that matter: every charge in the coming year, a trial converting, a price rise, a
// failed payment, a decision the inbox is waiting on, and review reminders.
//
// Scheduler features in use: grouping with per-group totals, a summary row that adds up what is
// charged in each day, week or month on screen, a toolbar (find, span, today, zoom, filters),
// zooming and panning, weekend shading, a highlighted "this week", context menus that act on a
// subscription or pin a reminder to a day, drag to move a reminder, and tooltips.

import { useMemo, useRef } from 'react';
import { StringHelper } from '@bryntum/scheduler';
import { BryntumScheduler } from '@bryntum/scheduler-react';
import { CATEGORY_LABEL } from '@/domain/catalog';
import { addDays, addMonths, cycleMonths, cycleShort, iso, money, shortDate, today } from '@/domain/dates';
import { LOGOS } from '@/domain/logos.gen';
import type { AppState, BillingCycle, Verdict } from '@/domain/types';
import { useApp } from './app-state';
import { Loader } from '@/components/loader';

const VENDOR_CSS = ['scheduler.css', 'svalbard-light.css', 'fontawesome/css/fontawesome.css', 'fontawesome/css/solid.css'].map((file) => `/vendor/bryntum/${file}`);

type Kind = 'renewal' | 'trial' | 'price' | 'failed' | 'deadline' | 'done' | 'review' | 'webhook' | 'bank';

const KIND: Record<Kind, { color: string; icon: string; legend: string }> = {
  renewal: { color: 'gray', icon: 'fa fa-rotate', legend: 'Charge' },
  trial: { color: 'orange', icon: 'fa fa-hourglass-half', legend: 'Trial ends' },
  price: { color: 'violet', icon: 'fa fa-arrow-trend-up', legend: 'Price rise' },
  failed: { color: 'red', icon: 'fa fa-triangle-exclamation', legend: 'Failed' },
  deadline: { color: 'red', icon: 'fa fa-flag', legend: 'Decide by' },
  done: { color: 'green', icon: 'fa fa-check', legend: 'Done' },
  review: { color: 'blue', icon: 'fa fa-bell', legend: 'Reminder' },
  webhook: { color: 'teal', icon: 'fa fa-bolt', legend: 'PayPal' },
  bank: { color: 'cyan', icon: 'fa fa-building-columns', legend: 'Bank' },
};

const VERDICT_LABEL: Record<Verdict, string> = { great: 'Good value', fair: 'Fair', poor: 'Low value', unused: 'Unused', unmeasured: 'Not measured', essential: 'Essential' };
const VERDICT_COLOR: Record<Verdict, string> = { great: 'var(--good)', fair: 'var(--info)', poor: 'var(--warn)', unused: 'var(--bad)', unmeasured: 'var(--faint)', essential: 'var(--faint)' };

const PAST_DAYS = 30;
const FUTURE_DAYS = 365;

/** The brand mark for a row, as HTML: Scheduler columns render strings. */
function logoHtml(providerId: string | undefined, name: string, color: string) {
  const mark = providerId ? LOGOS[providerId] : undefined;
  const tile = 'display:flex;flex:none;align-items:center;justify-content:center;width:30px;height:30px;border-radius:9px';
  if (!mark) return `<span style="${tile};background:${StringHelper.encodeHtml(color)};color:#fff;font-weight:700;font-size:13px">${StringHelper.encodeHtml(name.charAt(0))}</span>`;
  const n = parseInt(mark.hex.slice(1), 16);
  const light = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  return `<span style="${tile};background:${light < 0.08 ? '#262b36' : mark.hex}"><svg viewBox="0 0 24 24" width="17" height="17" fill="${light > 0.6 ? '#111318' : '#fff'}"><path d="${mark.path}"/></svg></span>`;
}

function build(state: AppState) {
  const now = today();
  const start = addDays(now, -PAST_DAYS);
  const end = addDays(now, FUTURE_DAYS);
  const inWindow = (d: string) => d >= start && d <= end;
  const step = (d: string, cycle: BillingCycle) => addMonths(d, cycleMonths(cycle));
  const waiting = new Set(state.actions.filter((a) => a.status === 'pending' || a.status === 'guided').map((a) => a.subId));

  const resources = state.portfolio.insights
    .filter((i) => i.sub.status !== 'cancelled')
    .map((i) => ({
      id: i.sub.id,
      name: i.sub.name,
      providerId: i.sub.providerId,
      category: CATEGORY_LABEL[i.sub.category],
      plan: i.sub.plan,
      price: `${money(i.sub.price)}/${cycleShort(i.sub.cycle)}`,
      monthly: i.sub.status === 'paused' ? 0 : i.monthlyCost,
      verdict: i.verdict,
      status: i.sub.status,
      color: i.sub.color,
      rail: i.sub.rail,
      paypal: Boolean(i.sub.paypalSubscriptionId),
      nextIn: i.daysToRenewal,
      needsMe: waiting.has(i.sub.id) || (i.daysToRenewal >= 0 && i.daysToRenewal <= 7 && ['cancel', 'pause', 'downgrade'].includes(i.recommendation.action)),
    }));

  const ranges: object[] = [];
  const events: object[] = [];
  const marker = (id: string, resourceId: string, date: string, kind: Kind, name: string, note: string, extra: object = {}) => {
    if (!inWindow(date)) return;
    events.push({ id, resourceId, startDate: date, endDate: date, name, note, kind, eventColor: KIND[kind].color, iconCls: KIND[kind].icon, draggable: kind === 'review', resizable: false, ...extra });
  };

  for (const i of state.portfolio.insights) {
    const { sub } = i;
    if (sub.status === 'cancelled') continue;
    const charges = state.charges.filter((c) => c.subId === sub.id).sort((a, b) => a.date.localeCompare(b.date));
    const live = sub.status === 'active' || sub.status === 'trial' || sub.status === 'past_due';

    // Billing periods already paid for (or attempted).
    charges.forEach((c, n) => {
      const periodEnd = charges[n + 1]?.date ?? (live || sub.status === 'paused' ? sub.nextRenewal : step(c.date, sub.cycle));
      if (periodEnd < start || c.date > end) return;
      ranges.push({ id: `period-${c.id}`, resourceId: sub.id, startDate: c.date, endDate: periodEnd, name: c.status === 'failed' ? `${money(c.amount)} failed` : `${money(c.amount)} paid`, timeRangeColor: c.status === 'failed' ? 'red' : 'gray' });
      if (c.status === 'failed') marker(`failed-${c.id}`, sub.id, c.date, 'failed', 'Payment failed', `${money(c.amount)} could not be collected.`);
      const prev = charges[n - 1];
      if (prev && c.amount > prev.amount) marker(`price-${c.id}`, sub.id, c.date, 'price', `${money(prev.amount)} to ${money(c.amount)}`, `Price rose from ${money(prev.amount)} to ${money(c.amount)}.`);
    });

    if (!live) continue;
    const first = sub.status === 'trial' && sub.trialEndsAt ? sub.trialEndsAt : sub.nextRenewal;
    if (sub.status === 'trial' && sub.trialEndsAt) ranges.push({ id: `trial-${sub.id}`, resourceId: sub.id, startDate: sub.startedAt, endDate: sub.trialEndsAt, name: 'Free trial', timeRangeColor: 'orange' });
    // The period the next charge would buy: what a cancel or pause removes.
    ranges.push({ id: `next-${sub.id}`, resourceId: sub.id, startDate: first, endDate: step(first, sub.cycle), name: `${money(sub.price)} due`, timeRangeColor: i.verdict === 'unused' || i.verdict === 'poor' ? 'orange' : 'green' });
    // Every charge in the coming year, so the summary row and the long views add up.
    for (let date = first, n = 0; date <= end && n < 60; date = step(date, sub.cycle), n++) {
      const trial = n === 0 && sub.status === 'trial';
      marker(`${trial ? 'trialend' : 'renew'}-${sub.id}-${date}`, sub.id, date, trial ? 'trial' : 'renewal', trial ? `Starts charging ${money(sub.price)}` : money(sub.price), `${sub.name} charges ${money(sub.price)} to your ${sub.rail === 'paypal' ? 'PayPal' : sub.rail === 'bank' ? 'bank account' : 'card'}.`, { amount: sub.price, next: n === 0 });
    }
  }

  for (const a of state.actions) {
    if (a.status === 'pending') marker(`deadline-${a.id}`, a.subId, a.deadline, 'deadline', a.title, a.reason);
    if (a.status === 'executed' && a.resolvedAt) marker(`done-${a.id}`, a.subId, iso(new Date(a.resolvedAt)), 'done', a.title, a.steps.at(-1)?.label ?? 'Done');
  }
  for (const n of state.notes) marker(n.id, n.subId, n.date, n.kind, n.kind === 'review' ? 'Review' : n.label, n.label);

  return { resources, ranges, events, start, end, now };
}

/** The slice of a Bryntum record this file reads. */
interface Rec {
  id: string | number;
  name: string;
  startDate: Date;
  getData: (field: string) => unknown;
}
const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const SPANS = [
  { text: '6 weeks', past: 7, future: 35 },
  { text: '3 months', past: 7, future: 90 },
  { text: 'Year', past: 14, future: 365 },
];

export default function Timeline() {
  const { state, mutate, refresh } = useApp();
  const scheduler = useRef<BryntumScheduler>(null);
  const model = useMemo(() => (state ? build(state) : null), [state]);
  if (!state || !model) return <Loader label="Loading timeline" />;

  const instance = () => scheduler.current?.instance;
  const span = (past: number, future: number) => void instance()?.zoomToSpan({ startDate: new Date(addDays(model.now, -past)), endDate: new Date(addDays(model.now, future)) });
  const act = (subId: string, action: 'cancel' | 'pause') => void mutate('/api/transactions', { intent: 'act', subId, action });
  const next7 = model.events.filter((e) => (e as { amount?: number; startDate: string }).amount && (e as { startDate: string }).startDate >= model.now && (e as { startDate: string }).startDate <= addDays(model.now, 7));
  const dueThisWeek = next7.reduce((t, e) => t + ((e as { amount?: number }).amount ?? 0), 0);

  return (
    <div className="flex h-full min-h-[560px] flex-col">
      {/* Bryntum ships compiled CSS; it is served from public/vendor (see scripts/copy-vendor.mjs). */}
      {VENDOR_CSS.map((href) => (
        <link key={href} rel="stylesheet" href={href} precedence="vendor" />
      ))}
      <header className="flex flex-wrap items-end justify-between gap-3 px-4 pb-5 pt-6 md:px-8">
        <div>
          <p className="eyebrow">{next7.length > 0 ? `${money(Math.round(dueThisWeek * 100) / 100)} due in the next 7 days` : 'Nothing due this week'}</p>
          <h1 className="mt-0.5 text-[34px] font-semibold tracking-[-0.03em]">Timeline</h1>
        </div>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted" aria-label="Legend">
          {(['renewal', 'trial', 'deadline', 'failed', 'price', 'review'] as Kind[]).map((k) => (
            <li key={k} className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rotate-45" style={{ background: `var(--b-color-${KIND[k].color}, ${KIND[k].color})` }} aria-hidden="true" />
              {KIND[k].legend}
            </li>
          ))}
        </ul>
      </header>

      <div className="subster-timeline panel mx-4 mb-6 min-h-0 flex-1 overflow-hidden md:mx-8">
        <BryntumScheduler
          ref={scheduler}
          startDate={model.start}
          endDate={model.end}
          viewPreset="weekAndDayLetter"
          milestoneLayoutMode="estimate"
          visibleDate={{ date: new Date(addDays(model.now, -5)), block: 'start' }}
          rowHeight={60}
          barMargin={12}
          resources={model.resources}
          events={model.events}
          resourceTimeRanges={model.ranges}
          timeRanges={[{ id: 'week', startDate: model.now, endDate: addDays(model.now, 7), name: 'This week', cls: 'subster-week' }]}
          // The toolbar, menus and renderers are typed loosely: Bryntum's prop types are narrower than the configs its docs describe.
          tbar={[
            {
              type: 'textfield',
              placeholder: 'Find a subscription',
              clearable: true,
              width: 220,
              keyStrokeChangeDelay: 120,
              triggers: { search: { cls: 'fa fa-magnifying-glass', align: 'start' } },
              onChange: ({ value }: { value: string }) => {
                const store = instance()?.resourceStore;
                const needle = (value ?? '').trim().toLowerCase();
                if (needle) store?.filter({ id: 'find', filterBy: (r: Rec) => r.name.toLowerCase().includes(needle) });
                else store?.removeFilter('find');
              },
            },
            {
              type: 'buttongroup',
              toggleGroup: true,
              items: SPANS.map((s, n) => ({ text: s.text, pressed: n === 0, onClick: () => span(s.past, s.future) })),
            },
            { type: 'button', text: 'Today', icon: 'fa fa-calendar-day', onClick: () => void instance()?.scrollToNow({ block: 'center', animate: true }) },
            '->',
            {
              type: 'button',
              text: 'Needs me',
              icon: 'fa fa-flag',
              toggleable: true,
              tooltip: 'Only subscriptions with a decision waiting or a charge to avoid this week',
              onToggle: ({ pressed }: { pressed: boolean }) => {
                const store = instance()?.resourceStore;
                if (pressed) store?.filter({ id: 'needs', filterBy: (r: Rec) => Boolean(r.getData('needsMe')) });
                else store?.removeFilter('needs');
              },
            },
            {
              type: 'button',
              text: 'By category',
              icon: 'fa fa-layer-group',
              toggleable: true,
              pressed: true,
              onToggle: ({ pressed }: { pressed: boolean }) => {
                const store = instance()?.resourceStore;
                if (pressed) store?.group('category');
                else store?.clearGroupers();
              },
            },
            { type: 'button', icon: 'fa fa-magnifying-glass-minus', tooltip: 'Zoom out', onClick: () => void instance()?.zoomOut() },
            { type: 'button', icon: 'fa fa-magnifying-glass-plus', tooltip: 'Zoom in', onClick: () => void instance()?.zoomIn() },
          ] as never}
          // Structure
          groupFeature="category"
          groupSummaryFeature={
            {
              collapseToHeader: true,
              // The same sum per category: what each group is charged in each tick.
              summaries: [
                {
                  label: 'Charged',
                  renderer: ({ events }: { events: Rec[] }) => {
                    const total = events.reduce((sum, e) => sum + (Number(e.getData('amount')) || 0), 0);
                    return total > 0 ? (total >= 1000 ? `${(total / 1000).toFixed(1)}k` : String(Math.round(total))) : '';
                  },
                },
              ],
            } as never
          }
          summaryFeature={{
            // What is charged in each day, week or month on screen.
            renderer: ({ events }: { events: Rec[] }) => {
              const total = events.reduce((sum, e) => sum + (Number(e.getData('amount')) || 0), 0);
              // Ticks can be a single day wide, so the figure is kept short; the tooltip and the rows carry the detail.
              return total > 0 ? `<span class="subster-sum" title="${StringHelper.encodeHtml(money(Math.round(total)))} charged">${total >= 1000 ? `${(total / 1000).toFixed(1)}k` : Math.round(total)}</span>` : '';
            },
          } as never}
          sortFeature="name"
          stripeFeature
          columnLinesFeature
          // Time
          resourceTimeRangesFeature
          timeRangesFeature={{ showCurrentTimeLine: true, showHeaderElements: true }}
          panFeature
          zoomOnMouseWheel
          // Only reminders move; everything else is a fact.
          eventDragFeature={{ constrainDragToResource: true }}
          eventResizeFeature={false}
          eventEditFeature={false}
          eventDragCreateFeature={false}
          cellEditFeature={false}
          cellMenuFeature={false}
          onBeforeEventAdd={() => false}
          eventMenuFeature={{
            items: {
              editEvent: false,
              deleteEvent: false,
              copyEvent: false,
              cutEvent: false,
              unassignEvent: false,
              splitEvent: false,
              pause: { text: 'Pause this subscription', icon: 'fa fa-pause', onItem: ({ eventRecord }: { eventRecord: Rec }) => act(String(eventRecord.getData('resourceId')), 'pause') },
              cancel: { text: 'Cancel before this charge', icon: 'fa fa-ban', onItem: ({ eventRecord }: { eventRecord: Rec }) => act(String(eventRecord.getData('resourceId')), 'cancel') },
              remind: {
                text: 'Remind me two days before',
                icon: 'fa fa-bell',
                onItem: ({ eventRecord }: { eventRecord: Rec }) => void mutate('/api/notes/new', { subId: eventRecord.getData('resourceId'), date: localDay(new Date(eventRecord.startDate.getTime() - 2 * 86_400_000)) }),
              },
              remove: { text: 'Remove reminder', icon: 'fa fa-trash', onItem: ({ eventRecord }: { eventRecord: Rec }) => void mutate(`/api/notes/${eventRecord.id}`, undefined, 'DELETE') },
            },
            // A charge can be paused, cancelled or given a reminder; a reminder can be removed; the rest are facts.
            processItems: ({ eventRecord, items }: { eventRecord: Rec; items: Record<string, unknown> }) => {
              const kind = eventRecord.getData('kind') as Kind;
              const charge = kind === 'renewal' || kind === 'trial';
              const upcoming = localDay(eventRecord.startDate) >= model.now;
              if (!charge || !upcoming) items.pause = items.cancel = items.remind = false;
              if (kind === 'trial') items.pause = false;
              if (charge && localDay(eventRecord.startDate) <= addDays(model.now, 2)) items.remind = false;
              if (kind !== 'review') items.remove = false;
              return charge || kind === 'review';
            },
          } as never}
          scheduleMenuFeature={{
            items: {
              addEvent: false,
              pasteEvent: false,
              splitResource: false,
              remind: {
                text: 'Remind me to review on this day',
                icon: 'fa fa-bell',
                onItem: ({ resourceRecord, date }: { resourceRecord: Rec; date: Date }) => void mutate('/api/notes/new', { subId: resourceRecord.id, date: localDay(date) }),
              },
            },
            processItems: ({ date }: { date: Date }) => localDay(date) >= model.now,
          } as never}
          eventTooltipFeature={{
            template: ({ eventRecord }: { eventRecord: Rec }) => {
              const kind = eventRecord.getData('kind') as Kind;
              return `<div style="max-width:280px"><div style="font-size:11px;opacity:.7">${StringHelper.encodeHtml(KIND[kind].legend)} · ${StringHelper.encodeHtml(shortDate(localDay(eventRecord.startDate)))}</div><strong>${StringHelper.encodeHtml(eventRecord.name)}</strong><div style="margin-top:4px">${StringHelper.encodeHtml(String(eventRecord.getData('note') ?? ''))}</div>${kind === 'review' ? '<div style="margin-top:6px;opacity:.7">Drag to move. Right-click to remove.</div>' : kind === 'renewal' || kind === 'trial' ? '<div style="margin-top:6px;opacity:.7">Right-click to pause, cancel or set a reminder.</div>' : ''}</div>`;
            },
          } as never}
          columns={[
            {
              text: 'Subscription',
              field: 'name',
              width: 230,
              htmlEncode: false,
              renderer: ({ record }: { record: Rec }) => {
                if (!record.getData('status')) return StringHelper.encodeHtml(String(record.name ?? ''));
                const off = record.getData('status') === 'paused';
                return `<div style="display:flex;align-items:center;gap:10px;${off ? 'opacity:.5' : ''}">
                  ${logoHtml(record.getData('providerId') as string | undefined, record.name, String(record.getData('color')))}
                  <span style="min-width:0"><span style="display:block;font-weight:600;overflow:hidden;text-overflow:ellipsis">${StringHelper.encodeHtml(record.name)}</span>
                  <span style="display:block;font-size:12px;color:var(--faint)">${StringHelper.encodeHtml(String(record.getData('plan')))}${record.getData('paypal') ? ' · PayPal' : ''}${off ? ' · paused' : ''}</span></span>
                </div>`;
              },
            },
            {
              text: 'A month',
              field: 'monthly',
              type: 'number',
              width: 104,
              align: 'right',
              sum: 'sum',
              htmlEncode: false,
              renderer: ({ value }: { value: number }) => (value ? StringHelper.encodeHtml(money(value)) : ''),
              summaryRenderer: ({ sum }: { sum: number }) => `<strong>${StringHelper.encodeHtml(money(Math.round(sum * 100) / 100))}</strong>`,
            },
            {
              text: 'Value',
              field: 'verdict',
              width: 124,
              htmlEncode: false,
              renderer: ({ value }: { value: Verdict }) => (VERDICT_LABEL[value] ? `<span style="display:inline-flex;align-items:center;gap:6px;font-size:12px"><span style="width:8px;height:8px;border-radius:50%;background:${VERDICT_COLOR[value]}"></span>${VERDICT_LABEL[value]}</span>` : ''),
            },
          ] as never}
          onEventDrop={({ eventRecords }) => {
            const moved = eventRecords[0] as unknown as Rec | undefined;
            if (!moved || moved.getData('kind') !== 'review') return;
            void mutate(`/api/notes/${moved.id}`, { date: localDay(new Date(moved.startDate)) }).then((res) => {
              if (!res.ok) void refresh(); // snap back to the stored date
            });
          }}
        />
      </div>
    </div>
  );
}
