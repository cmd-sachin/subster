// The way in to the assistant from the home page: one box and three ideas. The conversation itself
// happens on the Assistant page, where it is kept.

import { useNavigate } from '@tanstack/react-router';
import { ArrowUp } from 'lucide-react';
import { useState } from 'react';

const IDEAS = ['What can I cancel to save money?', 'What will I be charged in the next 30 days?', 'Run an audit'];

export function AskCard() {
  const navigate = useNavigate();
  const [input, setInput] = useState('');
  const ask = (q: string) => q.trim() && void navigate({ to: '/chat', search: { q: q.trim() } });

  return (
    <section className="panel p-5" aria-label="Ask Subster">
      <div className="flex items-center gap-2.5">
        <img src="/logo-mark.png" alt="" className="h-7 w-7" />
        <h2 className="text-[16px] font-medium">Ask Subster</h2>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
        className="mt-4 flex items-center gap-2 rounded-full border border-white/10 bg-black/60 p-1.5 pl-4 focus-within:border-white/30"
      >
        <label htmlFor="ask-input" className="sr-only">
          Ask Subster
        </label>
        <input id="ask-input" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about your subscriptions" autoComplete="off" style={{ outline: 'none' }} className="min-w-0 flex-1 bg-transparent text-[14px] placeholder:text-faint" />
        <button type="submit" disabled={!input.trim()} aria-label="Ask" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent text-on disabled:opacity-25" style={{ padding: 0 }}>
          <ArrowUp size={17} strokeWidth={2.25} aria-hidden="true" />
        </button>
      </form>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {IDEAS.map((idea) => (
          <button key={idea} onClick={() => ask(idea)} className="rounded-full border border-white/10 px-3 py-1.5 text-[12px] text-muted transition-colors hover:border-white/30 hover:text-ink">
            {idea}
          </button>
        ))}
      </div>
    </section>
  );
}
