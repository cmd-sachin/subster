// PayPal's monogram (from Simple Icons) beside its name in plain type. The name is not restyled
// to look like the logo: a brand's own mark is used as it is or not at all.

const MONOGRAM = 'M15.607 4.653H8.941L6.645 19.251H1.82L4.862 0h7.995c3.754 0 6.375 2.294 6.473 5.513-.648-.478-2.105-.86-3.722-.86m6.57 5.546c0 3.41-3.01 6.853-6.958 6.853h-2.493L11.595 24H6.74l1.845-11.538h3.592c4.208 0 7.346-3.634 7.153-6.949a5.24 5.24 0 0 1 2.848 4.686M9.653 5.546h6.408c.907 0 1.942.222 2.363.541-.195 2.741-2.655 5.483-6.441 5.483H8.714Z';

export function PayPalMark({ size = 13 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-1 font-semibold" aria-label="PayPal">
      <svg viewBox="0 0 24 24" width={size} height={size} fill="#4a9dff" aria-hidden="true">
        <path d={MONOGRAM} />
      </svg>
      <span aria-hidden="true">PayPal</span>
    </span>
  );
}
