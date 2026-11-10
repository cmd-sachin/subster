// The one wrapper every API route goes through. It gives each request an id, logs the method,
// path, status and duration, and turns an unexpected exception into a logged 500 instead of a
// crashed handler. Route files stay thin: parse, call a service, respond.

import './env';
import { log, requestContext } from './logger';

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

export function handle(name: string, handler: Handler, options: { quiet?: boolean } = {}) {
  return async (ctx: { request: Request; params?: Record<string, string> }): Promise<Response> => {
    const requestId = Math.random().toString(36).slice(2, 10);
    const started = performance.now();
    const url = new URL(ctx.request.url);
    return requestContext.run({ requestId }, async () => {
      let response: Response;
      try {
        response = await handler({ request: ctx.request, params: ctx.params ?? {} });
      } catch (error) {
        if (error instanceof HttpError) {
          response = fail(error.status, error.message);
        } else {
          log.error('http', `${name} threw`, { error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack?.split('\n').slice(0, 6).join('\n') : undefined });
          response = fail(500, 'Something went wrong on the server. The error has been logged.');
        }
      }
      const ms = Math.round(performance.now() - started);
      // Polling-style reads are logged at debug so they do not drown out real activity.
      const level = response.status >= 500 ? 'error' : response.status >= 400 ? 'warn' : options.quiet ? 'debug' : 'info';
      log[level]('http', `${ctx.request.method} ${url.pathname} ${response.status}`, { route: name, ms });
      return response;
    });
  };
}
