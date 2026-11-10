import type { BankLink } from '@/domain/types';
import type { BankConnector } from './connector';
import { plaidConfigured, plaidConnector } from './plaid';
import { setuConfigured, setuConnector } from './setu';

export type BankProvider = BankLink['provider'];

/** Providers that have credentials configured. Plaid first: it covers US, Canadian and European banks. */
export const availableBanks = (): BankProvider[] => [plaidConfigured() && 'plaid', setuConfigured() && 'setu'].filter((p): p is BankProvider => Boolean(p));

export const plaidIsSandbox = () => process.env.PLAID_ENV !== 'production';

export const connectorFor = (provider: BankProvider): BankConnector => (provider === 'plaid' ? plaidConnector : setuConnector);
