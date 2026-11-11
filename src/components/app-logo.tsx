// The logo for a subscription app. Three sources, best first:
//   1. the brand mark bundled from Simple Icons (domain/logos.gen.ts);
//   2. the provider's own site icon, fetched through Google's favicon service, for brands that
//      library does not carry (this is the one place the browser contacts a third party, and it
//      sends only the provider's public domain name);
//   3. the category icon, if neither is available.

import { useState } from 'react';
import { providerById, type Provider } from '@/domain/catalog';
import { LOGOS } from '@/domain/logos.gen';
import type { Category } from '@/domain/types';
import { CATEGORY_ICON } from './category-icon';

/** Where the account page sits on a shared corporate domain, the product's own site has the right icon. */
const ICON_DOMAIN: Record<string, string> = {
  'prime-video': 'primevideo.com',
  'xbox-game-pass': 'xbox.com',
  'amazon-music-unlimited': 'music.amazon.com',
  'amazon-web-services': 'aws.amazon.com',
  'microsoft-azure': 'azure.microsoft.com',
  'microsoft-copilot-pro': 'copilot.microsoft.com',
  'microsoft-365': 'microsoft365.com',
  onedrive: 'onedrive.com',
  'minecraft-realms': 'minecraft.net',
  'chatgpt-plus': 'chatgpt.com',
  'times-of-india-plus': 'timesofindia.indiatimes.com',
  'kindle-unlimited': 'kindle.amazon.com',
  'google-fi': 'fi.google.com',
  'apple-fitness-plus': 'fitness.apple.com',
};

/** The provider's main domain: account pages live on subdomains that often have no icon of their own. */
function mainDomain(url: string) {
  const labels = new URL(url).hostname.split('.');
  const twoPartSuffix = /^(co|com|org|net)\.[a-z]{2}$/.test(labels.slice(-2).join('.'));
  return labels.slice(twoPartSuffix ? -3 : -2).join('.');
}

const siteIcon = (app: Provider) => {
  const domain = ICON_DOMAIN[app.id] ?? mainDomain(app.manageUrl);
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`;
};

/** Relative luminance of a #rrggbb colour, 0 (black) to 1 (white). */
function luminance(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Inline rather than utility classes: the logo is also drawn inside AG Studio widgets.
const TILE = { display: 'flex', flexShrink: 0, alignItems: 'center', justifyContent: 'center' } as const;

interface Props {
  /** Catalog id. Subscriptions that are not in the catalog pass their category and colour instead. */
  providerId?: string;
  category: Category;
  color: string;
  size?: number;
}

export function AppLogo({ providerId, category, color, size = 40 }: Props) {
  const app = providerId ? providerById(providerId) : undefined;
  const mark = providerId ? LOGOS[providerId] : undefined;
  const [iconFailed, setIconFailed] = useState(false);
  const radius = Math.round(size * 0.28);

  if (mark) {
    const light = luminance(mark.hex);
    // Near-black brand colours vanish on a dark page, so those marks sit on a neutral tile.
    const background = light < 0.03 ? '#262b36' : mark.hex;
    const glyph = light > 0.6 ? '#111318' : '#ffffff';
    return (
      <span style={{ ...TILE, width: size, height: size, borderRadius: radius, background }} role="img" aria-label={`${mark.title} logo`}>
        <svg viewBox="0 0 24 24" width={size * 0.56} height={size * 0.56} fill={glyph} aria-hidden="true">
          <path d={mark.path} />
        </svg>
      </span>
    );
  }

  if (app && !iconFailed) {
    return (
      <span style={{ ...TILE, overflow: 'hidden', background: '#ffffff', width: size, height: size, borderRadius: radius }}>
        <img src={siteIcon(app)} alt={`${app.name} logo`} width={Math.round(size * 0.68)} height={Math.round(size * 0.68)} loading="lazy" referrerPolicy="no-referrer" onError={() => setIconFailed(true)} />
      </span>
    );
  }

  const Icon = CATEGORY_ICON[category];
  return (
    <span style={{ ...TILE, color: '#ffffff', width: size, height: size, borderRadius: radius, background: `linear-gradient(150deg, ${color}, color-mix(in oklab, ${color} 55%, #0a0d14))` }} aria-hidden="true">
      <Icon size={size * 0.45} strokeWidth={1.75} />
    </span>
  );
}
