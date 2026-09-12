/**
 * Hand-rolled cookie session -- no express-session dependency for something this small.
 * Fault mode and tenant are session-scoped (set via /_control/*, never a query param):
 * a real session timeout isn't a query parameter, and a param wouldn't reach child
 * frames, form posts, or generated links without threading it through every one of them.
 */
import { randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';

export type FaultMode = 'none' | 'not_found' | 'session_expired' | 'permission' | 'slow' | 'dialog' | 'server_error';
export type Tenant = 'a' | 'b';

export interface SessionState {
  authenticated: boolean;
  fault: FaultMode;
  tenant: Tenant;
  /** The "dialog" fault shows an interstitial once per session, like a real one-time notice. */
  dialogDismissed: boolean;
}

const sessions = new Map<string, SessionState>();

function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return undefined;
}

function freshState(): SessionState {
  return { authenticated: false, fault: 'none', tenant: 'a', dialogDismissed: false };
}

export function session(req: Request, res: Response): SessionState {
  const id = parseCookie(req.headers.cookie, 'sid');
  const existing = id ? sessions.get(id) : undefined;
  if (existing) return existing;

  const newId = randomBytes(16).toString('hex');
  const state = freshState();
  sessions.set(newId, state);
  res.setHeader('Set-Cookie', `sid=${newId}; HttpOnly; Path=/`);
  return state;
}

export function resetSession(req: Request, res: Response): void {
  const id = parseCookie(req.headers.cookie, 'sid');
  if (id) sessions.set(id, freshState());
  else session(req, res);
}
