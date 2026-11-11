// A small markdown renderer for the agent's replies: paragraphs, lists, bold, italic, code and
// links. It builds React elements only, so nothing the model writes is ever inserted as HTML.

import type { ReactNode } from 'react';

const INLINE = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\(https?:\/\/[^)\s]+\)|https?:\/\/[^\s)<>\]]+[^\s)<>\].,;:!?]|\*[^*\s][^*\n]*\*)/g;

function inline(text: string, key: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    const k = `${key}-${i}`;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4)
      return (
        <strong key={k} className="font-semibold text-ink">
          {part.slice(2, -2)}
        </strong>
      );
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2)
      return (
        <code key={k} className="num rounded bg-white/[0.08] px-1 py-px text-[12px]">
          {part.slice(1, -1)}
        </code>
      );
    const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
    if (link || /^https?:\/\//.test(part)) {
      const href = link ? link[2] : part;
      let label = link ? link[1] : part;
      if (!link) {
        try {
          label = new URL(part).hostname.replace(/^www\./, '');
        } catch {
          /* keep the address as written */
        }
      }
      return (
        <a key={k} href={href} target="_blank" rel="noreferrer" className="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent">
          {label}
        </a>
      );
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) return <em key={k}>{part.slice(1, -1)}</em>;
    return part;
  });
}

type Block = { kind: 'p' | 'h'; text: string } | { kind: 'ul' | 'ol'; items: string[] };

function blocks(source: string): Block[] {
  const out: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) out.push({ kind: 'p', text: paragraph.join(' ') });
    paragraph = [];
  };
  for (const raw of source.replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    const bullet = line.match(/^[-*•]\s+(.*)$/);
    const numbered = line.match(/^\d+[.)]\s+(.*)$/);
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (!line) flush();
    else if (heading) {
      flush();
      out.push({ kind: 'h', text: heading[1].replace(/\*\*/g, '') });
    } else if (bullet || numbered) {
      flush();
      const kind = bullet ? 'ul' : 'ol';
      const last = out[out.length - 1];
      const text = (bullet ?? numbered)![1];
      if (last && last.kind === kind) last.items.push(text);
      else out.push({ kind, items: [text] });
    } else if (/^(-{3,}|\*{3,})$/.test(line)) flush();
    else paragraph.push(line);
  }
  flush();
  return out;
}

export function Markdown({ text, className = '' }: { text: string; className?: string }) {
  return (
    <div className={`space-y-2 text-[13px] leading-relaxed ${className}`}>
      {blocks(text).map((block, i) => {
        if (block.kind === 'h')
          return (
            <p key={i} className="font-semibold text-ink">
              {inline(block.text, `h${i}`)}
            </p>
          );
        if ('text' in block) return <p key={i}>{inline(block.text, `p${i}`)}</p>;
        const List = block.kind;
        return (
          <List key={i} className={`space-y-1 pl-4 ${block.kind === 'ul' ? 'list-disc marker:text-faint' : 'list-decimal marker:text-faint'}`}>
            {block.items.map((item, j) => (
              <li key={j} className="pl-0.5">
                {inline(item, `l${i}-${j}`)}
              </li>
            ))}
          </List>
        );
      })}
    </div>
  );
}
