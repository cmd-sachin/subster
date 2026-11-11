import { createFileRoute, Link } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { AgentPanel } from '@/components/agent-panel';
import { useApp } from '@/components/app-state';
import { Inbox } from '@/components/inbox';
import { CategoryBar, MetricStrip, Upcoming, UsageTrend } from '@/components/overview';
import { Setup } from '@/components/setup';
import { SubscriptionTable } from '@/components/subscription-table';
import { greeting, Welcome } from '@/components/welcome';
import { Loader } from '@/components/loader';

export const Route = createFileRoute('/')({ component: CommandCenter });

function CommandCenter() {
  const { state } = useApp();
  if (!state) return <Loader label="Loading your subscriptions" />;
  const empty = state.portfolio.insights.length === 0;
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="mx-auto max-w-[1280px] space-y-5 px-4 py-8 md:px-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">{today}</p>
          <h1 className="mt-0.5 text-[34px] font-semibold tracking-[-0.03em]">{empty ? 'Welcome to Subster' : greeting()}</h1>
        </div>
        <Link to="/services" className="flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-[13px] font-semibold text-white hover:opacity-90">
          <Plus size={15} strokeWidth={2.5} aria-hidden="true" />
          Add subscription
        </Link>
      </header>

      {!empty && <Welcome state={state} />}
      <Setup state={state} />
      {!empty && <MetricStrip portfolio={state.portfolio} />}

      <div className="grid gap-4 xl:grid-cols-12">
        <div className="space-y-4 xl:col-span-8">
          <Inbox />
          {!empty && <UsageTrend portfolio={state.portfolio} />}
          {!empty && <SubscriptionTable />}
        </div>
        <div className="space-y-4 xl:col-span-4">
          <AgentPanel />
          {!empty && <Upcoming portfolio={state.portfolio} />}
          {!empty && <CategoryBar portfolio={state.portfolio} />}
        </div>
      </div>

    </div>
  );
}

