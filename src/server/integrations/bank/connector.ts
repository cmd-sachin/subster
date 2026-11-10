// The contract every bank provider implements. Services depend on this, never on a provider.

import type { BankLink, BankTransaction } from '@/domain/types';

export interface SyncResult {
  added: BankTransaction[];
  /** Cursor to store on the link so the next sync only returns what is new. */
  cursor: string;
}

export interface BankConnector {
  id: BankLink['provider'];
  /** Token for the provider's own account-linking UI, when it has one. */
  createLinkToken?(origin: string): Promise<string>;
  /** Completes a link started in the provider's UI. */
  exchange?(publicToken: string, meta: { institution?: string; mask?: string }): Promise<BankLink>;
  /** Starts a link that happens on the provider's own site. Returns where to send the user and a reference to finish with. */
  startRedirect?(origin: string, input: { mobile: string }): Promise<{ url: string; reference: string }>;
  /** Completes a redirect link once the user is back and has approved it. */
  completeRedirect?(reference: string): Promise<BankLink>;
  /** Links a test account without any UI. Sandbox and demo only. */
  instantLink(origin: string): Promise<BankLink>;
  sync(link: BankLink): Promise<SyncResult>;
  /** Makes the bank post new transactions, to demonstrate the live path end to end. */
  postTestTransactions(link: BankLink, transactions: { date: string; description: string; amount: number }[]): Promise<void>;
}
