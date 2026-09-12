/**
 * Attaches a click/change listener in every frame while a human has the session.
 * Deliberately reads only tag name and a structural identifier (aria-label/name/id/
 * placeholder) -- never `.value` -- so a record of *what* was touched can never leak
 * *what was typed*.
 *
 * Attaches only to frames present when recording begins; a frame that appears mid-
 * session (this fixture's frameset is static, so it never does) would be missed --
 * a documented limit, not a silent one.
 */
import type { Page } from 'playwright';
import type { HumanAction } from './human-action';

const BINDING_NAME = '__cuaRecordHumanAction';

/**
 * Runs inside the page, serialized via .toString() -- it cannot close over anything
 * from this module's scope (BINDING_NAME included), only what's passed as an argument.
 * That exact mistake (referencing the outer const directly) is what silently broke this
 * the first time: the resulting page-side ReferenceError was swallowed by the caller's
 * defensive catch.
 */
function attachListeners(bindingName: string): void {
  const w = window as unknown as { __cuaClick?: (e: Event) => void; __cuaInput?: (e: Event) => void };
  const targetName = (el: Element): string =>
    el.getAttribute('aria-label') || el.getAttribute('name') || el.id || el.getAttribute('placeholder') || '';
  const record = (type: string, el: Element) => {
    const bound = (window as unknown as Record<string, ((a: unknown) => void) | undefined>)[bindingName];
    bound?.({ type, targetTag: el.tagName, targetName: targetName(el), at: new Date().toISOString() });
  };
  w.__cuaClick = (e: Event) => record('click', e.target as Element);
  // 'input' fires on every keystroke-equivalent value change, immediately -- 'change'
  // only fires on blur/commit, which a scripted fill() doesn't reliably trigger.
  w.__cuaInput = (e: Event) => record('input', e.target as Element);
  document.addEventListener('click', w.__cuaClick, true);
  document.addEventListener('input', w.__cuaInput, true);
}

function detachListeners(): void {
  const w = window as unknown as { __cuaClick?: (e: Event) => void; __cuaInput?: (e: Event) => void };
  if (w.__cuaClick) document.removeEventListener('click', w.__cuaClick, true);
  if (w.__cuaInput) document.removeEventListener('input', w.__cuaInput, true);
}

export interface HumanActionRecorder {
  begin(): Promise<void>;
  end(): Promise<HumanAction[]>;
}

export function createHumanActionRecorder(page: Page): HumanActionRecorder {
  let actions: HumanAction[] = [];
  let bound = false;

  async function ensureBound(): Promise<void> {
    if (bound) return;
    await page.exposeFunction(BINDING_NAME, (action: HumanAction) => {
      actions.push(action);
    });
    bound = true;
  }

  return {
    async begin(): Promise<void> {
      await ensureBound();
      actions = [];
      for (const frame of page.frames()) {
        await frame.evaluate(attachListeners, BINDING_NAME).catch(() => {});
      }
    },
    async end(): Promise<HumanAction[]> {
      for (const frame of page.frames()) {
        await frame.evaluate(detachListeners).catch(() => {});
      }
      return actions;
    },
  };
}
