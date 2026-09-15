/**
 * Member search. The field has no <label for> -- only an adjacent table cell -- and the
 * "button" is a <td onclick>, not a real button. Both are common in legacy servicing
 * screens and neither carries a test ID or a meaningful id/name attribute.
 */
import { page } from '../layout';
import type { Tenant } from '../session';

export function searchPage(tenant: Tenant, error?: string): string {
  const label = tenant === 'b' ? 'Account Number' : 'Member ID';
  const errorHtml = error ? `<div class="error">${error}</div>` : '';
  return page(
    'Search',
    `
${errorHtml}
<form method="get" action="/member" id="_f">
  <table class="fld">
    <tr>
      <td>${label}</td>
      <td><input type="text" name="id" form="_f"></td>
      <td><span class="actionCell primary" onclick="document.getElementById('_f').submit()">Search</span></td>
    </tr>
  </table>
</form>
`,
    tenant,
  );
}
