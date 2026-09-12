/** One page per business/runtime condition the fault harness can force. */
import { page } from '../layout';
import type { Tenant } from '../session';

const BACK_TO_SEARCH = `<p><span class="actionCell" onclick="location.href='/search'">Back to Search</span></p>`;

export function notFoundPage(id: string, tenant: Tenant): string {
  return page('Not Found', `<div class="error">No member found for ID ${id}.</div>${BACK_TO_SEARCH}`, tenant);
}

export function permissionDeniedPage(tenant: Tenant): string {
  return page('Permission Denied', `<div class="error">You do not have permission to perform this action.</div>${BACK_TO_SEARCH}`, tenant);
}

export function serverErrorPage(tenant: Tenant): string {
  return page('Server Error', `<div class="error">An unexpected error occurred. Reference: SVC-500.</div>`, tenant);
}

export function sessionExpiredPage(tenant: Tenant): string {
  return page(
    'Session Expired',
    `
<div class="error">Your session has expired. Please log in again.</div>
<form method="post" action="/login">
  <table class="fld">
    <tr><td><label for="uname2">Username</label></td><td><input type="text" id="uname2" name="f_a1"></td></tr>
    <tr><td>Password</td><td><input type="password" name="f_a2"></td></tr>
    <tr><td colspan="2"><button type="submit">Log In</button></td></tr>
  </table>
</form>
`,
    tenant,
  );
}

export function dialogInterstitialPage(returnTo: string, tenant: Tenant): string {
  return page(
    'System Notice',
    `
<div class="notice">Scheduled maintenance completed. Click OK to continue.</div>
<form method="post" action="/_dismiss-dialog">
  <input type="hidden" name="returnTo" value="${returnTo}">
  <button type="submit">OK</button>
</form>
`,
    tenant,
  );
}
