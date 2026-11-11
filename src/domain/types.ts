// Domain model shared by the server (store, agent, PayPal) and the client (dashboard, timeline, analytics).

export type Category = 'Streaming' | 'Music' | 'Gaming' | 'AI' | 'Productivity' | 'Storage' | 'Telecom' | 'Broadband' | 'Wellness' | 'Learning' | 'News' | 'Membership' | 'Developer' | 'Other';
export type BillingCycle = 'monthly' | 'quarterly' | 'yearly';
export type PaymentRail = 'paypal' | 'card' | 'bank';
export type SubStatus = 'active' | 'trial' | 'paused' | 'cancelled' | 'past_due';

/** How much the user lets the agent do on its own for one subscription. */
export type Policy =
  | 'ask' // agent proposes, user approves every action (default)
  | 'auto' // standing permission: agent may pause before renewal when the subscription is unused
  | 'locked'; // agent never proposes changes

/** Which devices feed usage for a subscription. Drives how confident a recommendation may be. */
export type Coverage = 'phone' | 'web' | 'phone+web' | 'phone+tv' | 'none';

export interface Subscription {
  id: string;
  name: string;
  plan: string;
  category: Category;
  color: string;
  price: number;
  cycle: BillingCycle;
  rail: PaymentRail;
  status: SubStatus;
  policy: Policy;
  coverage: Coverage;
  startedAt: string; // ISO date
  nextRenewal: string; // ISO date
  trialEndsAt?: string;
  /** PayPal subscription id (I-XXXX) when the agreement is managed through PayPal. */
  paypalSubscriptionId?: string;
  paypalPlanId?: string;
  /** Official page where the user cancels when PayPal cannot do it for them. */
  cancelUrl: string;
  /** A cheaper tier of the same service, when one exists. */
  cheaperPlan?: { name: string; price: number };
  /** Android package the companion app reports usage for. */
  androidPackage?: string;
  /** Catalog entry this subscription belongs to, when it is a known provider. */
  providerId?: string;
  /** How the category was decided. The user's own choice always wins. */
  classifiedBy: Classifier;
  /** Where Subster learned about this subscription. */
  source: 'bank' | 'statement' | 'paypal' | 'manual' | 'chat';
}

export type ChargeStatus = 'paid' | 'failed' | 'refunded';

export interface Charge {
  id: string;
  subId: string;
  date: string; // ISO date
  amount: number;
  status: ChargeStatus;
  rail: PaymentRail;
  paypalTransactionId?: string;
}

export interface UsageDay {
  subId: string;
  date: string; // ISO date
  minutes: number;
  /** android: the companion app. web: the browser extension. account: the provider's own API. */
  source: 'android' | 'web' | 'account' | 'manual';
}

/** Whether the user is signed in to a provider, and how we know. */
export type AuthStatus = 'signed_in' | 'likely' | 'signed_out' | 'unknown';

/** What the browser extension last saw for one subscription's site. */
export interface WebPresence {
  lastSeenAt?: string;
  /** The site counts as in use until this moment; each heartbeat pushes it forward. */
  activeUntil?: string;
  auth?: AuthStatus;
  authCheckedAt?: string;
  /** When the browser's session for the site runs out, if its cookie says. */
  sessionExpiresAt?: string;
}

/** The last time a PayPal agreement was read back from PayPal. */
export interface BillingCheck {
  status: string;
  ok: boolean;
  checkedAt: string;
  error?: string;
}

export interface ConnectionSignal {
  kind: 'browser' | 'phone' | 'account' | 'billing';
  ok: boolean;
  label: string;
  at?: string;
}

/** Everything known, without the user doing anything, about how one subscription is connected. */
export interface ServiceConnection {
  subId: string;
  /** live: in use right now. connected: a source reports for it. attention: something needs the user. waiting: nothing reports yet. */
  state: 'live' | 'connected' | 'attention' | 'waiting';
  headline: string;
  activeUntil?: string;
  auth: { status: AuthStatus; via: 'browser' | 'oauth' | 'none'; checkedAt?: string; expiresAt?: string };
  signals: ConnectionSignal[];
}

/** One question the fit check asks before judging a subscription. */
export interface FitQuestion {
  id: string;
  label: string;
  /** titles: a list of films or series. choice: pick one. multi: pick any. text / number: free entry. */
  kind: 'titles' | 'choice' | 'multi' | 'text' | 'number';
  options?: string[];
  hint?: string;
  /** For titles: what is popular on the service right now, to pick from. */
  suggestions?: string[];
}

export interface FitTitle {
  title: string;
  /** Whether a page for the title could be read. When false, nothing is known about it. */
  found: boolean;
  onService: boolean;
  url?: string;
  offers: { provider: string; kind: 'stream' | 'rent' | 'buy'; price?: number; currency?: string; quality?: string }[];
}

export interface FitAlternative {
  name: string;
  providerId?: string;
  plan?: string;
  price?: number;
  currency?: string;
  cycle?: string;
  why: string;
  /** live: the price was read from the official page in this check. catalog: built-in list price. model: the model's own claim, not checked. */
  basis: 'live' | 'catalog' | 'model';
}

/** The answer to "is this subscription right for me?", from the user's answers, their usage and what could be read live. */
export interface FitCheck {
  subId: string;
  createdAt: string;
  engine: 'gemini' | 'rules';
  answers: Record<string, string>;
  verdict: 'worth_it' | 'partly' | 'not_worth_it' | 'unclear';
  headline: string;
  reasoning: string;
  recommendation: { action: 'keep' | 'downgrade' | 'switch' | 'rent_instead' | 'cancel'; text: string; monthlySaving?: number };
  titles: FitTitle[];
  /** For a streaming service: what renting every wanted title that it lacks would cost once. */
  rentTotal?: number;
  alternatives: FitAlternative[];
  sources: { label: string; url: string }[];
  /** What the judgement rests on, including what could not be checked. */
  basis: string[];
  steps: RunStep[];
}

/**
 * A proposal the user turned down. It is how Subster learns a preference: the same change is not
 * suggested again until something about the subscription has actually changed.
 */
export interface Decline {
  subId: string;
  type: ActionType;
  at: string;
  /** What the subscription cost and how much it was used when the user said no. */
  price: number;
  hours30: number;
}

export type RefundReason = 'charged_after_cancel' | 'unused_renewal' | 'trial_converted' | 'duplicate_charge' | 'price_changed' | 'other';

/**
 * A refund the user is asking a provider for. Subster cannot issue refunds: only the company
 * that took the payment can. It prepares the request, says where to send it and keeps track.
 */
export interface RefundRequest {
  id: string;
  chargeId: string;
  subId: string;
  amount: number;
  reason: RefundReason;
  note?: string;
  /** drafted: written, not sent. sent: the user says they sent it. refunded / declined: the provider's answer. */
  status: 'drafted' | 'sent' | 'refunded' | 'declined';
  /** The request text, ready to paste into the provider's support form. */
  message: string;
  /** Facts from the user's own records that support the request. */
  evidence: string[];
  /** Where the request goes: the provider's account page, or PayPal's Resolution Centre for PayPal payments. */
  contactUrl: string;
  via: 'provider' | 'paypal';
  createdAt: string;
  updatedAt: string;
}

export type ActionType = 'cancel' | 'pause' | 'resume' | 'downgrade' | 'retry_payment' | 'subscribe';
export type ActionStatus =
  | 'pending' // waiting for the user
  | 'executed' // done and verified
  | 'guided' // approved; needs the user to finish on the merchant's site
  | 'rejected'
  | 'failed';

export interface ActionStep {
  at: string;
  label: string;
  detail?: string;
  ok: boolean;
}

export interface AgentAction {
  id: string;
  subId: string;
  type: ActionType;
  title: string;
  reason: string;
  evidence: string[];
  savingsMonthly: number;
  /** Last moment the action still avoids the next charge. */
  deadline: string;
  status: ActionStatus;
  /** 'user' approved it, or 'policy' when the user's standing permission covered it. */
  approvedBy?: 'user' | 'policy';
  channel: 'paypal_api' | 'guided';
  createdAt: string;
  resolvedAt?: string;
  runId?: string;
  steps: ActionStep[];
  /** For a subscribe action: what is being bought. */
  providerId?: string;
  plan?: { name: string; price: number; cycle: BillingCycle };
  /** Where the user finishes an approval that PayPal needs them to give in person. */
  approveUrl?: string;
}

export interface TimelineNote {
  id: string;
  subId: string;
  date: string;
  kind: 'review' | 'webhook' | 'bank';
  label: string;
}

/** One row of a component the agent shows in the chat. */
export interface WidgetItem {
  label: string;
  value?: number;
  max?: number;
  /** The value as the user should read it, e.g. an amount with its currency. */
  text?: string;
  detail?: string;
  tone?: 'good' | 'warn' | 'bad';
  subscriptionId?: string;
  /** For a choice: the message sent on the user's behalf when it is picked. */
  send?: string;
  checked?: boolean;
}

/** A component the agent chose to show under its reply instead of writing the same thing as text. */
export interface Widget {
  type: 'progress' | 'stats' | 'choices' | 'checklist' | 'confirm' | 'subscriptions' | 'table';
  title?: string;
  note?: string;
  items: WidgetItem[];
  columns?: string[];
  rows?: string[][];
  confirmLabel?: string;
  /** What is sent on the user's behalf when they confirm a checklist or a dialog. */
  prompt?: string;
}

export interface RunStep {
  at: string;
  kind: 'tool' | 'thought' | 'action' | 'final';
  tool?: string;
  title: string;
  detail?: string;
  /** The proposal this step created or found, so the chat can show it for approval in place. */
  actionId?: string;
  widget?: Widget;
}

/** One turn of a conversation with the agent, as it is kept and shown again later. */
export type ChatTurn =
  | { role: 'user'; content: string; mode: 'chat' | 'sweep'; at: string }
  | { role: 'assistant'; content: string; steps: RunStep[]; error?: string; at: string };

/** A conversation. The server holds it, so the agent keeps its context between visits. */
export interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  turns: ChatTurn[];
}

export type ChatSessionSummary = Pick<ChatSession, 'id' | 'title' | 'createdAt' | 'updatedAt'> & { messages: number; preview: string };

export interface AgentRun {
  id: string;
  trigger: 'manual' | 'webhook' | 'bank' | 'chat' | 'schedule';
  triggerDetail?: string;
  engine: 'gemini' | 'rules';
  startedAt: string;
  finishedAt?: string;
  steps: RunStep[];
  summary?: string;
}

export interface Db {
  version: number;
  /** True while the store holds the built-in demo data instead of the user's own. */
  demo?: boolean;
  seededAt: string;
  subscriptions: Subscription[];
  charges: Charge[];
  usage: UsageDay[];
  actions: AgentAction[];
  notes: TimelineNote[];
  runs: AgentRun[];
  /** Refund requests. Optional so documents written before it existed still load. */
  refunds?: RefundRequest[];
  /** Proposals the user turned down, newest first. */
  declines?: Decline[];
  /** UPI IDs the user linked. Optional so older documents still load. */
  upiIds?: UpiId[];
  /** Conversations with the agent, newest first. Optional so older documents still load. */
  chats?: ChatSession[];
  /** When the agent last audited everything on its own schedule. */
  lastScheduledAuditAt?: string;
  /** Live lookups kept for a day, so repeating a check does not spend the model's small daily allowance. */
  liveCache?: Record<string, { at: string; value: unknown }>;
  /** The latest fit check per subscription. */
  fitChecks?: Record<string, FitCheck>;
  /** Live signals from the browser extension, by subscription id. */
  presence?: Record<string, WebPresence>;
  /** PayPal agreement read-backs, by subscription id. */
  billingChecks?: Record<string, BillingCheck>;
  /** When the browser extension last called in. */
  extensionSeenAt?: string;
  webhookLog: { at: string; source: 'paypal' | 'bank'; type: string; resource: string; handled: string }[];
  bank: BankLink | null;
  bankTransactions: BankTransaction[];
  settings: Settings;
  accounts: AccountConnection[];
  /** Plans read from each provider's official site, keyed by catalog id. */
  livePlans: Record<string, LivePlans>;
  /** Recurring merchants the catalog does not know, waiting for the user to confirm. */
  candidates: Candidate[];
  ignoredMerchants: string[];
  /** Account Aggregator consent that was started and not yet completed. */
  pendingConsent?: string;
  /** OAuth state issued for a provider sign-in that has not returned yet. */
  oauthState?: string;
}

// ---- Derived intelligence -------------------------------------------------------------

export type Verdict = 'great' | 'fair' | 'poor' | 'unused' | 'unmeasured' | 'essential';
export type IssueType =
  | 'unused'
  | 'declining'
  | 'low_value'
  | 'duplicate'
  | 'price_increase'
  | 'trial_ending'
  | 'renews_soon'
  | 'payment_failed';

export interface Issue {
  type: IssueType;
  severity: 'info' | 'warn' | 'critical';
  message: string;
}

export interface Recommendation {
  action: 'keep' | 'cancel' | 'pause' | 'downgrade' | 'review' | 'retry_payment';
  reason: string;
  savingsMonthly: number;
  confidence: 'high' | 'medium' | 'low';
}

export interface Insight {
  sub: Subscription;
  monthlyCost: number;
  yearlyCost: number;
  hours30: number;
  hoursPrev30: number;
  trendPct: number | null;
  activeDays30: number;
  daysSinceLastUse: number | null;
  costPerHour: number | null;
  valueScore: number | null;
  verdict: Verdict;
  /** Set when a change was recommended but the user has already said no to it and nothing has changed since. */
  keptByChoice?: { type: ActionType; at: string };
  daysToRenewal: number;
  issues: Issue[];
  recommendation: Recommendation;
  weekly: { weekStart: string; hours: number }[];
  lastCharge?: Charge;
  previousPrice?: number;
}

export interface Portfolio {
  asOf: string;
  monthlySpend: number;
  yearlySpend: number;
  wastedMonthly: number;
  potentialSavingsMonthly: number;
  hours30: number;
  next30Total: number;
  activeCount: number;
  insights: Insight[];
  upcoming: { subId: string; name: string; date: string; amount: number; kind: 'renewal' | 'trial_conversion' }[];
}

export interface AppState {
  /** The data on screen is the built-in demo set, not the user's own. */
  demo: boolean;
  portfolio: Portfolio;
  settings: Settings;
  upiIds: UpiId[];
  accounts: Omit<AccountConnection, 'tokens'>[];
  livePlans: Record<string, LivePlans>;
  actions: AgentAction[];
  runs: AgentRun[];
  notes: TimelineNote[];
  charges: Charge[];
  refunds: RefundRequest[];
  fitChecks: Record<string, FitCheck>;
  /** How each subscription is connected right now, by subscription id. */
  connections: Record<string, ServiceConnection>;
  /** When the browser extension last called in, and when connections were last verified. */
  monitor: { extensionSeenAt?: string; checkedAt?: string; lastScheduledAuditAt?: string };
  /** Imported bank payments, newest first (the latest 500). */
  bankTransactions: BankTransaction[];
  usage: UsageDay[];
  integrations: {
    paypal: 'sandbox' | 'live' | 'off';
    /** AG Studio licence keys are meant for the browser; without one Studio runs as a trial. */
    agStudioLicense?: string;
    /** Model requests sent today across all keys, and what the free tier leaves. */
    ai: { keys: number; models: number; sentToday: number; dailyAllowance: number; exhausted: number; slots: number; availableAgainAt?: string };
    /** Whether live plan checks against official sites can run (needs a Gemini API key). */
    planMonitor: boolean;
    /** Whether Spotify OAuth credentials are configured. */
    spotify: boolean;
    bank: { available: BankLink['provider'][]; plaidSandbox: boolean; transactionCount: number; link: Omit<BankLink, 'accessToken' | 'cursor'> | null; recent: BankTransaction[]; candidates: Candidate[] };
    agent: 'gemini' | 'rules';
    webhookLog: Db['webhookLog'];
  };
}

export type StreamEvent =
  | { type: 'step'; step: RunStep }
  | { type: 'text'; text: string }
  | { type: 'done'; runId: string; summary: string }
  | { type: 'error'; message: string };

// ---- Bank link ---------------------------------------------------------------------------

/** A UPI ID the user linked, kept only on this device. */
export interface UpiId {
  id: string;
  vpa: string;
  addedAt: string;
}

export interface BankTransaction {
  id: string;
  date: string; // ISO date
  description: string;
  /** Positive = money leaving the account. */
  amount: number;
  /** Subscription this charge was matched to, once discovery has run. */
  subId?: string;
}

export interface BankLink {
  provider: 'plaid' | 'setu';
  institution: string;
  accountMask?: string;
  linkedAt: string;
  lastSyncAt?: string;
  /** Provider credential for this link. Never sent to the browser. */
  accessToken?: string;
  /** Provider sync cursor, so each sync only fetches what is new. */
  cursor?: string;
}

/** Pushed to open dashboards over the event stream. */
export type LiveEvent =
  | { type: 'state'; reason: string; at: string }
  | { type: 'log'; entry: LogEntry }
  | { type: 'hello'; at: string };

export interface Candidate {
  key: string;
  name: string;
  amount: number;
  cycle: BillingCycle;
  lastDate: string;
  count: number;
  /** Suggested by the keyword classifier. */
  category: Category;
}

// ---- Application logs --------------------------------------------------------------------

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  id: string;
  at: string;
  level: LogLevel;
  /** Which part of the system wrote it: http, agent, paypal, bank, discovery, actions ... */
  scope: string;
  message: string;
  /** The request that caused it, when there was one. Ties service logs to an HTTP line. */
  requestId?: string;
  meta?: Record<string, unknown>;
  /** The account the request belonged to, when there was one. */
  userId?: string;
}

// ---- Settings, classification, linked accounts ---------------------------------------------

export type Currency = 'USD' | 'INR' | 'EUR' | 'GBP';

export interface Settings {
  /** The currency the user's own money is in. Amounts are never converted. */
  currency: Currency;
  /** Whether the agent audits everything once a day by itself. On unless switched off. */
  dailyAudit?: boolean;
}

/** catalog: a known provider. rules: keyword match. ai: Gemini. user: set by hand. */
export type Classifier = 'catalog' | 'rules' | 'ai' | 'user';

/** The user's own account at a provider, linked through the provider's sign-in. */
export interface AccountConnection {
  providerId: string;
  /** oauth: the provider confirmed the account. self: the user says they signed in on the provider's site. */
  method: 'oauth' | 'self';
  displayName?: string;
  /** The plan the provider reports for the account, when its API exposes one. */
  product?: string;
  connectedAt: string;
  lastSyncAt?: string;
  /** When the link was last verified with the provider, and whether it has stopped working. */
  checkedAt?: string;
  needsReauth?: boolean;
  /** OAuth tokens. Never sent to the browser. */
  tokens?: { accessToken: string; refreshToken?: string; expiresAt: number };
}

// ---- Live plans ----------------------------------------------------------------------------

/** A plan as the provider's official site lists it for the user's region. */
export interface LivePlan {
  name: string;
  price: number;
  currency: Currency;
  cycle: BillingCycle;
  note?: string;
}

export interface LivePlans {
  providerId: string;
  /** ok: `plans` came from the official site. failed: no check has succeeded yet. */
  status: 'ok' | 'failed';
  plans: LivePlan[];
  region: string;
  /** The official pages the plans were read from. */
  sourceUrls: string[];
  /** When `plans` were last read successfully. */
  checkedAt: string;
  /** When a check was last tried, and why it failed if it did. */
  lastAttemptAt?: string;
  error?: string;
  /** What differed from the previous successful check. */
  changes?: string[];
  changedAt?: string;
}
