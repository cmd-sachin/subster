// The one wrapper every API route goes through. It gives each request an id, logs the method,
// path, status and duration, and turns an unexpected exception into a logged 500 instead of a
// crashed handler. Route files stay thin: parse, call a service, respond.

import './env';
import { AsyncLocalStorage } from 'node:async_hooks';
import { accountFor, ACCOUNTS, AuthError, forgetAccounts, singleUser, type Account, type Permission } from './auth';
import { PENDING } from './auth-factors';
import { log, requestContext } from './logger';
import { LOCAL_USER } from './store';
import { loadUsers } from './users';
import * as vfs from './vfs';

export interface RouteContext {
  request: Request;
  params: Record<string, string>;
}

type Handler = (ctx: RouteContext) => Response | Promise<Response>;

/** Thrown by handlers and services to answer with a specific status and message. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const json = (data: unknown, status = 200) => Response.json(data, { status });
export const fail = (status: number, message: string) => Response.json({ error: message }, { status });

/** Reads a JSON body, treating a missing or malformed one as an empty object. */
export async function body<T>(request: Request): Promise<Partial<T>> {
  return ((await request.json().catch(() => ({}))) ?? {}) as Partial<T>;
}

export interface RouteOptions {
  quiet?: boolean;
  /**
   * Who may call the route. "user" (the default) needs a signed-in account; "admin" an
   * administrator; "device" also accepts a device key, for the browser extension and the phone
   * app; "public" needs nothing, for sign-in itself and for webhooks that verify themselves.
   */
  access?: 'public' | 'user' | 'admin' | 'device';
  /** A permission the account must hold. Administrators switch these per account. */
  needs?: Permission;
}

const DENIED: Record<Permission, string> = {
  assistant: 'The assistant is switched off for your account. Ask the administrator.',
  paypal: 'PayPal actions are switched off for your account. Ask the administrator.',
  connect: 'Linking accounts is switched off for your account. Ask the administrator.',
};

/** The account behind the current request. Routes marked "public" may not have one. */
export const currentAccount = () => accountContext.getStore();
const accountContext = new AsyncLocalStorage<Account | undefined>();

/** Stops the request unless the account holds a permission. For checks that depend on the body. */
export function requirePermission(permission: Permission) {
  const account = currentAccount();
  if (account && account.role !== 'admin' && !account.permissions[permission]) throw new HttpError(403, DENIED[permission]);
}

export function handle(name: string, handler: Handler, options: RouteOptions = {}) {
  return async (ctx: { request: Request; params?: Record<string, string> }): Promise<Response> => {
    const requestId = Math.random().toString(36).slice(2, 10);
    const started = performance.now();
    const url = new URL(ctx.request.url);
    const access = options.access ?? 'user';
    // On a serverless host, fetch what this request needs before looking at it: first who has an
    // account, then the data of whoever is calling.
    if (vfs.remote && (await vfs.hydrate([ACCOUNTS, PENDING])).includes(ACCOUNTS)) forgetAccounts();
    const account = singleUser() ? undefined : accountFor(ctx.request, access === 'device');
    const userId = singleUser() ? LOCAL_USER : account?.id;
    if (userId) await loadUsers([userId]);
    return requestContext.run({ requestId, userId }, () =>
      accountContext.run(account, async () => {
        let response: Response;
        try {
          if (!singleUser() && access !== 'public') {
            if (!account) throw new HttpError(401, 'Sign in to continue.');
            if (account.status === 'suspended') throw new HttpError(403, 'This account is suspended.');
            if (access === 'admin' && account.role !== 'admin') throw new HttpError(403, 'Only an administrator can do that.');
            if (options.needs) requirePermission(options.needs);
          }
          response = await handler({ request: ctx.request, params: ctx.params ?? {} });
        } catch (error) {
          if (error instanceof HttpError || error instanceof AuthError) {
            response = fail(error.status, error.message);
          } else {
            log.error('http', `${name} threw`, { error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack?.split('\n').slice(0, 6).join('\n') : undefined });
            response = fail(500, 'Something went wrong on the server. The error has been logged.');
          }
        }
        // Whatever the handler changed goes back to the shared database before the answer does.
        await vfs.flush().catch((error) => log.error('http', 'Changes could not be saved', { error: error instanceof Error ? error.message : String(error) }));
        const ms = Math.round(performance.now() - started);
        // Polling-style reads are logged at debug so they do not drown out real activity.
        const level = response.status >= 500 ? 'error' : response.status >= 400 && response.status !== 401 ? 'warn' : options.quiet || response.status === 401 ? 'debug' : 'info';
        log[level]('http', `${ctx.request.method} ${url.pathname} ${response.status}`, { route: name, ms });
        return response;
      }),
    );
  };
}
