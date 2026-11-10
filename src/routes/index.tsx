import { createFileRoute, Link } from '@tanstack/react-router';
import { FileUp, Landmark, LayoutGrid } from 'lucide-react';
import { AgentPanel } from '@/components/agent-panel';
import { useApp } from '@/components/app-state';
import { Categories } from '@/components/categories';
import { Hero } from '@/components/hero';
import { Inbox } from '@/components/inbox';
import { SubscriptionTable } from '@/components/subscription-table';

export const Route = createFileRoute('/')({ component: CommandCenter });

function CommandCenter() {
  const { state } = useApp();
  if (!state) return <p className="p-8 text-muted">Loading your subscriptions</p>;
  const empty = state.portfolio.insights.length === 0;

  return (
    <div className="mx-auto max-w-[1320px] space-y-5 px-4 py-7 md:px-8">
      <header>
        <h1 className="text-[26px] font-semibold tracking-tight">Every subscription should earn its place.</h1>
        <p className="mt-1.5 max-w-2xl text-[14px] leading-relaxed text-muted">
          SubSense compares what each subscription costs with how much you actually use it, then proposes what to do before the next charge. You approve, it acts.
        </p>
      </header>

      {empty ? (
        <section className="panel p-6" aria-label="Get started">
          <h2 className="text-[17px] font-semibold">Start with your own data</h2>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-muted">Nothing here is sample data. Bring in your payments and SubSense finds the subscriptions in them.</p>
          <ol className="mt-5 grid gap-3 md:grid-cols-3">
            <Step n={1} icon={Landmark} title="Link your bank" body="Sign in to your bank through Plaid or your Account Aggregator. Read-only." to="/connect" cta="Link a bank" />
            <Step n={2} icon={FileUp} title="Or upload a statement" body="Any bank or card. Download the CSV from net banking and drop it in." to="/connect" cta="Upload a statement" />
            <Step n={3} icon={LayoutGrid} title="Or pick your services" body="Browse the services directory and add what you pay for, or subscribe to something new." to="/services" cta="Browse services" />
          </ol>
        </section>
      ) : (
        <>
          <Hero portfolio={state.portfolio} />
          <Categories portfolio={state.portfolio} />
        </>
      )}

      <div className="grid gap-5 xl:grid-cols-[1.25fr_1fr]">
        <Inbox />
        <AgentPanel />
      </div>

      {!empty && <SubscriptionTable />}
    </div>
  );
}

function Step({ n, icon: Icon, title, body, to, cta }: { n: number; icon: typeof Landmark; title: string; body: string; to: '/connect' | '/services'; cta: string }) {
  return (
    <li className="flex flex-col rounded-2xl border border-white/[0.07] bg-black/20 p-4">
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.07]" aria-hidden="true">
        <Icon size={17} strokeWidth={1.75} />
      </span>
      <h3 className="mt-3 text-[14px] font-semibold">
        <span className="num mr-1.5 text-faint">{n}</span>
        {title}
      </h3>
      <p className="mt-1 flex-1 text-[13px] leading-relaxed text-muted">{body}</p>
      <Link to={to} className="mt-3 w-fit rounded-xl bg-accent px-3 py-1.5 text-[13px] font-semibold text-canvas hover:opacity-90">
        {cta}
      </Link>
    </li>
  );
}
