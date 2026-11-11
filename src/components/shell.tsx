import { Link, useLocation } from '@tanstack/react-router';
import { CalendarRange, ChartColumn, LayoutDashboard, LayoutGrid, PiggyBank, Plug, Receipt } from 'lucide-react';
import { setCurrency } from '@/domain/dates';
import { useApp } from './app-state';

const NAV = [
  { href: '/', label: 'Command center', hint: 'Inbox, agent, value', icon: LayoutDashboard },
  { href: '/savings', label: 'Savings', hint: 'Where you can spend less', icon: PiggyBank },
  { href: '/services', label: 'Services', hint: 'Plans, prices, sign-in', icon: LayoutGrid },
  { href: '/transactions', label: 'Transactions', hint: 'Payments, refunds, cancelling', icon: Receipt },
  { href: '/timeline', label: 'Renewal timeline', hint: 'Bryntum Scheduler', icon: CalendarRange },
  { href: '/analytics', label: 'Analytics', hint: 'AG Studio', icon: ChartColumn },
  { href: '/connect', label: 'Connections', hint: 'Bank, PayPal, usage', icon: Plug },
] as const;

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = useLocation({ select: (location) => location.pathname });
  const { state, error } = useApp();
  // Amount formatting everywhere reads the user's currency from one place.
  if (state) setCurrency(state.settings.currency);
  const pending = state?.actions.filter((a) => a.status === 'pending' || (a.type === 'subscribe' && a.status === 'guided')).length ?? 0;
  const integrations = state?.integrations;

  return (
    <div className="flex h-full flex-col md:flex-row">
      <aside className="flex shrink-0 flex-col border-b border-white/[0.06] bg-black/25 backdrop-blur-xl md:w-[232px] md:border-b-0 md:border-r">
        <div className="px-5 pb-2 pt-6">
          <Link to="/" aria-label="Subster, command center">
            <img src="/logo.png" alt="Subster" width={148} height={44} className="h-auto w-[148px]" />
          </Link>
          <p className="mt-1.5 text-[11px] leading-tight text-faint">Your subscriptions, looked after</p>
          {state?.demo && (
            <Link to="/connect" className="mt-2 inline-block rounded-full bg-warn-soft px-2 py-0.5 text-[11px] font-medium text-warn" title="This is sample data, not your own. Close it on the Connections page.">
              Demo data
            </Link>
          )}
        </div>

        <nav className="flex gap-1 overflow-x-auto px-3 py-4 md:flex-col md:overflow-visible" aria-label="Main">
          {NAV.map((item) => {
            const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                to={item.href}
                aria-current={active ? 'page' : undefined}
                className={`flex shrink-0 items-center gap-3 rounded-xl px-3 py-2.5 transition-colors ${active ? 'bg-info-soft text-ink' : 'text-muted hover:bg-white/[0.04] hover:text-ink'}`}
              >
                <Icon size={18} strokeWidth={1.75} className={active ? 'text-accent' : ''} aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium">{item.label}</span>
                  <span className="hidden text-[11px] text-faint md:block">{item.hint}</span>
                </span>
                {item.href === '/' && pending > 0 && (
                  <span className="num rounded-full bg-accent px-1.5 py-0.5 text-[11px] font-semibold text-canvas" aria-label={`${pending} waiting for you`}>
                    {pending}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto hidden space-y-2 border-t border-white/[0.06] px-5 py-4 text-[12px] md:block">
          <Status label="Bank" value={!integrations ? 'checking' : integrations.bank.link ? integrations.bank.link.institution : 'Not linked'} live={Boolean(integrations?.bank.link)} />
          <Status label="PayPal" value={!integrations ? 'checking' : integrations.paypal === 'off' ? 'Not connected' : integrations.paypal === 'live' ? 'Live' : 'Sandbox'} live={integrations ? integrations.paypal !== 'off' : false} />
          <Status label="Agent" value={!integrations ? 'checking' : integrations.agent === 'gemini' ? 'Gemini' : 'Rules engine'} live={integrations?.agent === 'gemini'} />
        </div>
      </aside>

      <main className="min-h-0 min-w-0 flex-1 overflow-auto">
        {error && (
          <div role="alert" className="border-b border-bad/30 bg-bad-soft px-6 py-2 text-[13px] text-bad">
            Could not reach the server: {error}
          </div>
        )}
        {children}
      </main>
    </div>
  );
}

function Status({ label, value, live }: { label: string; value: string; live?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted">{label}</span>
      <span className="flex min-w-0 items-center gap-1.5 font-medium">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${live ? 'bg-good' : 'bg-warn'}`} aria-hidden="true" />
        <span className="truncate">{value}</span>
      </span>
    </div>
  );
}
