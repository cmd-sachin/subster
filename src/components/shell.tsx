import { Link, useLocation } from '@tanstack/react-router';
import { CalendarRange, ChartColumn, UserCog, ChevronsLeft, ChevronsRight, House, LayoutGrid, MessageCircle, PiggyBank, Plug, Receipt } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { setCurrency } from '@/domain/dates';
import { useApp } from './app-state';
import { BellMenu } from './notifications';
import { AccountMenu, useSession } from './session';
import { openTour } from './walkthrough';

// Grouped by what you come to do: look, manage money, plan ahead, set up.
const GROUPS = [
  {
    title: 'Today',
    items: [
      { href: '/', label: 'Home', icon: House },
      { href: '/chat', label: 'Assistant', icon: MessageCircle },
    ],
  },
  {
    title: 'Money',
    items: [
      { href: '/savings', label: 'Savings', icon: PiggyBank },
      { href: '/services', label: 'Services', icon: LayoutGrid },
      { href: '/transactions', label: 'Payments', icon: Receipt },
    ],
  },
  {
    title: 'Ahead',
    items: [
      { href: '/timeline', label: 'Timeline', icon: CalendarRange },
      { href: '/analytics', label: 'Insights', icon: ChartColumn },
    ],
  },
  { title: 'Setup', items: [{ href: '/connect', label: 'Connect', icon: Plug }] },
] as const;

// Whether the sidebar is open wide. Remembered in the browser; read through a store so the first
// paint on the server and in the browser agree.
const WIDE_KEY = 'subster.sidebar';
const listeners = new Set<() => void>();
const readWide = () => {
  try {
    return localStorage.getItem(WIDE_KEY) === 'wide';
  } catch {
    return false;
  }
};
function setWide(wide: boolean) {
  try {
    localStorage.setItem(WIDE_KEY, wide ? 'wide' : 'slim');
  } catch {
    /* not remembered in private mode */
  }
  listeners.forEach((l) => l());
}
const subscribeWide = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = useLocation({ select: (location) => location.pathname });
  const { state, error } = useApp();
  const wide = useSyncExternalStore(subscribeWide, readWide, () => false);
  // Amount formatting everywhere reads the user's currency from one place.
  if (state) setCurrency(state.settings.currency);
  const pending = state?.actions.filter((a) => a.status === 'pending' || (a.type === 'subscribe' && a.status === 'guided')).length ?? 0;
  const paypal = state?.integrations.paypal;
  const { me } = useSession();
  const admin = me?.user?.role === 'admin' && !me.singleUser;
  const groups = admin ? GROUPS.map((g) => (g.title === 'Setup' ? { ...g, items: [...g.items, { href: '/admin', label: 'Admin', icon: UserCog }] } : g)) : GROUPS;

  return (
    <div className="flex h-full flex-col md:flex-row">
      {/* The sidebar is a floating dock: one white card set in from the edge. Slim, it is icons
          with a name on hover; opened wide, it shows the names and the groups. */}
      <aside className={`z-30 shrink-0 p-2 transition-[width] duration-300 ease-out md:py-3 md:pl-3 md:pr-0 ${wide ? 'md:w-[236px]' : 'md:w-[76px]'}`}>
        <div className="panel flex h-full items-center gap-1 overflow-x-auto p-1.5 md:flex-col md:items-stretch md:gap-0 md:overflow-visible md:p-2.5">
          <Link to="/" aria-label="Subster, home" className={`flex shrink-0 items-center gap-2.5 md:mb-3 md:h-11 ${wide ? 'md:px-1.5' : 'md:justify-center'}`}>
            <img src="/logo-mark.png" alt="" className="h-8 w-8" />
            {wide && <span className="hidden text-[18px] font-semibold tracking-[-0.03em] md:block">Subster</span>}
          </Link>

          <nav className="flex gap-1 md:min-h-0 md:flex-1 md:flex-col md:gap-0 md:overflow-y-auto md:overflow-x-visible" aria-label="Main">
            {groups.map((group, g) => (
              <div key={group.title} className={`flex gap-1 md:flex-col md:gap-0.5 ${g === groups.length - 1 ? 'md:mt-auto' : ''}`}>
                {wide ? <p className="hidden px-2.5 pb-1 pt-3 text-[11px] font-medium text-faint md:block">{group.title}</p> : g > 0 && <span className="mx-auto my-2 hidden h-px w-6 bg-white/10 md:block" aria-hidden="true" />}
                {group.items.map((item) => {
                  const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
                  const Icon = item.icon;
                  const count = item.href === '/' ? pending : 0;
                  return (
                    <Link
                      key={item.href}
                      to={item.href}
                      aria-current={active ? 'page' : undefined}
                      aria-label={item.label}
                      className={`group relative flex h-11 shrink-0 items-center gap-3 rounded-[14px] text-[14px] transition-colors ${wide ? 'px-3' : 'w-11 justify-center md:mx-auto'} ${
                        active ? 'brand-blue font-medium text-on shadow-[0_10px_20px_-10px_rgba(4,115,253,0.8)]' : 'text-muted hover:bg-accent-soft hover:text-accent'
                      }`}
                    >
                      {/* The logo's yellow marks where you are. */}
                      {active && <span className="absolute -left-2.5 top-1/2 hidden h-5 w-1 -translate-y-1/2 rounded-r-full bg-sun md:block" aria-hidden="true" />}
                      <Icon size={19} strokeWidth={1.75} className="shrink-0" aria-hidden="true" />
                      {wide && <span className="hidden flex-1 md:block">{item.label}</span>}
                      {count > 0 &&
                        (wide ? (
                          <span className={`num hidden h-5 min-w-5 place-items-center rounded-full px-1 text-[11px] font-semibold md:grid ${active ? 'bg-sun text-ink' : 'bg-accent text-on'}`}>{count}</span>
                        ) : (
                          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-sun ring-2 ring-black" aria-hidden="true" />
                        ))}
                      {!wide && (
                        <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 hidden -translate-y-1/2 whitespace-nowrap rounded-full bg-ink px-3 py-1.5 text-[12px] font-medium text-on opacity-0 shadow-lg transition-opacity delay-150 group-hover:opacity-100 group-focus-visible:opacity-100 md:block">
                          {item.label}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>

          <button
            onClick={() => setWide(!wide)}
            aria-expanded={wide}
            aria-label={wide ? 'Make the sidebar slim' : 'Open the sidebar wide'}
            className={`mt-1 hidden h-10 shrink-0 items-center gap-3 rounded-[14px] border-t border-white/[0.06] text-[13px] text-faint transition-colors hover:text-accent md:flex ${wide ? 'px-3' : 'justify-center'}`}
          >
            {wide ? <ChevronsLeft size={17} aria-hidden="true" /> : <ChevronsRight size={17} aria-hidden="true" />}
            {wide && 'Collapse'}
          </button>
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 flex-wrap items-center justify-end gap-2 px-4 pb-1 pt-3 md:px-8 md:pt-4">
          {me && !me.persistent && (
            <span className="rounded-full bg-bad-soft px-3 py-1.5 text-[12px] font-medium text-bad" title="This deployment has no storage connected, so sign-ins and data are lost between requests. Connect the database and redeploy.">
              Storage not connected
            </span>
          )}
          {state?.demo && (
            <button onClick={openTour} className="rounded-full bg-sun-soft px-3 py-1.5 text-[12px] font-medium" title="This is sample data, not your own. Open the walkthrough to end the demo.">
              Demo mode
            </button>
          )}
          {paypal && (
            <Link to="/connect" className="flex items-center gap-2 rounded-full bg-black/70 px-3 py-1.5 text-[12px] shadow-sm">
              <span className={`h-1.5 w-1.5 rounded-full ${paypal === 'off' ? 'bg-warn' : 'bg-good'}`} aria-hidden="true" />
              PayPal {paypal === 'off' ? 'not connected' : paypal === 'live' ? 'live' : 'test mode'}
            </Link>
          )}
          <BellMenu pending={pending} />
          <AccountMenu />
        </header>
        <main className="min-h-0 min-w-0 flex-1 overflow-auto">
          {error && (
            <div role="alert" className="mx-5 mb-2 rounded-full bg-bad-soft px-4 py-1.5 text-[13px] text-bad md:mx-8">
              Reconnecting
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
