/**
 * Resolves `{{paramName}}` templates. Applies only to action.text/url/option and
 * idempotency.key -- never to locator fields, so what an artifact targets can never
 * depend on caller-supplied input values.
 *
 * Redacting an interpolated value in evidence/logs when its input declares
 * `redact: true` is a concern for the evidence writer (later), not this module.
 */
import type { Action } from '../surface/action';

export type InterpolateResult = { ok: true; value: string } | { ok: false; missing: string };

export function interpolate(template: string, params: Readonly<Record<string, string>>): InterpolateResult {
  let missing: string | undefined;
  const value = template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
    if (!(name in params)) {
      missing ??= name;
      return '';
    }
    return params[name]!;
  });
  return missing ? { ok: false, missing } : { ok: true, value };
}

export type InterpolateActionResult = { ok: true; action: Action } | { ok: false; missing: string };

export function interpolateAction(action: Action, params: Readonly<Record<string, string>>): InterpolateActionResult {
  if (action.kind === 'navigate') {
    const r = interpolate(action.url, params);
    return r.ok ? { ok: true, action: { ...action, url: r.value } } : r;
  }
  if (action.kind === 'type') {
    const r = interpolate(action.text, params);
    return r.ok ? { ok: true, action: { ...action, text: r.value } } : r;
  }
  if (action.kind === 'select') {
    const r = interpolate(action.option, params);
    return r.ok ? { ok: true, action: { ...action, option: r.value } } : r;
  }
  // click, typeCredential, read: nothing interpolatable.
  return { ok: true, action };
}
