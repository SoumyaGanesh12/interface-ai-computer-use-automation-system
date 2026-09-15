/**
 * The hostile shell every screen renders inside: nested tables for layout, minimal CSS,
 * no framework. Tenant b gets a different header color -- cosmetic branding, same
 * structure, which is the point (a stand-in for two institutions on one vendor product).
 */
import type { Tenant } from './session';

export function page(title: string, bodyHtml: string, tenant: Tenant = 'a', opts: { bannerText?: string; sidebar?: boolean } = {}): string {
  const headerColor = tenant === 'b' ? '#5b2a86' : '#1f4e79';
  const headerColorHover = tenant === 'b' ? '#45206a' : '#173d5f';
  const bannerText = opts.bannerText ?? `MEMBER SERVICES CONSOLE ${tenant === 'b' ? '- Northgate Credit Union' : '- Riverbend Credit Union'}`;
  const contentClass = opts.sidebar ? 'content sidebar' : 'content';
  // The sidebar's content area needs to exactly fill whatever space is left
  // under the banner -- a flex column does that precisely, unlike a
  // hardcoded "100% minus the banner's height" guess, which silently drifts
  // (and creates a stray scrollbar) the next time the banner's own
  // padding/font-size changes.
  const bodyClass = opts.sidebar ? ' class="flexShell"' : '';
  return `<!doctype html>
<html>
<head>
<title>${title}</title>
<style>
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    font-family: "Segoe UI", Tahoma, Arial, sans-serif; font-size: 13px;
    margin: 0; color: #2b2f33; background: #e9edf2; line-height: 1.5;
  }
  body.flexShell { display: flex; flex-direction: column; }
  body.flexShell > .banner { flex: 0 0 auto; }
  body.flexShell > .content { flex: 1 1 auto; min-height: 0; }
  table { border-collapse: collapse; }
  p { margin: 0 0 12px; }
  label { color: #444; }

  /* One shell across both frames: identical banner treatment in the nav
     frame and the content frame, and frameShell() (frame.ts) strips the
     browser's native 3D frame divider so the seam between them reads as a
     single thin line, not two visually unrelated windows bolted together. */
  .banner {
    background: ${headerColor}; color: white; padding: 14px 20px;
    font-weight: 600; font-size: 15px; letter-spacing: 0.4px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.25);
  }

  /* Every ordinary page's content sits in one consistent card that fills
     the available window instead of floating in a small fixed box -- login,
     search, member detail, card order, errors all share this; only the
     sidebar nav (below) opts out of it. */
  .content {
    margin: 24px 32px; background: #fff;
    border: 1px solid #d9dee4; border-radius: 6px;
    padding: 28px 36px; box-shadow: 0 2px 6px rgba(20,30,40,0.08);
  }
  .content.sidebar {
    margin: 0; padding: 16px 10px; border-radius: 0;
    background: #f4f6f9; box-shadow: none;
    border-right: 1px solid #d5dae0;
  }
  /* A single form (login) reads better narrow and centered inside the
     wide shared card, rather than stretched edge to edge with it -- both
     the box itself (.narrow) and its own field/button table (.fld) center,
     so the form isn't left-hugging one side of its own narrow box. */
  .narrow { max-width: 300px; margin: 0 auto; }
  .narrow .fld { margin: 0 auto; }

  .fld td { padding: 7px 8px; vertical-align: middle; }
  input[type="text"], input[type="password"] {
    font-family: inherit; font-size: 13px; padding: 7px 9px;
    border: 1px solid #a4acb3; border-radius: 4px; width: 100%;
    background: #fff; color: #222;
  }
  input[type="text"]:focus, input[type="password"]:focus {
    outline: none; border-color: ${headerColor}; box-shadow: 0 0 0 3px ${headerColor}22;
  }

  /* Secondary (default) action: a quiet, neutral control for anything that
     isn't the page's one main task. Primary action: the one thing the page
     most wants a user to do next, in the tenant's own accent color rather
     than flat browser-gray. Both are the same element kinds (<button> /
     <td onclick>) as before; "primary" is purely an added CSS hook, it
     changes no role, name, or locator. */
  button, .actionCell {
    background: #eef0f2; border: 1px solid #a4acb3; border-radius: 4px;
    padding: 7px 20px; cursor: pointer; display: inline-block;
    font-family: inherit; font-size: 13px; font-weight: 500; color: #2b2f33;
    transition: background-color 0.1s ease-in-out;
  }
  button:hover, .actionCell:hover { background: #e0e4e8; }
  button:focus, .actionCell:focus { outline: none; box-shadow: 0 0 0 3px ${headerColor}33; }

  button.primary, .actionCell.primary {
    background: ${headerColor}; border-color: ${headerColor}; color: #fff;
  }
  button.primary:hover, .actionCell.primary:hover { background: ${headerColorHover}; border-color: ${headerColorHover}; }

  .sidebar table { width: 100%; }
  .sidebar .actionCell { display: block; width: 100%; text-align: left; margin-bottom: 8px; }

  .acct { margin: 4px 0 18px; }
  .acct td { border: 1px solid #d9dee4; padding: 9px 16px; }
  .acct tr:first-child td { border-top: 1px solid #d9dee4; }

  /* A colored left rail instead of a flat tinted box -- reads as a
     deliberate status message, not a stray unstyled <div>. */
  .notice { background: #fffaf0; border: 1px solid #edd9a3; border-left: 4px solid #d9a02c; padding: 12px 16px; margin: 4px 0 16px; border-radius: 4px; }
  .error { background: #fdf2f2; border: 1px solid #e6b8b8; border-left: 4px solid #c0392b; padding: 12px 16px; margin: 4px 0 16px; border-radius: 4px; }
</style>
</head>
<body${bodyClass}>
<div class="banner">${bannerText}</div>
<div class="${contentClass}">
${bodyHtml}
</div>
</body>
</html>`;
}
