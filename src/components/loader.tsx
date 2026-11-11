// The loading state everywhere: the Subster mark, breathing, inside a turning ring in its two
// colours. Motion stops for people who ask their system for less of it; the label stays.

export function Loader({ label = 'Loading', fill = true }: { label?: string; fill?: boolean }) {
  return (
    <div role="status" aria-live="polite" className={`flex flex-col items-center justify-center gap-4 ${fill ? 'h-full min-h-[60vh]' : 'py-10'}`}>
      <span className="subster-loader" aria-hidden="true">
        <img src="/logo-mark.png" alt="" width={44} height={44} />
      </span>
      <span className="text-[13px] text-muted">{label}</span>
    </div>
  );
}
