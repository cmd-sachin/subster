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
export type Coverage = 'phone' | 'phone+tv' | 'none';

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
  /** Where SubSense learned about this subscription. */
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
  source: 'android' | 'account' | 'manual';
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

export interface RunStep {
  at: string;
  kind: 'tool' | 'thought' | 'action' | 'final';
  tool?: string;
  title: string;
  detail?: string;
}

export interface AgentRun {
  id: string;
  trigger: 'manual' | 'webhook' | 'bank' | 'chat';
  triggerDetail?: string;
  engine: 'gemini' | 'rules';
  startedAt: string;
  finishedAt?: string;
  steps: RunStep[];
  summary?: string;
}

export interface Db {
  version: number;
  seededAt: string;
  subscriptions: Subscription[];
  charges: Charge[];
  usage: UsageDay[];
  actions: AgentAction[];
  notes: TimelineNote[];
  runs: AgentRun[];
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
  portfolio: Portfolio;
  settings: Settings;
  accounts: Omit<AccountConnection, 'tokens'>[];
  livePlans: Record<string, LivePlans>;
  actions: AgentAction[];
  runs: AgentRun[];
  notes: TimelineNote[];
  charges: Charge[];
  usage: UsageDay[];
  integrations: {
    paypal: 'sandbox' | 'live' | 'off';
    /** AG Studio licence keys are meant for the browser; without one Studio runs as a trial. */
    agStudioLicense?: string;
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
}

// ---- Settings, classification, linked accounts ---------------------------------------------

export type Currency = 'USD' | 'INR' | 'EUR' | 'GBP';

export interface Settings {
  /** The currency the user's own money is in. Amounts are never converted. */
  currency: Currency;
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
