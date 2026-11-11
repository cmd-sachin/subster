// Provider catalog: every subscription app Subster knows. For each one: how it appears on a bank
// or card statement, which Android app measures its use, where the account is managed and
// cancelled, and its plans. None of these platforms offers a public billing API, so the statement
// descriptor is the integration point for all of them.
//
// Plan prices are indicative list prices and are not fetched live: US dollars, plus rupee prices
// for services that publish an Indian price list. Services sold only in India carry rupee prices
// alone. An app with an empty plan list is one whose prices we could not state with confidence:
// it is still detected, tracked and linked, but cannot be started from here.

import type { BillingCycle, Category, Currency } from './types';

export interface Plan {
  name: string;
  price: number;
  cycle: BillingCycle;
  /** USD unless the provider's regional price is known. */
  currency: Currency;
}

/** How a user's own account at the provider can be linked. */
export type AccountLink =
  | { type: 'oauth'; provider: 'spotify' } // official OAuth: Subster never sees the password
  | { type: 'official' }; // no API: the user signs in on the provider's own site

export interface Provider {
  id: string;
  name: string;
  category: Category;
  /** Matches the merchant text banks print for this service. */
  match: RegExp;
  /** The provider's own account page: sign in, manage the plan, cancel. */
  manageUrl: string;
  androidPackage?: string;
  color: string;
  plans: Plan[];
  account: AccountLink;
}

type PlanSpec = [name: string, price: number, cycle?: BillingCycle, currency?: Currency];

const slug = (name: string) => name.toLowerCase().replace(/\+/g, ' plus').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const p = (name: string, category: Category, match: RegExp, manageUrl: string, color: string, plans: PlanSpec[], androidPackage?: string, account: AccountLink = { type: 'official' }): Provider => ({
  id: slug(name),
  name,
  category,
  match,
  manageUrl,
  color,
  androidPackage,
  plans: plans.map(([planName, price, cycle = 'monthly', currency = 'USD']) => ({ name: planName, price, cycle, currency })),
  account,
});

export const CATALOG: Provider[] = [
  // AI
  p('ChatGPT Plus', 'AI', /openai|chatgpt/i, 'https://chatgpt.com/#settings/Subscription', '#3f8f7a', [['Plus', 20], ['Pro', 200], ['Go', 399, 'monthly', 'INR'], ['Plus', 1999, 'monthly', 'INR'], ['Pro', 19900, 'monthly', 'INR']], 'com.openai.chatgpt'),
  // Plans as listed on claude.com/pricing on 2026-11-10.
  p('Claude', 'AI', /anthropic|claude\.ai/i, 'https://claude.ai/settings/billing', '#b8693d', [['Pro', 20], ['Pro (annual)', 200, 'yearly'], ['Max', 100], ['Ultra', 200]], 'com.anthropic.claude'),
  p('Perplexity Pro', 'AI', /perplexity/i, 'https://www.perplexity.ai/settings/account', '#3a8a94', [['Pro', 20]], 'ai.perplexity.app.android'),
  // India prices as listed on gemini.google/subscriptions on 2026-11-10. The USD entry is an unverified list price.
  p('Google AI (Gemini)', 'AI', /google one ai|gemini advanced|google ai (plus|pro|ultra)|gemini/i, 'https://one.google.com/settings', '#5a78c9', [['AI Pro', 19.99], ['AI Plus', 399, 'monthly', 'INR'], ['AI Pro', 1950, 'monthly', 'INR'], ['AI Ultra', 6500, 'monthly', 'INR'], ['AI Ultra (20x)', 19500, 'monthly', 'INR']], 'com.google.android.apps.bard'),
  p('GitHub Copilot', 'AI', /github/i, 'https://github.com/settings/copilot', '#6e6e8a', [['Pro', 10], ['Pro+', 39]]),
  p('Midjourney', 'AI', /midjourney/i, 'https://www.midjourney.com/account', '#7a6fb0', [['Basic', 10], ['Standard', 30]]),
  p('Cursor', 'AI', /cursor\b.*(ai|pro)|anysphere/i, 'https://cursor.com/settings', '#55607a', [['Pro', 20]]),

  // Entertainment
  p('Netflix', 'Streaming', /netflix/i, 'https://www.netflix.com/account', '#d6453d', [['Standard with ads', 7.99], ['Standard', 17.99], ['Premium 4K', 22.99], ['Mobile', 149, 'monthly', 'INR'], ['Basic', 199, 'monthly', 'INR'], ['Standard', 499, 'monthly', 'INR'], ['Premium 4K', 649, 'monthly', 'INR']], 'com.netflix.mediaclient'),
  p('Prime Video', 'Streaming', /amazon prime|prime video|amzn.*prime/i, 'https://www.amazon.com/gp/video/settings', '#3a8fa3', [['Monthly', 8.99], ['Prime monthly', 299, 'monthly', 'INR'], ['Prime annual', 1499, 'yearly', 'INR']], 'com.amazon.avod.thirdpartyclient'),
  p('JioHotstar', 'Streaming', /hotstar|jiohotstar|novi digital/i, 'https://www.hotstar.com/in/mypage', '#2f5fb3', [['Mobile', 149, 'quarterly', 'INR'], ['Super', 299, 'quarterly', 'INR'], ['Premium', 499, 'quarterly', 'INR'], ['Premium annual', 1499, 'yearly', 'INR']], 'in.startv.hotstar'),
  p('Disney+', 'Streaming', /disney\s*\+|disney plus|disneyplus/i, 'https://www.disneyplus.com/account/subscription', '#3f6fc4', [['Basic with ads', 9.99], ['Premium', 15.99]], 'com.disney.disneyplus'),
  p('SonyLIV', 'Streaming', /sony\s*liv|sonyliv|culver max/i, 'https://www.sonyliv.com/usercenter/subscription', '#7a5ab8', [['Premium', 399, 'monthly', 'INR'], ['Premium annual', 1499, 'yearly', 'INR']], 'com.sonyliv'),
  p('Airtel Xstream Play', 'Streaming', /airtel xstream play|xstream play/i, 'https://www.airtelxstream.in/account', '#c44545', [['Premium', 149, 'monthly', 'INR']], 'tv.accedo.airtel.wynk'),
  p('ZEE5', 'Streaming', /zee5|zee entertainment/i, 'https://www.zee5.com/myaccount/subscription', '#8a4fbf', [], 'com.graymatrix.did'),
  p('YouTube Premium', 'Streaming', /youtube\s*premium|google.*youtube/i, 'https://www.youtube.com/paid_memberships', '#b5651d', [['Individual', 13.99], ['Family', 22.99], ['Individual', 149, 'monthly', 'INR'], ['Family', 299, 'monthly', 'INR']], 'com.google.android.youtube'),
  p('Hulu', 'Streaming', /hulu/i, 'https://secure.hulu.com/account', '#3f9e6b', [['With ads', 9.99], ['No ads', 18.99]], 'com.hulu.plus'),
  p('Max', 'Streaming', /\bhbo\b|\bmax\.com|hbomax/i, 'https://auth.max.com/subscription', '#5b55c9', [['With ads', 9.99], ['Ad-free', 16.99]], 'com.wbd.stream'),
  p('Apple TV+', 'Streaming', /apple\s*tv/i, 'https://tv.apple.com/settings', '#6b7a8f', [['Monthly', 9.99], ['Monthly', 99, 'monthly', 'INR']], 'com.apple.atve.androidtv.appletv'),
  p('Crunchyroll', 'Streaming', /crunchyroll/i, 'https://www.crunchyroll.com/account/membership', '#c9772f', [['Fan', 7.99], ['Mega Fan', 11.99], ['Fan', 79, 'monthly', 'INR'], ['Mega Fan', 99, 'monthly', 'INR']], 'com.crunchyroll.crunchyroid'),

  // Music and audio
  p('Spotify', 'Music', /spotify/i, 'https://www.spotify.com/account/subscription/', '#2f9e6b', [['Premium Individual', 11.99], ['Premium Duo', 16.99], ['Premium Family', 19.99], ['Premium Lite', 139, 'monthly', 'INR'], ['Premium Standard', 199, 'monthly', 'INR'], ['Premium Platinum', 299, 'monthly', 'INR']], 'com.spotify.music', { type: 'oauth', provider: 'spotify' }),
  p('Apple Music', 'Music', /apple music|apple\.com\/bill/i, 'https://music.apple.com/account', '#c2477f', [['Individual', 10.99], ['Family', 16.99], ['Student', 59, 'monthly', 'INR'], ['Individual', 119, 'monthly', 'INR'], ['Family', 179, 'monthly', 'INR']], 'com.apple.android.music'),
  p('YouTube Music', 'Music', /youtube music/i, 'https://www.youtube.com/paid_memberships', '#b5651d', [['Individual', 10.99]], 'com.google.android.apps.youtube.music'),
  p('JioSaavn', 'Music', /saavn/i, 'https://www.jiosaavn.com/me/account', '#3f9e8a', [['Pro', 99, 'monthly', 'INR']], 'com.jio.media.jiobeats'),
  p('Audible', 'Learning', /audible/i, 'https://www.audible.com/account/overview', '#c9882f', [['Premium Plus', 14.95], ['Membership', 199, 'monthly', 'INR']], 'com.audible.application'),

  // Gaming
  p('PlayStation Plus', 'Gaming', /playstation|sony interactive|psn\b|ps plus/i, 'https://www.playstation.com/acct/management', '#3d62c4', [['Essential', 9.99], ['Extra', 14.99], ['Premium', 17.99], ['Essential', 499, 'monthly', 'INR'], ['Extra', 749, 'monthly', 'INR'], ['Deluxe', 849, 'monthly', 'INR']], 'com.scee.psxandroid'),
  p('Xbox Game Pass', 'Gaming', /xbox|game pass/i, 'https://account.microsoft.com/services', '#3f9e4f', [['Core', 9.99], ['Ultimate', 19.99]], 'com.gamepass'),
  p('Nintendo Switch Online', 'Gaming', /nintendo/i, 'https://accounts.nintendo.com/shop/subscription', '#c94545', [['Individual', 3.99]], 'com.nintendo.znca'),
  p('EA Play', 'Gaming', /ea play|electronic arts/i, 'https://myaccount.ea.com/cp-ui/subscription/index', '#c95f45', [['Monthly', 5.99]]),

  // Cloud storage
  p('Google One', 'Storage', /google one|google storage/i, 'https://one.google.com/settings', '#4d7fc9', [['100 GB', 1.99], ['2 TB', 9.99], ['100 GB', 130, 'monthly', 'INR'], ['2 TB', 650, 'monthly', 'INR']]),
  p('iCloud+', 'Storage', /icloud/i, 'https://www.icloud.com/settings/', '#6b7a8f', [['50 GB', 0.99], ['200 GB', 2.99], ['2 TB', 9.99], ['50 GB', 75, 'monthly', 'INR'], ['200 GB', 219, 'monthly', 'INR'], ['2 TB', 749, 'monthly', 'INR']]),
  p('Dropbox', 'Storage', /dropbox/i, 'https://www.dropbox.com/account/plan', '#3d6fd6', [['Plus', 11.99]], 'com.dropbox.android'),
  p('OneDrive', 'Storage', /onedrive/i, 'https://account.microsoft.com/services', '#3d7fc4', [['100 GB', 1.99]], 'com.microsoft.skydrive'),

  // Software
  p('Adobe Creative Cloud', 'Productivity', /adobe/i, 'https://account.adobe.com/plans', '#8a4fbf', [['Photography (20GB)', 19.99], ['All Apps', 59.99]], 'com.adobe.lrmobile'),
  p('Microsoft 365', 'Productivity', /microsoft\s*365|msft.*office|office 365/i, 'https://account.microsoft.com/services', '#c9632f', [['Personal', 9.99], ['Family', 12.99]], 'com.microsoft.office.officehubrow'),
  p('Notion', 'Productivity', /notion/i, 'https://www.notion.so/my-account', '#7a7f8f', [['Plus', 10]], 'notion.id'),
  p('Canva Pro', 'Productivity', /canva/i, 'https://www.canva.com/settings/billing-and-plans', '#4d9fc9', [['Pro', 15]], 'com.canva.editor'),
  p('Figma', 'Productivity', /figma/i, 'https://www.figma.com/settings', '#b85a8f', [['Professional', 15]], 'com.figma.mirror'),
  p('Slack', 'Productivity', /slack/i, 'https://slack.com/account/settings', '#8a5ab8', [['Pro', 8.75]], 'com.Slack'),
  p('Zoom', 'Productivity', /zoom\.us|zoom video/i, 'https://zoom.us/billing', '#4d7fd6', [['Pro', 15.99]], 'us.zoom.videomeetings'),
  p('1Password', 'Productivity', /1password|agilebits/i, 'https://my.1password.com/billing', '#4d8fc9', [['Individual', 2.99]], 'com.onepassword.android'),
  p('NordVPN', 'Productivity', /nordvpn|nord\s*vpn/i, 'https://my.nordaccount.com/billing/my-subscriptions/', '#4d6fc9', [['Monthly', 12.99]], 'com.nordvpn.android'),
  p('LinkedIn Premium', 'Productivity', /linkedin/i, 'https://www.linkedin.com/premium/manage', '#3d6fa8', [['Career', 29.99]], 'com.linkedin.android'),

  // Mobile recharge
  p('Jio Prepaid', 'Telecom', /\bjio\b.*(recharge|prepaid|mobility)|reliance jio/i, 'https://www.jio.com/selfcare/plans/mobility/prepaid-plans-list/', '#3d62c4', [['28 days, 1.5 GB a day', 299, 'monthly', 'INR'], ['84 days, 2 GB a day', 859, 'quarterly', 'INR']], 'com.jio.myjio'),
  p('Airtel Prepaid', 'Telecom', /airtel.*(recharge|prepaid|mobile)|bharti airtel/i, 'https://www.airtel.in/recharge-online', '#c44545', [['28 days, 1.5 GB a day', 349, 'monthly', 'INR'], ['84 days, 1.5 GB a day', 859, 'quarterly', 'INR']], 'com.myairtelapp'),
  p('Vi Prepaid', 'Telecom', /vodafone idea|\bvi\b.*(recharge|prepaid)/i, 'https://www.myvi.in/prepaid/online-mobile-recharge', '#c9456f', [['28 days, 1.5 GB a day', 349, 'monthly', 'INR']], 'com.mventus.selfcare.activity'),
  p('T-Mobile', 'Telecom', /t-mobile|tmobile/i, 'https://www.t-mobile.com/account', '#c9458f', [['Essentials', 50]]),
  p('Verizon Wireless', 'Telecom', /verizon/i, 'https://www.verizon.com/digital/nsa/secure/ui/acct/', '#c94545', [['Unlimited Welcome', 65]]),

  // Broadband
  p('Airtel Xstream Fiber', 'Broadband', /airtel.*(fiber|fibre|broadband|xstream fib)/i, 'https://www.airtel.in/broadband/', '#c44545', [['40 Mbps', 499, 'monthly', 'INR'], ['100 Mbps', 799, 'monthly', 'INR']]),
  p('JioFiber', 'Broadband', /jio\s*fib(er|re)|jiofiber/i, 'https://www.jio.com/selfcare/plans/fiber/', '#3d62c4', [['30 Mbps', 399, 'monthly', 'INR'], ['100 Mbps', 699, 'monthly', 'INR']]),
  p('ACT Fibernet', 'Broadband', /act fibernet|atria convergence/i, 'https://selfcare.actcorp.in/', '#c9772f', []),
  p('Xfinity', 'Broadband', /comcast|xfinity/i, 'https://customer.xfinity.com/#/billing', '#7a4fc9', [['Connect More', 55]]),
  p('Spectrum', 'Broadband', /spectrum|charter comm/i, 'https://www.spectrum.net/billing', '#3d7fc4', [['Internet', 50]]),

  // Wellness
  p('Headspace', 'Wellness', /headspace/i, 'https://www.headspace.com/subscriptions/manage', '#d98a2b', [['Monthly', 12.99], ['Annual', 69.99, 'yearly']], 'com.getsomeheadspace.android'),
  p('Calm', 'Wellness', /\bcalm\b/i, 'https://www.calm.com/profile/manage-subscription', '#4d8fc9', [['Monthly', 14.99], ['Annual', 69.99, 'yearly']], 'com.calm.android'),
  p('Cult.fit', 'Wellness', /cult\.?fit|curefit/i, 'https://www.cult.fit/me', '#c9456f', [], 'fit.cure.android'),
  p('Strava', 'Wellness', /strava/i, 'https://www.strava.com/account', '#c9632f', [['Subscription', 11.99]], 'com.strava'),

  // Learning
  p('Duolingo', 'Learning', /duolingo/i, 'https://www.duolingo.com/settings/super', '#6f9e2f', [['Super', 12.99]], 'com.duolingo'),
  p('Coursera Plus', 'Learning', /coursera/i, 'https://www.coursera.org/my-purchases', '#3d6fc9', [['Monthly', 59]], 'org.coursera.android'),
  p('Kindle Unlimited', 'Learning', /kindle/i, 'https://www.amazon.com/kindle-dbs/ku/ku-central', '#3a8fa3', [['Monthly', 11.99], ['Monthly', 169, 'monthly', 'INR']], 'com.amazon.kindle'),

  // News
  p('The New York Times', 'News', /nytimes|new york times|\bnyt\b/i, 'https://myaccount.nytimes.com/seg/subscription', '#7a7f8f', [['All Access', 25]], 'com.nytimes.android'),
  p('Medium', 'News', /medium\.com|medium membership/i, 'https://medium.com/me/membership', '#5f8f6a', [['Member', 5]], 'com.medium.reader'),
  // ---- More AI tools ----
  p('Microsoft Copilot Pro', 'AI', /microsoft.*copilot|copilot pro/i, 'https://account.microsoft.com/services', '#4d8fc9', [['Pro', 20]], 'com.microsoft.copilot'),
  p('Grok', 'AI', /\bgrok\b|\bx\.ai\b|xai llc/i, 'https://grok.com', '#6e6e8a', [['SuperGrok', 30]]),
  p('ElevenLabs', 'AI', /elevenlabs|eleven labs/i, 'https://elevenlabs.io/app/subscription', '#7a7f8f', [['Starter', 5], ['Creator', 22]]),
  p('Runway', 'AI', /runwayml|runway ai/i, 'https://app.runwayml.com', '#55607a', [['Standard', 15]]),
  p('Suno', 'AI', /\bsuno\b/i, 'https://suno.com/account', '#c9772f', [['Pro', 10]]),
  p('Poe', 'AI', /\bpoe\b.*(quora|subscription)|quora.*poe/i, 'https://poe.com/settings', '#7a5ab8', [['Subscription', 19.99]], 'com.poe.android'),
  p('Character.AI', 'AI', /character\.?ai/i, 'https://character.ai', '#4d7fa8', [['c.ai+', 9.99]], 'ai.character.app'),
  p('Otter.ai', 'AI', /otter\.?ai/i, 'https://otter.ai/account', '#3d6fc9', [['Pro', 16.99]], 'com.aisense.otter'),
  p('Jasper', 'AI', /jasper\.?ai|jasper ai/i, 'https://app.jasper.ai', '#8a4fbf', []),
  p('Leonardo.Ai', 'AI', /leonardo\.?ai/i, 'https://app.leonardo.ai', '#7a4fc9', []),
  p('Mistral Le Chat', 'AI', /mistral/i, 'https://chat.mistral.ai', '#c9632f', []),
  p('Windsurf', 'AI', /windsurf|codeium/i, 'https://windsurf.com/account', '#3a8a94', [['Pro', 15]]),
  p('Lovable', 'AI', /lovable\.dev|lovable labs/i, 'https://lovable.dev', '#c9456f', []),
  p('DeepL', 'AI', /deepl/i, 'https://www.deepl.com/account', '#3d5a8a', [], 'com.deepl.mobiletranslator'),
  p('Grammarly', 'AI', /grammarly/i, 'https://account.grammarly.com/subscription', '#3f9e7a', [['Pro', 12]]),

  // ---- More entertainment ----
  p('Paramount+', 'Streaming', /paramount\s*\+|paramount plus|paramountplus/i, 'https://www.paramountplus.com/account/', '#3d62c4', [['Essential', 7.99], ['With Showtime', 12.99]], 'com.cbs.app'),
  p('Peacock', 'Streaming', /peacock/i, 'https://www.peacocktv.com/account', '#55607a', [['Premium', 7.99], ['Premium Plus', 13.99]], 'com.peacocktv.peacockandroid'),
  p('Discovery+', 'Streaming', /discovery\s*\+|discovery plus|discoveryplus/i, 'https://www.discoveryplus.com/account', '#3d7fc4', [['With ads', 4.99], ['Ad-free', 8.99]], 'com.discovery.discoveryplus.mobile'),
  p('MUBI', 'Streaming', /\bmubi\b/i, 'https://mubi.com/subscription', '#3d5a8a', [['Monthly', 14.99]], 'com.mubi'),
  p('ESPN+', 'Streaming', /espn\s*\+|espn plus|espnplus/i, 'https://www.espn.com/watch/espnplus/', '#c94545', [['Monthly', 11.99]], 'com.espn.score_center'),
  p('DAZN', 'Streaming', /\bdazn\b/i, 'https://www.dazn.com/myaccount', '#7a7f8f', [], 'com.dazn'),
  p('YouTube TV', 'Streaming', /youtube\s*tv/i, 'https://tv.youtube.com/settings/membership', '#b5651d', [['Base plan', 82.99]], 'com.google.android.apps.youtube.unplugged'),
  p('Sling TV', 'Streaming', /sling\s*tv|sling\.com/i, 'https://www.sling.com/my-account', '#3d6fd6', [], 'com.sling'),
  p('fuboTV', 'Streaming', /\bfubo/i, 'https://www.fubo.tv/account', '#c9632f', []),
  p('Twitch Turbo', 'Streaming', /twitch/i, 'https://www.twitch.tv/subscriptions', '#8a5ab8', [['Turbo', 11.99]], 'tv.twitch.android.app'),
  p('Plex Pass', 'Streaming', /\bplex\b/i, 'https://app.plex.tv/desktop/#!/settings/account', '#c9a02f', [['Monthly', 6.99]], 'com.plexapp.android'),
  p('Viki', 'Streaming', /\bviki\b|rakuten viki/i, 'https://www.viki.com/users/settings', '#3d7fc4', [['Viki Pass Standard', 5.99]], 'com.viki.android'),
  p('CuriosityStream', 'Streaming', /curiosity\s*stream/i, 'https://curiositystream.com/account', '#c9882f', [['Standard', 4.99]]),
  p('BritBox', 'Streaming', /britbox/i, 'https://www.britbox.com/account', '#3d62c4', [['Monthly', 8.99]]),
  p('Aha', 'Streaming', /\baha\b.*(video|ott|subscription)|arha media/i, 'https://www.aha.video/profile', '#c9632f', []),
  p('Sun NXT', 'Streaming', /sun\s*nxt/i, 'https://www.sunnxt.com/profile', '#c9772f', [], 'com.suntv.sunnxt'),
  p('Hoichoi', 'Streaming', /hoichoi/i, 'https://www.hoichoi.tv/user', '#c94545', [], 'com.viewlift.hoichoi'),
  p('ALTT', 'Streaming', /\baltt\b|alt\s*balaji/i, 'https://altt.co.in', '#c9456f', [], 'com.balaji.alt'),
  p('Lionsgate Play', 'Streaming', /lionsgate/i, 'https://www.lionsgateplay.com', '#7a7f8f', []),
  p('Eros Now', 'Streaming', /eros\s*now/i, 'https://erosnow.com/myaccount', '#c94545', [], 'com.erosnow'),
  p('FanCode', 'Streaming', /fancode/i, 'https://www.fancode.com', '#c9632f', []),
  p('Tata Play Binge', 'Streaming', /tata\s*play\s*binge|binge\+/i, 'https://www.tataplaybinge.com', '#8a4fbf', []),
  p('OTTplay', 'Streaming', /ottplay/i, 'https://www.ottplay.com', '#c9456f', []),
  p('Tata Play', 'Streaming', /tata\s*play|tata\s*sky/i, 'https://www.tataplay.com/my-account', '#7a4fc9', []),
  p('Airtel Digital TV', 'Streaming', /airtel.*(dth|digital tv)/i, 'https://www.airtel.in/dth/', '#c44545', []),
  p('Dish TV', 'Streaming', /dish\s*tv|dishtv/i, 'https://www.dishtv.in', '#c9632f', []),
  p('Sun Direct', 'Streaming', /sun\s*direct/i, 'https://www.sundirect.in', '#c9772f', []),
  p('d2h', 'Streaming', /\bd2h\b|videocon d2h/i, 'https://www.d2h.com', '#7a4fc9', []),

  // ---- More music and audio ----
  p('Amazon Music Unlimited', 'Music', /amazon music|amzn.*music/i, 'https://www.amazon.com/music/settings', '#3a8fa3', [['Individual', 11.99]], 'com.amazon.mp3'),
  p('Tidal', 'Music', /\btidal\b/i, 'https://account.tidal.com', '#55607a', [['Individual', 10.99]], 'com.aspiro.tidal'),
  p('Deezer', 'Music', /deezer/i, 'https://www.deezer.com/account/subscription', '#8a4fbf', [['Premium', 11.99]], 'deezer.android.app'),
  p('Gaana', 'Music', /\bgaana\b/i, 'https://gaana.com/myzone', '#c94545', [], 'com.gaana'),
  p('Wynk Music', 'Music', /wynk/i, 'https://wynk.in/music', '#c44545', [], 'com.bsbportal.music'),
  p('SoundCloud Go', 'Music', /soundcloud/i, 'https://soundcloud.com/you/subscriptions', '#c9632f', [['Go', 4.99], ['Go+', 10.99]], 'com.soundcloud.android'),
  p('Pandora', 'Music', /pandora/i, 'https://www.pandora.com/account/settings', '#3d6fc9', [['Plus', 4.99], ['Premium', 10.99]], 'com.pandora.android'),
  p('SiriusXM', 'Music', /sirius\s*xm|siriusxm/i, 'https://care.siriusxm.com', '#3d62c4', []),
  p('Pocket FM', 'Music', /pocket\s*fm/i, 'https://www.pocketfm.com', '#c94545', [], 'com.radio.pocketfm'),
  p('Kuku FM', 'Music', /kuku\s*fm/i, 'https://kukufm.com', '#c9456f', []),
  p('Storytel', 'Music', /storytel/i, 'https://www.storytel.com/account', '#c9632f', []),

  // ---- More gaming ----
  p('Apple Arcade', 'Gaming', /apple arcade/i, 'https://support.apple.com/en-us/118428', '#c9456f', [['Monthly', 6.99]]),
  p('GeForce NOW', 'Gaming', /geforce\s*now|nvidia/i, 'https://www.nvidia.com/en-us/account/gfn/', '#6f9e2f', [['Performance', 9.99], ['Ultimate', 19.99]], 'com.nvidia.geforcenow'),
  p('Ubisoft+', 'Gaming', /ubisoft/i, 'https://store.ubisoft.com/ubisoftplus', '#3d6fd6', [['Premium', 17.99]]),
  p('Discord Nitro', 'Gaming', /discord/i, 'https://discord.com/billing', '#5b65c9', [['Nitro Basic', 2.99], ['Nitro', 9.99]], 'com.discord'),
  p('Roblox Premium', 'Gaming', /roblox/i, 'https://www.roblox.com/my/account#!/subscriptions', '#7a7f8f', [['Premium 450', 4.99], ['Premium 1000', 9.99]], 'com.roblox.client'),
  p('Google Play Pass', 'Gaming', /play pass/i, 'https://play.google.com/store/account/subscriptions', '#3f9e6b', [['Monthly', 4.99]]),
  p('Humble Choice', 'Gaming', /humble\s*(bundle|choice)/i, 'https://www.humblebundle.com/subscription', '#c94545', [['Monthly', 11.99]]),
  p('World of Warcraft', 'Gaming', /blizzard|world of warcraft/i, 'https://account.battle.net', '#3d7fc4', [['Subscription', 14.99]]),
  p('Fortnite Crew', 'Gaming', /epic games|fortnite/i, 'https://www.epicgames.com/account/subscriptions', '#55607a', [['Crew', 11.99]]),
  p('Minecraft Realms', 'Gaming', /minecraft|mojang/i, 'https://www.minecraft.net/en-us/msaprofile', '#6f9e2f', [['Realms Plus', 7.99]]),

  // ---- More cloud storage ----
  p('pCloud', 'Storage', /pcloud/i, 'https://my.pcloud.com', '#3a8fa3', []),
  p('Box', 'Storage', /\bbox\.com\b|\bbox,? inc/i, 'https://account.box.com', '#3d6fd6', []),
  p('MEGA', 'Storage', /\bmega\.nz\b|mega limited/i, 'https://mega.nz/account', '#c94545', []),
  p('Backblaze', 'Storage', /backblaze/i, 'https://secure.backblaze.com/user_overview.htm', '#c94545', [['Personal Backup', 9]]),
  p('IDrive', 'Storage', /\bidrive\b/i, 'https://www.idrive.com/idrive/home/account', '#3d6fc9', []),

  // ---- More software ----
  p('Google Workspace', 'Productivity', /google workspace|gsuite|g suite/i, 'https://admin.google.com', '#4d7fc9', [['Business Starter', 7.2]]),
  p('Evernote', 'Productivity', /evernote/i, 'https://www.evernote.com/Settings.action', '#3f9e4f', [['Personal', 14.99]], 'com.evernote'),
  p('Todoist', 'Productivity', /todoist|doist/i, 'https://app.todoist.com/app/settings/subscription', '#c9563d', [['Pro', 5]], 'com.todoist'),
  p('LastPass', 'Productivity', /lastpass/i, 'https://lastpass.com/account.php', '#c94545', [['Premium', 3]]),
  p('Bitwarden', 'Productivity', /bitwarden/i, 'https://vault.bitwarden.com/#/settings/subscription', '#3d6fc9', [['Premium', 10, 'yearly']]),
  p('Dashlane', 'Productivity', /dashlane/i, 'https://app.dashlane.com', '#3a8a94', []),
  p('ExpressVPN', 'Productivity', /expressvpn|express vpn/i, 'https://www.expressvpn.com/subscriptions', '#c94545', [['Monthly', 12.95]], 'com.expressvpn.vpn'),
  p('Surfshark', 'Productivity', /surfshark/i, 'https://my.surfshark.com', '#3a8a94', []),
  p('Proton', 'Productivity', /proton\s?(mail|vpn|drive|pass)|proton ag|protonmail/i, 'https://account.proton.me/dashboard', '#7a5ab8', [['Proton Unlimited', 12.99]]),
  p('Norton 360', 'Productivity', /norton/i, 'https://my.norton.com', '#c9a02f', []),
  p('McAfee', 'Productivity', /mcafee/i, 'https://home.mcafee.com', '#c94545', []),
  p('Kaspersky', 'Productivity', /kaspersky/i, 'https://my.kaspersky.com', '#3f9e7a', []),
  p('Truecaller Premium', 'Productivity', /truecaller/i, 'https://www.truecaller.com', '#3d7fc4', [], 'com.truecaller'),
  p('Atlassian', 'Productivity', /atlassian|\bjira\b|confluence/i, 'https://admin.atlassian.com', '#3d6fd6', []),
  p('Asana', 'Productivity', /\basana\b/i, 'https://app.asana.com/-/account_api', '#c9563d', [['Starter', 13.49]]),
  p('Trello', 'Productivity', /trello/i, 'https://trello.com/your/account', '#3d6fd6', [['Standard', 6]]),
  p('monday.com', 'Productivity', /monday\.com/i, 'https://auth.monday.com', '#c9456f', []),
  p('ClickUp', 'Productivity', /clickup/i, 'https://app.clickup.com/settings/billing', '#7a5ab8', [['Unlimited', 10]]),
  p('Airtable', 'Productivity', /airtable/i, 'https://airtable.com/account', '#c9a02f', [['Team', 24]]),
  p('Miro', 'Productivity', /\bmiro\b|realtimeboard/i, 'https://miro.com/app/settings/', '#c9a02f', [['Starter', 10]]),
  p('Calendly', 'Productivity', /calendly/i, 'https://calendly.com/app/admin/billing', '#3d6fd6', [['Standard', 12]]),
  p('Loom', 'Productivity', /\bloom\b.*(inc|com|subscription)|loom\.com/i, 'https://www.loom.com/settings/workspace', '#5b65c9', [['Business', 15]]),
  p('DocuSign', 'Productivity', /docusign/i, 'https://account.docusign.com', '#c9a02f', [['Personal', 15]]),
  p('QuickBooks', 'Productivity', /quickbooks|intuit/i, 'https://accounts.intuit.com', '#3f9e4f', [['Simple Start', 35]]),
  p('Zoho', 'Productivity', /\bzoho\b/i, 'https://accounts.zoho.com', '#c94545', []),
  p('Squarespace', 'Productivity', /squarespace/i, 'https://account.squarespace.com', '#7a7f8f', [['Core', 23]]),
  p('Wix', 'Productivity', /\bwix\b/i, 'https://manage.wix.com/account/subscriptions', '#55607a', [['Light', 17]]),
  p('Shopify', 'Productivity', /shopify/i, 'https://accounts.shopify.com', '#6f9e2f', [['Basic', 39]]),
  p('Mailchimp', 'Productivity', /mailchimp/i, 'https://admin.mailchimp.com/account/billing/', '#c9a02f', [['Essentials', 13]]),
  p('WordPress.com', 'Productivity', /wordpress|automattic/i, 'https://wordpress.com/me/purchases', '#3d6f94', [['Personal', 9]]),
  p('Webflow', 'Productivity', /webflow/i, 'https://webflow.com/dashboard/account/billing', '#3d6fd6', [['Basic', 18]]),
  p('Framer', 'Productivity', /framer/i, 'https://framer.com/account', '#3d7fc4', []),
  p('Setapp', 'Productivity', /setapp|macpaw/i, 'https://my.setapp.com', '#7a7f8f', [['Mac', 9.99]]),
  p('TeamViewer', 'Productivity', /teamviewer/i, 'https://login.teamviewer.com', '#3d6fd6', []),
  p('AnyDesk', 'Productivity', /anydesk/i, 'https://my.anydesk.com', '#c94545', []),
  p('Apple One', 'Productivity', /apple one/i, 'https://support.apple.com/en-us/118428', '#6b7a8f', [['Individual', 19.95], ['Family', 25.95]]),

  // ---- Developer tools ----
  p('JetBrains', 'Developer', /jetbrains/i, 'https://account.jetbrains.com/licenses', '#c9456f', [['All Products Pack', 28.9]]),
  p('Vercel', 'Developer', /vercel/i, 'https://vercel.com/account/billing', '#7a7f8f', [['Pro', 20]]),
  p('Netlify', 'Developer', /netlify/i, 'https://app.netlify.com/account/billing', '#3a8a94', [['Pro', 19]]),
  p('Render', 'Developer', /render\.com|render services/i, 'https://dashboard.render.com/billing', '#7a5ab8', [['Professional', 19]]),
  p('Railway', 'Developer', /railway\.(app|com)|railway corp/i, 'https://railway.com/account/billing', '#7a4fc9', [['Hobby', 5]]),
  p('Heroku', 'Developer', /heroku/i, 'https://dashboard.heroku.com/account/billing', '#7a5ab8', []),
  p('DigitalOcean', 'Developer', /digitalocean/i, 'https://cloud.digitalocean.com/account/billing', '#3d7fc4', []),
  p('Amazon Web Services', 'Developer', /amazon web services|\baws\b/i, 'https://console.aws.amazon.com/billing/', '#c9882f', []),
  p('Google Cloud', 'Developer', /google cloud|\bgcp\b/i, 'https://console.cloud.google.com/billing', '#4d7fc9', []),
  p('Microsoft Azure', 'Developer', /\bazure\b/i, 'https://portal.azure.com/#view/Microsoft_Azure_CostManagement', '#3d7fc4', []),
  p('Cloudflare', 'Developer', /cloudflare/i, 'https://dash.cloudflare.com/profile/billing', '#c9772f', [['Pro', 25]]),
  p('Supabase', 'Developer', /supabase/i, 'https://supabase.com/dashboard/account/billing', '#3f9e6b', [['Pro', 25]]),
  p('MongoDB Atlas', 'Developer', /mongodb/i, 'https://cloud.mongodb.com/v2#/account/billing', '#3f9e4f', []),
  p('Postman', 'Developer', /postman/i, 'https://go.postman.co/billing', '#c9632f', [['Basic', 14]]),
  p('Docker', 'Developer', /\bdocker\b/i, 'https://app.docker.com/billing', '#3d7fc4', [['Pro', 11]]),
  p('Linear', 'Developer', /linear\.app|linear orbit/i, 'https://linear.app/settings/billing', '#5b65c9', [['Basic', 10]]),
  p('Sentry', 'Developer', /sentry\.io|functional software/i, 'https://sentry.io/settings/billing/', '#7a5a8a', [['Team', 26]]),
  p('Replit', 'Developer', /replit/i, 'https://replit.com/account', '#c9632f', [['Core', 25]]),
  p('Hostinger', 'Developer', /hostinger/i, 'https://hpanel.hostinger.com/billing', '#7a5ab8', []),
  p('GoDaddy', 'Developer', /godaddy/i, 'https://account.godaddy.com/subscriptions', '#3a8a94', []),
  p('Namecheap', 'Developer', /namecheap/i, 'https://ap.www.namecheap.com/Profile/Billing', '#c9632f', []),
  p('Bluehost', 'Developer', /bluehost/i, 'https://my.bluehost.com', '#3d6fd6', []),

  // ---- More mobile plans ----
  p('Airtel Postpaid', 'Telecom', /airtel.*postpaid/i, 'https://www.airtel.in/postpaid/', '#c44545', [], 'com.myairtelapp'),
  p('Jio Postpaid', 'Telecom', /\bjio\b.*postpaid/i, 'https://www.jio.com/selfcare/plans/mobility/postpaid-plans-home/', '#3d62c4', [], 'com.jio.myjio'),
  p('BSNL Mobile', 'Telecom', /\bbsnl\b/i, 'https://selfcare.bsnl.co.in', '#c9a02f', []),
  p('AT&T Wireless', 'Telecom', /at&t|\batt\b.*(wireless|mobility)/i, 'https://www.att.com/acctmgmt/', '#3d7fc4', []),
  p('Mint Mobile', 'Telecom', /mint mobile/i, 'https://my.mintmobile.com', '#3f9e6b', [['5 GB', 15]]),
  p('Google Fi', 'Telecom', /google fi/i, 'https://fi.google.com/account', '#4d7fc9', []),

  // ---- More broadband ----
  p('BSNL Fiber', 'Broadband', /bsnl.*(fib(er|re)|ftth|broadband)/i, 'https://selfcare.bsnl.co.in', '#c9a02f', []),
  p('Hathway', 'Broadband', /hathway/i, 'https://www.hathway.com', '#c94545', []),
  p('Excitel', 'Broadband', /excitel/i, 'https://my.excitel.com', '#c9632f', []),
  p('Tata Play Fiber', 'Broadband', /tata\s*play\s*fib(er|re)|tata sky broadband/i, 'https://www.tataplayfiber.co.in', '#7a4fc9', []),
  p('YOU Broadband', 'Broadband', /you broadband/i, 'https://www.youbroadband.in', '#3d6fd6', []),
  p('Starlink', 'Broadband', /starlink/i, 'https://www.starlink.com/account', '#55607a', [['Residential', 120]]),
  p('Verizon Fios', 'Broadband', /\bfios\b/i, 'https://www.verizon.com/digital/nsa/secure/ui/acct/', '#c94545', []),
  p('AT&T Fiber', 'Broadband', /at&t.*(fiber|internet|u-verse)/i, 'https://www.att.com/acctmgmt/', '#3d7fc4', []),
  p('Cox', 'Broadband', /cox comm/i, 'https://www.cox.com/residential/myaccount/', '#3d6fd6', []),
  p('Optimum', 'Broadband', /optimum|altice/i, 'https://www.optimum.net/pay-bill/', '#c9632f', []),
  p('Virgin Media', 'Broadband', /virgin media/i, 'https://www.virginmedia.com/my-virgin-media', '#c94545', []),

  // ---- More health and fitness ----
  p('Fitbit Premium', 'Wellness', /fitbit/i, 'https://www.fitbit.com/settings/subscription', '#3a8a94', [['Premium', 9.99]], 'com.fitbit.FitbitMobile'),
  p('Peloton', 'Wellness', /peloton/i, 'https://members.onepeloton.com/preferences/subscriptions', '#c94545', [['App One', 12.99], ['All-Access', 44]], 'com.onepeloton.callisto'),
  p('MyFitnessPal', 'Wellness', /myfitnesspal/i, 'https://www.myfitnesspal.com/account/subscription', '#3d6fd6', [['Premium', 19.99]], 'com.myfitnesspal.android'),
  p('WHOOP', 'Wellness', /\bwhoop\b/i, 'https://app.whoop.com/membership', '#55607a', [['Monthly', 30]], 'com.whoop.android'),
  p('Apple Fitness+', 'Wellness', /apple fitness/i, 'https://support.apple.com/en-us/118428', '#6f9e2f', [['Monthly', 9.99]]),
  p('HealthifyMe', 'Wellness', /healthify/i, 'https://www.healthifyme.com', '#c9456f', [], 'com.healthifyme.basic'),
  p('Noom', 'Wellness', /\bnoom\b/i, 'https://account.noom.com', '#c9772f', []),
  p('Oura', 'Wellness', /\boura\b/i, 'https://membership.ouraring.com', '#7a7f8f', [['Membership', 5.99]]),
  p('Zwift', 'Wellness', /zwift/i, 'https://my.zwift.com/profile/membership', '#c9632f', [['Monthly', 19.99]]),
  p('AllTrails', 'Wellness', /alltrails/i, 'https://www.alltrails.com/my/account', '#3f9e4f', [['Plus', 35.99, 'yearly']]),
  p('Planet Fitness', 'Wellness', /planet fitness/i, 'https://www.planetfitness.com/my-account', '#8a4fbf', [['Classic', 15]]),
  p('BetterHelp', 'Wellness', /betterhelp/i, 'https://www.betterhelp.com/account/', '#3f9e6b', []),
  p('Flo', 'Wellness', /flo health/i, 'https://flo.health', '#c9456f', []),

  // ---- More learning ----
  p('Udemy', 'Learning', /udemy/i, 'https://www.udemy.com/user/manage-subscriptions/', '#8a4fbf', [['Personal Plan', 20]], 'com.udemy.android'),
  p('Skillshare', 'Learning', /skillshare/i, 'https://www.skillshare.com/settings/payments', '#3f9e7a', [['Monthly', 13.99]], 'com.skillshare.Skillshare'),
  p('MasterClass', 'Learning', /masterclass/i, 'https://www.masterclass.com/settings', '#c94545', [['Standard', 10]]),
  p('Brilliant', 'Learning', /brilliant\.org|brilliant worldwide/i, 'https://brilliant.org/account/', '#c9a02f', [['Premium', 24.99]]),
  p('Babbel', 'Learning', /babbel/i, 'https://my.babbel.com/profile', '#c9772f', [['Monthly', 17.95]], 'com.babbel.mobile.android.en'),
  p('Unacademy', 'Learning', /unacademy/i, 'https://unacademy.com/settings', '#3f9e6b', [], 'com.unacademyapp'),
  p("BYJU'S", 'Learning', /byju/i, 'https://byjus.com', '#7a4fc9', [], 'com.byjus.thelearningapp'),
  p('Khan Academy', 'Learning', /khan academy|khanmigo/i, 'https://www.khanacademy.org/settings/account', '#3f9e7a', [['Khanmigo', 4]], 'org.khanacademy.android'),
  p('Codecademy', 'Learning', /codecademy/i, 'https://www.codecademy.com/account/billing', '#3d5a8a', []),
  p('DataCamp', 'Learning', /datacamp/i, 'https://www.datacamp.com/profile/account_settings', '#3f9e6b', []),
  p('Pluralsight', 'Learning', /pluralsight/i, 'https://app.pluralsight.com/id/subscription', '#c9456f', [['Standard', 29]]),
  p("O'Reilly", 'Learning', /o'?reilly media|oreilly\.com/i, 'https://www.oreilly.com/member/', '#c94545', [['Individual', 49]]),
  p('Blinkist', 'Learning', /blinkist/i, 'https://www.blinkist.com/nc/settings/account', '#3f9e7a', [['Premium', 15.99]], 'com.blinkslabs.blinkist.android'),
  p('Everand', 'Learning', /scribd|everand/i, 'https://www.everand.com/account-settings', '#3a8a94', [['Monthly', 11.99]]),
  p('Chegg', 'Learning', /chegg/i, 'https://www.chegg.com/my/account', '#c9772f', [['Study', 15.95]]),
  p('Quizlet', 'Learning', /quizlet/i, 'https://quizlet.com/settings', '#5b65c9', [['Plus', 7.99]], 'com.quizlet.quizletandroid'),
  p('Rosetta Stone', 'Learning', /rosetta stone/i, 'https://login.rosettastone.com', '#c9a02f', []),

  // ---- More news and reading ----
  p('The Wall Street Journal', 'News', /\bwsj\b|wall street journal|dow jones/i, 'https://customercenter.wsj.com', '#7a7f8f', []),
  p('The Washington Post', 'News', /washington post|wash ?post/i, 'https://www.washingtonpost.com/my-post/', '#55607a', []),
  p('The Economist', 'News', /economist/i, 'https://myaccount.economist.com', '#c94545', [], 'com.economist.lamarr'),
  p('Financial Times', 'News', /financial times|\bft\.com\b/i, 'https://www.ft.com/myaccount', '#c9a08a', []),
  p('Bloomberg', 'News', /bloomberg/i, 'https://www.bloomberg.com/account/', '#55607a', []),
  p('The Guardian', 'News', /guardian news|the guardian/i, 'https://manage.theguardian.com', '#3d5a8a', []),
  p('The Athletic', 'News', /the athletic/i, 'https://theathletic.com/account', '#7a7f8f', []),
  p('The Hindu', 'News', /the hindu|thg publishing|kasturi/i, 'https://www.thehindu.com/myaccount/', '#3d6f94', []),
  p('Times of India+', 'News', /times of india|toi\+|times internet/i, 'https://timesofindia.indiatimes.com/toi-plus', '#c94545', []),
  p('Mint', 'News', /livemint|ht media|ht digital/i, 'https://www.livemint.com/myaccount', '#c9882f', []),
  p('The Ken', 'News', /the ken\b|the-ken/i, 'https://the-ken.com/account/', '#c94545', []),
  p('Substack', 'News', /substack/i, 'https://substack.com/settings', '#c9632f', []),
  p('Magzter', 'News', /magzter/i, 'https://www.magzter.com/my-account', '#3d6fd6', []),
  p('Apple News+', 'News', /apple news/i, 'https://support.apple.com/en-us/118428', '#c9456f', [['Monthly', 12.99]]),
  p('Readwise', 'News', /readwise/i, 'https://readwise.io/accounts/profile', '#7a7f8f', []),

  // ---- Memberships ----
  p('Swiggy One', 'Membership', /swiggy/i, 'https://www.swiggy.com/my-account', '#c9772f', []),
  p('Zomato Gold', 'Membership', /zomato/i, 'https://www.zomato.com/gold', '#c94545', []),
  p('Zepto Pass', 'Membership', /zepto/i, 'https://www.zeptonow.com/account', '#8a4fbf', []),
  p('Flipkart Plus', 'Membership', /flipkart.*(plus|vip|black)/i, 'https://www.flipkart.com/plus', '#3d6fd6', []),
  p('Times Prime', 'Membership', /times\s*prime/i, 'https://www.timesprime.com', '#55607a', []),
  p('Uber One', 'Membership', /uber\s*\*?\s*one|uber one/i, 'https://account.uber.com', '#55607a', [['Monthly', 9.99]]),
  p('DoorDash DashPass', 'Membership', /dashpass|doordash/i, 'https://www.doordash.com/consumer/membership/', '#c94545', [['Monthly', 9.99]]),
  p('Instacart+', 'Membership', /instacart/i, 'https://www.instacart.com/store/account/instacart-plus', '#3f9e4f', [['Monthly', 9.99]]),
  p('Walmart+', 'Membership', /walmart\s*\+|walmart plus|wmt plus/i, 'https://www.walmart.com/plus/account', '#3d7fc4', [['Monthly', 12.95]]),
  p('Grubhub+', 'Membership', /grubhub/i, 'https://www.grubhub.com/account/plus', '#c9632f', [['Monthly', 9.99]]),
  p('Deliveroo Plus', 'Membership', /deliveroo/i, 'https://deliveroo.co.uk/account', '#3a8a94', []),
  p('Lyft Pink', 'Membership', /lyft/i, 'https://account.lyft.com', '#c9456f', [['Monthly', 9.99]]),
  p('Costco', 'Membership', /costco.*(member|annual)/i, 'https://www.costco.com/account', '#c94545', [['Gold Star', 65, 'yearly']]),
  p("Sam's Club", 'Membership', /sam'?s club/i, 'https://www.samsclub.com/account', '#3d6fd6', [['Club', 50, 'yearly']]),

  // ---- Social and other ----
  p('X Premium', 'Other', /twitter|\bx corp\b|x premium/i, 'https://x.com/settings/subscriptions', '#55607a', [['Premium', 8]], 'com.twitter.android'),
  p('Meta Verified', 'Other', /meta verified|meta platforms|facebook.*verified/i, 'https://accountscenter.meta.com', '#3d6fd6', [['Standard', 14.99]]),
  p('Snapchat+', 'Other', /snapchat|snap inc/i, 'https://accounts.snapchat.com', '#c9a02f', [['Monthly', 3.99]], 'com.snapchat.android'),
  p('Telegram Premium', 'Other', /telegram/i, 'https://telegram.org', '#3d8fc9', [['Monthly', 4.99]], 'org.telegram.messenger'),
  p('Reddit Premium', 'Other', /reddit/i, 'https://www.reddit.com/settings/premium', '#c9563d', [['Monthly', 5.99]], 'com.reddit.frontpage'),
  p('Tinder', 'Other', /tinder/i, 'https://account.gotinder.com', '#c9456f', [], 'com.tinder'),
  p('Bumble', 'Other', /bumble/i, 'https://bumble.com/get-started', '#c9a02f', [], 'com.bumble.app'),
  p('Hinge', 'Other', /\bhinge\b/i, 'https://hinge.co', '#7a7f8f', [], 'co.hinge.app'),
  p('Patreon', 'Other', /patreon/i, 'https://www.patreon.com/settings/memberships', '#c9563d', [], 'com.patreon.android'),
];

/** Order matters: more specific patterns (Airtel fiber, Jio fiber) must win over generic ones. */
const BY_SPECIFICITY = [...CATALOG].sort((a, b) => Number(b.category === 'Broadband') - Number(a.category === 'Broadband'));

export const findProvider = (description: string) => BY_SPECIFICITY.find((entry) => entry.match.test(description));
/** Sites shared by many products: time on them says nothing about one subscription. */
const UMBRELLA_DOMAINS = ['google.com', 'amazon.com', 'amazon.in', 'apple.com', 'microsoft.com', 'meta.com', 'intuit.com'];
const ACCOUNT_HOSTS = /^(account|accounts|myaccount|support|admin|login|auth|secure)\./;

/** Where a service is actually used in a browser, when that differs from its account page. An empty list means web use cannot be measured. */
const WEB_DOMAINS: Record<string, string[]> = {
  'chatgpt-plus': ['chatgpt.com', 'chat.openai.com'],
  'google-ai-gemini': ['gemini.google.com'],
  'google-one': ['one.google.com', 'drive.google.com', 'photos.google.com'],
  'github-copilot': [],
  'prime-video': ['primevideo.com'],
  'kindle-unlimited': ['read.amazon.com', 'read.amazon.in'],
  'amazon-music-unlimited': ['music.amazon.com', 'music.amazon.in'],
  'youtube-premium': ['youtube.com'],
  'youtube-music': ['music.youtube.com'],
  jiohotstar: ['hotstar.com', 'jiohotstar.com'],
  max: ['max.com', 'hbomax.com'],
  'xbox-game-pass': ['xbox.com'],
  onedrive: ['onedrive.live.com'],
  'microsoft-365': ['office.com', 'microsoft365.com', 'cloud.microsoft', 'outlook.live.com'],
  'microsoft-copilot-pro': ['copilot.microsoft.com'],
  'geforce-now': ['geforcenow.com'],
  notion: ['notion.so', 'notion.com'],
  'x-premium': ['x.com', 'twitter.com'],
  'meta-verified': [],
};

/** The domains whose browser time counts as use of this service. The most specific match wins when two services overlap. */
export function webDomains(provider: Provider): string[] {
  const override = WEB_DOMAINS[provider.id];
  if (override) return override;
  const host = new URL(provider.manageUrl).hostname.replace(/^www\./, '');
  const labels = host.split('.');
  const twoPartSuffix = /^(co|com|org|net)\.[a-z]{2}$/.test(labels.slice(-2).join('.'));
  const registrable = labels.slice(twoPartSuffix ? -3 : -2).join('.');
  if (!UMBRELLA_DOMAINS.includes(registrable)) return [registrable];
  // On a shared domain only a product's own subdomain counts (music.apple.com), never its account pages.
  return host === registrable || ACCOUNT_HOSTS.test(host) ? [] : [host];
}

/** The country whose prices a currency stands for. Live plan checks are made for this region. */
export const REGION: Record<Currency, string> = { INR: 'India', USD: 'the United States', EUR: 'Germany', GBP: 'the United Kingdom' };

/** Catalog plans for a region: those priced in the user's currency when any exist, otherwise the USD list. */
export const catalogPlans = (provider: Provider, currency: Currency) => {
  const regional = provider.plans.filter((plan) => plan.currency === currency);
  return regional.length > 0 ? regional : provider.plans.filter((plan) => plan.currency === 'USD');
};

export const providerById = (id: string) => CATALOG.find((entry) => entry.id === id);
/** The catalog entry for a tracked subscription, by its name. */
export const providerForName = (name: string) => CATALOG.find((entry) => entry.name === name) ?? findProvider(name);

/** Services whose value is not a matter of screen time. Tracked for price, renewal and overlap only. */
export const UTILITY_CATEGORIES: Category[] = ['Storage', 'Telecom', 'Broadband', 'Membership', 'Developer'];

export const CATEGORIES: Category[] = ['Streaming', 'Music', 'Gaming', 'AI', 'Productivity', 'Storage', 'Telecom', 'Broadband', 'Developer', 'Wellness', 'Learning', 'News', 'Membership', 'Other'];

export const CATEGORY_LABEL: Record<Category, string> = {
  Streaming: 'Entertainment',
  Music: 'Music and audio',
  Gaming: 'Gaming',
  AI: 'AI tools',
  Productivity: 'Software',
  Storage: 'Cloud storage',
  Telecom: 'Mobile recharge',
  Broadband: 'Broadband',
  Wellness: 'Health and fitness',
  Learning: 'Learning',
  News: 'News and reading',
  Membership: 'Memberships',
  Developer: 'Developer tools',
  Other: 'Other',
};
