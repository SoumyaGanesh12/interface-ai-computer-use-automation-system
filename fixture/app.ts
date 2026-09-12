/**
 * The hostile legacy back-office console this system automates against. Server-rendered,
 * no build step, no client framework. Two flows (search -> member, card order with a
 * confirmation step), six injectable faults, one tenant variant -- enough to exercise
 * the interesting cases without becoming a project of its own.
 */
import express from 'express';
import type { Response } from 'express';
import { MEMBERS, OPERATOR_CREDENTIALS } from './data';
import { findOrder, placeOrder } from './orders';
import { session, resetSession, type SessionState, type FaultMode } from './session';
import { loginPage } from './pages/login';
import { frameShell, navPage } from './pages/frame';
import { searchPage } from './pages/search';
import { memberPage } from './pages/member';
import { verifyIdentityPage, confirmOrderPage, orderConfirmedPage } from './pages/cardOrder';
import { notFoundPage, permissionDeniedPage, serverErrorPage, sessionExpiredPage, dialogInterstitialPage } from './pages/errors';

export const app = express();
app.use(express.urlencoded({ extended: false }));

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Faults common to /member and /card/order. Returns true if a response was already sent. */
async function applyCommonFaults(res: Response, state: SessionState, returnTo: string): Promise<boolean> {
  if (state.fault === 'server_error') {
    res.status(500).send(serverErrorPage(state.tenant));
    return true;
  }
  if (state.fault === 'slow') {
    await delay(3000);
  }
  if (state.fault === 'dialog' && !state.dialogDismissed) {
    res.send(dialogInterstitialPage(returnTo, state.tenant));
    return true;
  }
  return false;
}

// --- Public routes -----------------------------------------------------------------

app.get('/login', (req, res) => {
  session(req, res);
  res.send(loginPage());
});

app.post('/login', (req, res) => {
  const state = session(req, res);
  const { f_a1: username, f_a2: password } = req.body as Record<string, string>;
  if (username === OPERATOR_CREDENTIALS.username && password === OPERATOR_CREDENTIALS.password) {
    state.authenticated = true;
    state.fault = 'none'; // a successful re-auth is how the session_expired fault clears
    res.redirect('/app');
  } else {
    res.status(401).send(loginPage({ error: 'Invalid username or password.' }));
  }
});

app.get('/logout', (req, res) => {
  resetSession(req, res);
  res.redirect('/login');
});

app.get('/_control/fault/:mode', (req, res) => {
  const state = session(req, res);
  const modes: FaultMode[] = ['none', 'not_found', 'session_expired', 'permission', 'slow', 'dialog', 'server_error'];
  const mode = req.params.mode as FaultMode;
  if (!modes.includes(mode)) {
    res.status(400).send(`unknown fault mode: ${req.params.mode}`);
    return;
  }
  state.fault = mode;
  if (mode !== 'dialog') state.dialogDismissed = false;
  res.send(`fault set to ${mode}`);
});

app.get('/_control/tenant/:variant', (req, res) => {
  const state = session(req, res);
  const variant = req.params.variant;
  if (variant !== 'a' && variant !== 'b') {
    res.status(400).send(`unknown tenant variant: ${variant}`);
    return;
  }
  state.tenant = variant;
  res.send(`tenant set to ${variant}`);
});

app.get('/_control/reset', (req, res) => {
  resetSession(req, res);
  res.send('session reset');
});

app.post('/_dismiss-dialog', (req, res) => {
  const state = session(req, res);
  state.dialogDismissed = true;
  const { returnTo } = req.body as Record<string, string>;
  res.redirect(returnTo || '/search');
});

// --- Authenticated routes ------------------------------------------------------------

app.use((req, res, next) => {
  const state = session(req, res);
  if (!state.authenticated) {
    res.redirect('/login');
    return;
  }
  if (state.fault === 'session_expired') {
    res.send(sessionExpiredPage(state.tenant));
    return;
  }
  next();
});

app.get('/', (_req, res) => res.redirect('/app'));
app.get('/app', (_req, res) => res.send(frameShell()));
app.get('/nav', (req, res) => res.send(navPage(session(req, res).tenant)));
app.get('/search', (req, res) => {
  const state = session(req, res);
  const error = typeof req.query.error === 'string' ? req.query.error : undefined;
  res.send(searchPage(state.tenant, error));
});

app.get('/member', async (req, res) => {
  const state = session(req, res);
  const id = String(req.query.id ?? '').trim();
  if (!id) {
    res.redirect('/search?' + new URLSearchParams({ error: 'Enter a member ID to search.' }).toString());
    return;
  }
  if (await applyCommonFaults(res, state, `/member?id=${id}`)) return;

  if (state.fault === 'not_found') {
    res.send(notFoundPage(id, state.tenant));
    return;
  }
  const member = MEMBERS[id];
  if (!member) {
    res.send(notFoundPage(id, state.tenant));
    return;
  }
  res.send(memberPage(member, state.tenant, findOrder(id)));
});

app.get('/card/order', async (req, res) => {
  const state = session(req, res);
  const id = String(req.query.id ?? '').trim();
  if (!id) {
    res.redirect('/search?' + new URLSearchParams({ error: 'Enter a member ID to search.' }).toString());
    return;
  }
  if (await applyCommonFaults(res, state, `/card/order?id=${id}`)) return;

  if (state.fault === 'permission') {
    res.send(permissionDeniedPage(state.tenant));
    return;
  }
  const member = MEMBERS[id];
  if (!member) {
    res.send(notFoundPage(id, state.tenant));
    return;
  }
  if (state.tenant === 'b' && req.query.verified !== '1') {
    res.send(verifyIdentityPage(member, state.tenant));
    return;
  }
  res.send(confirmOrderPage(member, state.tenant, findOrder(id)));
});

app.post('/card/order', (req, res) => {
  const state = session(req, res);
  const { id } = req.body as Record<string, string>;
  if (state.fault === 'permission') {
    res.send(permissionDeniedPage(state.tenant));
    return;
  }
  if (state.fault === 'server_error') {
    res.status(500).send(serverErrorPage(state.tenant));
    return;
  }
  const member = MEMBERS[id ?? ''];
  if (!member) {
    res.send(notFoundPage(id ?? '', state.tenant));
    return;
  }
  const order = placeOrder(member.id);
  res.send(orderConfirmedPage(order, state.tenant));
});
