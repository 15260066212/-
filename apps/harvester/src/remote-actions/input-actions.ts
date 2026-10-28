/**
 * Keyboard and input actions — typing, pasting, filling inputs via JS injection.
 *
 * Handles: keydown, keyup, typeText, pasteText, fillInputAt
 */

import { INPUT_HELPERS_JS, type ActionContext } from './types.js';

// ─── Message Handler ──────────────────────────────────────────────────────────

/**
 * Handle keyboard/input-related WebSocket messages.
 *
 * @returns `true` if the message was handled, `false` if it belongs to another domain
 */
export async function handleInputActions(
  msgType: string,
  msg: any,
  ctx: ActionContext
): Promise<boolean> {
  const { page } = ctx;

  switch (msgType) {
    case 'keydown': {
      // Smart keyboard: inject characters via JS when input is focused
      try {
        const handled = await page.evaluate(([helper, key]: [string, string]) => {
          eval(helper);
          const el = document.activeElement as HTMLElement | null;
          if (!el) return false;
          const isInput = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
          const isEditable = el.isContentEditable;
          if (!isInput && !isEditable) return false;

          if (key.length === 1) {
            if (isInput) {
              const input = el as HTMLInputElement | HTMLTextAreaElement;
              const start = input.selectionStart ?? input.value.length;
              const end = input.selectionEnd ?? input.value.length;
              const newValue = input.value.slice(0, start) + key + input.value.slice(end);
              __setInputVal(input, newValue);
              input.selectionStart = input.selectionEnd = start + key.length;
            } else {
              document.execCommand('insertText', false, key);
              el.dispatchEvent(new Event('input', { bubbles: true }));
            }
            return true;
          }

          switch (key) {
            case 'Backspace': {
              if (isInput) {
                const input = el as HTMLInputElement | HTMLTextAreaElement;
                const result = __deleteBackwards(input);
                // Always return true — key was handled
                void result;
              } else {
                document.execCommand('delete', false);
                el.dispatchEvent(new Event('input', { bubbles: true }));
              }
              return true;
            }
            case 'Enter':
              if (isInput && el.tagName === 'INPUT') {
                el.dispatchEvent(new Event('change', { bubbles: true }));
                el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
              } else {
                document.execCommand('insertLineBreak', false);
                el.dispatchEvent(new Event('input', { bubbles: true }));
              }
              return true;
            default:
              return false;
          }
        }, [INPUT_HELPERS_JS, msg.key]);

        if (!handled) await page.keyboard.down(msg.key);
      } catch {
        await page.keyboard.down(msg.key);
      }
      return true;
    }

    case 'keyup': {
      try {
        const handled = await page.evaluate((key: string) => {
          const el = document.activeElement as HTMLElement | null;
          if (!el) return false;
          const isInput = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
          const isEditable = el.isContentEditable;
          if (!isInput && !isEditable) return false;
          if (key.length === 1 || ['Backspace', 'Enter'].includes(key)) return true;
          return false;
        }, msg.key);

        if (!handled) await page.keyboard.up(msg.key);
      } catch {
        await page.keyboard.up(msg.key);
      }
      return true;
    }

    case 'typeText': {
      // Batch text input - much faster for captcha, passwords, etc.
      if (msg.text) {
        await page.keyboard.type(msg.text, { delay: msg.delay || 0 });
      }
      return true;
    }

    case 'pasteText': {
      // Paste text via clipboard simulation
      if (msg.text) {
        await page.evaluate(([helper, text]: [string, string]) => {
          eval(helper);
          const el = document.activeElement as HTMLElement | null;
          if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) {
            const inputEl = el as HTMLInputElement | HTMLTextAreaElement;
            const start = inputEl.selectionStart ?? 0;
            const end = inputEl.selectionEnd ?? 0;
            const value = inputEl.value ?? (el as HTMLElement).textContent ?? '';
            const newValue = value.slice(0, start) + text + value.slice(end);
            if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
              __setInputVal(inputEl, newValue);
              inputEl.selectionStart = inputEl.selectionEnd = start + text.length;
            } else {
              (el as HTMLElement).textContent = newValue;
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }
        }, [INPUT_HELPERS_JS, msg.text]);
      }
      return true;
    }

    case 'fillInputAt': {
      // Fill the input element at (x, y) with text using JS — more reliable
      // than keyboard simulation for framework-driven inputs (Vue/React)
      // and virtual keyboards
      const { x, y, text } = msg;
      await page.evaluate(({ helper, x, y, text }) => {
        eval(helper);
        const el = document.elementFromPoint(x, y) as HTMLElement | null;
        if (!el) return false;
        // Try to find the actual input element (might be wrapped in a container)
        let inputEl = el.closest('input, textarea, [contenteditable="true"]') as HTMLElement | null;
        if (!inputEl) {
          // Check children
          const childInput = el.querySelector('input, textarea, [contenteditable="true"]');
          if (childInput) inputEl = childInput as HTMLElement;
        }
        if (!inputEl) return false;

        const tag = inputEl.tagName.toLowerCase();
        if (tag === 'input' || tag === 'textarea') {
          const htmlEl = inputEl as HTMLInputElement | HTMLTextAreaElement;
          // Focus first
          htmlEl.focus();
          // Select all existing text
          htmlEl.select();
          // Set value via shared helper to trigger framework reactivity
          __setInputVal(htmlEl, text);
          // Trigger additional events
          htmlEl.dispatchEvent(new Event('blur', { bubbles: true }));
          return true;
        }
        if (inputEl.isContentEditable) {
          inputEl.focus();
          // Clear existing content and insert new text
          document.execCommand('selectAll', false);
          document.execCommand('insertText', false, text);
          inputEl.dispatchEvent(new Event('input', { bubbles: true }));
          inputEl.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }
        return false;
      }, { helper: INPUT_HELPERS_JS, x, y, text });
      return true;
    }

    default:
      return false;
  }
}
