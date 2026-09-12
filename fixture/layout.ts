/**
 * The hostile shell every screen renders inside: nested tables for layout, minimal CSS,
 * no framework. Tenant b gets a different header color -- cosmetic branding, same
 * structure, which is the point (a stand-in for two institutions on one vendor product).
 */
import type { Tenant } from './session';

export function page(title: string, bodyHtml: string, tenant: Tenant = 'a'): string {
  const headerColor = tenant === 'b' ? '#5b2a86' : '#1f4e79';
  return `<!doctype html>
<html>
<head>
<title>${title}</title>
<style>
  body { font-family: Tahoma, Geneva, sans-serif; font-size: 13px; margin: 0; }
  table { border-collapse: collapse; }
  .banner { background: ${headerColor}; color: white; padding: 6px 10px; font-weight: bold; }
  .content { padding: 12px; }
  .fld td { padding: 3px 6px; }
  .actionCell { background: #ddd; border: 1px outset #999; padding: 4px 14px; cursor: pointer; display: inline-block; }
  .acct td { border: 1px solid #999; padding: 4px 10px; }
  .notice { background: #fff3cd; border: 1px solid #ffcc00; padding: 10px; margin-bottom: 10px; }
  .error { background: #f8d7da; border: 1px solid #cc0000; padding: 10px; }
</style>
</head>
<body>
<div class="banner">MEMBER SERVICES CONSOLE ${tenant === 'b' ? '- Northgate Credit Union' : '- Riverbend Credit Union'}</div>
<div class="content">
${bodyHtml}
</div>
</body>
</html>`;
}
