/**
 * The outer frameset and the nav frame's content. Framesets are the norm in the real
 * environment this stands in for -- two frames routinely contain identically-named
 * controls, which is why Observation carries framePath as part of a node's address.
 */
import { page } from '../layout';
import type { Tenant } from '../session';

export function frameShell(): string {
  return `<!doctype html>
<html>
<head><title>Member Services Console</title></head>
<frameset cols="140,*">
  <frame name="nav" src="/nav">
  <frame name="content" src="/search">
</frameset>
</html>`;
}

export function navPage(tenant: Tenant): string {
  return page(
    'Navigation',
    `
<table>
  <tr><td class="actionCell" onclick="parent.content.location.href='/search'">Search Members</td></tr>
  <tr><td class="actionCell" onclick="parent.content.location.href='/logout'">Log Out</td></tr>
</table>
`,
    tenant,
  );
}
