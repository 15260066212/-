/**
 * Mouse interaction actions — clicks, moves, scrolling.
 *
 * Handles: click, mousedown, mouseup, mousemove, dblclick, rightclick, scroll
 */

import type { ActionContext } from './types.js';

// ─── Message Handler ──────────────────────────────────────────────────────────

/**
 * Handle mouse-related WebSocket messages.
 *
 * @returns `true` if the message was handled, `false` if it belongs to another domain
 */
export async function handleMouseActions(
  msgType: string,
  msg: any,
  ctx: ActionContext
): Promise<boolean> {
  const { page } = ctx;

  switch (msgType) {
    case 'click': {
      await page.mouse.move(msg.x, msg.y);
      await page.mouse.click(msg.x, msg.y, {
        button: msg.button || 'left',
        clickCount: msg.clickCount || 1,
        delay: 20,
      });
      // Smart focus: try to focus the input element at click position via JS
      if (msg.button === 'left' || !msg.button) {
        try {
          await page.evaluate(({ x, y }: { x: number; y: number }) => {
            function findInputElement(el: Element | null): HTMLElement | null {
              if (!el) return null;
              const tag = el.tagName?.toLowerCase();
              if (tag === 'input' || tag === 'textarea' || tag === 'select') return el as HTMLElement;
              if ((el as HTMLElement).isContentEditable) return el as HTMLElement;
              if (el.getAttribute && (el.getAttribute('contenteditable') === 'true' || el.getAttribute('contenteditable') === '')) return el as HTMLElement;
              // Shadow DOM
              const shadowRoot = (el as any).shadowRoot as ShadowRoot | undefined;
              if (shadowRoot) {
                const shadowEl = shadowRoot.elementFromPoint(x, y);
                if (shadowEl) {
                  const found = findInputElement(shadowEl as unknown as Element);
                  if (found) return found;
                }
              }
              // Closest
              const closest = el.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable=""]');
              if (closest) return closest as HTMLElement;
              // Children
              const children = el.querySelectorAll?.('input, textarea, select, [contenteditable="true"], [contenteditable=""]');
              if (children && children.length > 0) {
                for (const child of Array.from(children)) {
                  const rect = child.getBoundingClientRect();
                  if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
                    return child as HTMLElement;
                  }
                }
                return children[0] as HTMLElement;
              }
              return null;
            }

            const el = document.elementFromPoint(x, y);
            const inputEl = findInputElement(el);
            if (inputEl && typeof (inputEl as any).focus === 'function') {
              inputEl.focus({ preventScroll: false });
              if ((inputEl as HTMLElement).isContentEditable) {
                try {
                  const range = (document as any).caretRangeFromPoint?.(x, y);
                  if (range) {
                    const sel = window.getSelection();
                    sel?.removeAllRanges();
                    sel?.addRange(range);
                  }
                } catch (e) { /* ignore */ }
              }
              if (inputEl.tagName === 'INPUT' || inputEl.tagName === 'TEXTAREA') {
                try {
                  const len = (inputEl as HTMLInputElement).value?.length ?? 0;
                  if (typeof (inputEl as HTMLInputElement).setSelectionRange === 'function') {
                    (inputEl as HTMLInputElement).setSelectionRange(len, len);
                  }
                } catch (e) { /* ignore */ }
              }
            }
          }, { x: msg.x, y: msg.y });
        } catch (e) {
          console.log('[smart-focus] error:', (e as Error).message);
        }
      }
      return true;
    }

    case 'mousedown': {
      await page.mouse.move(msg.x, msg.y);
      await page.mouse.down({ button: msg.button || 'left' });
      return true;
    }

    case 'mouseup': {
      await page.mouse.move(msg.x, msg.y);
      await page.mouse.up({ button: msg.button || 'left' });
      return true;
    }

    case 'mousemove': {
      await page.mouse.move(msg.x, msg.y, { steps: 3 });
      return true;
    }

    case 'dblclick': {
      await page.mouse.dblclick(msg.x, msg.y);
      return true;
    }

    case 'rightclick': {
      await page.mouse.click(msg.x, msg.y, { button: 'right' });
      return true;
    }

    case 'scroll': {
      await page.mouse.move(msg.x, msg.y);
      await page.mouse.wheel(0, msg.deltaY ?? 0);
      return true;
    }

    default:
      return false;
  }
}
