/**
 * Login. Deliberately inconsistent: the username field has a real <label for>, the
 * password field relies only on its adjacent table cell. Real legacy apps are uneven,
 * not uniformly bad -- see the locator-tier checkpoint this is meant to exercise.
 */
import { page } from '../layout';

export function loginPage(opts: { error?: string } = {}): string {
  const errorHtml = opts.error ? `<div class="error">${opts.error}</div>` : '';
  return page(
    'Login',
    `
${errorHtml}
<form method="post" action="/login">
  <table class="fld">
    <tr><td><label for="uname">Username</label></td><td><input type="text" id="uname" name="f_a1"></td></tr>
    <tr><td>Password</td><td><input type="password" name="f_a2"></td></tr>
    <tr><td colspan="2"><button type="submit">Log In</button></td></tr>
  </table>
</form>
`,
  );
}
