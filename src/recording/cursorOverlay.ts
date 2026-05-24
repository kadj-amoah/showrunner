import type { BrowserContext, Page } from 'playwright-core';

const CURSOR_INIT_SCRIPT = `
(() => {
  if (window.__showrunnerCursorInstalled) return;
  console.log('[showrunner-cursor] boot');

  const tryInstall = () => {
    if (window.__showrunnerCursorInstalled) return true;
    if (!document.body || !document.head) return false;

    const style = document.createElement('style');
    style.textContent = \`
      @keyframes sr-cursor-pulse-kf {
        0%   { transform: scale(1);   opacity: 0.9; }
        100% { transform: scale(2.6); opacity: 0;   }
      }
      #showrunner-cursor {
        position: fixed !important;
        left: 50vw;
        top:  50vh;
        width: 28px !important;
        height: 28px !important;
        margin-left: -14px !important;
        margin-top:  -14px !important;
        pointer-events: none !important;
        z-index: 2147483647 !important;
        transition: left 240ms cubic-bezier(0.42, 0, 0.58, 1),
                    top  240ms cubic-bezier(0.42, 0, 0.58, 1);
        display: block !important;
        opacity: 1 !important;
        visibility: visible !important;
      }
      #showrunner-cursor .sr-cursor-dot {
        width: 28px !important;
        height: 28px !important;
        border-radius: 50% !important;
        background: rgba(255, 60, 60, 0.85) !important;
        box-shadow: 0 0 0 3px rgba(255, 60, 60, 1),
                    0 0 0 6px rgba(255, 255, 255, 0.6),
                    0 4px 18px rgba(0, 0, 0, 0.45) !important;
      }
      #showrunner-cursor .sr-cursor-ring {
        position: absolute !important;
        inset: 0 !important;
        border-radius: 50% !important;
        border: 4px solid rgba(255, 60, 60, 0.9) !important;
        opacity: 0;
        pointer-events: none !important;
      }
      #showrunner-cursor.sr-cursor-pulse .sr-cursor-ring {
        animation: sr-cursor-pulse-kf 420ms ease-out;
      }
    \`;
    document.head.appendChild(style);

    const cursor = document.createElement('div');
    cursor.id = 'showrunner-cursor';
    const dot = document.createElement('div');
    dot.className = 'sr-cursor-dot';
    const ring = document.createElement('div');
    ring.className = 'sr-cursor-ring';
    cursor.appendChild(dot);
    cursor.appendChild(ring);
    document.body.appendChild(cursor);

    window.__showrunnerCursorInstalled = true;
    console.log('[showrunner-cursor] mounted');
    return true;
  };

  if (tryInstall()) return;

  console.log('[showrunner-cursor] deferring â€” body not ready');

  const tick = () => { if (tryInstall()) cleanup(); };
  const observer = new MutationObserver(tick);
  const target = document.documentElement || document;
  observer.observe(target, { childList: true, subtree: true });
  const interval = setInterval(tick, 50);
  const onReady = () => tick();
  document.addEventListener('DOMContentLoaded', onReady);
  document.addEventListener('readystatechange', onReady);
  const cleanup = () => {
    observer.disconnect();
    clearInterval(interval);
    document.removeEventListener('DOMContentLoaded', onReady);
    document.removeEventListener('readystatechange', onReady);
  };
})();
`;

export async function installCursorOverlay(context: BrowserContext): Promise<void> {
  await context.addInitScript(CURSOR_INIT_SCRIPT);
}

export async function ensureCursorInstalled(page: Page): Promise<void> {
  try {
    await page.evaluate(CURSOR_INIT_SCRIPT);
  } catch {
    // best effort
  }
}

export async function verifyCursorMounted(page: Page): Promise<boolean> {
  try {
    return await page.evaluate(() => {
      const doc = (globalThis as unknown as { document?: { getElementById: (id: string) => unknown } })
        .document;
      return Boolean(doc && doc.getElementById('showrunner-cursor'));
    });
  } catch {
    return false;
  }
}

interface CursorElement {
  style: { left: string; top: string };
  classList: { add: (c: string) => void; remove: (c: string) => void };
  offsetWidth: number;
}
interface CursorDoc {
  getElementById: (id: string) => CursorElement | null;
}

interface CursorElementWithTransition extends CursorElement {
  style: { left: string; top: string; transition: string };
}
interface CursorDocWithTransition {
  getElementById: (id: string) => CursorElementWithTransition | null;
}

// easeInOutCubic: pronounced ease at both ends, fast through the middle.
// cubic-bezier(0.42, 0, 0.58, 1) â€” much more dramatic than Material's standard curve.
const CURSOR_EASE = 'cubic-bezier(0.42, 0, 0.58, 1)';

export async function moveCursor(
  page: Page,
  x: number,
  y: number,
  motionMs?: number,
): Promise<void> {
  try {
    await page.evaluate(
      ({ x: cx, y: cy, ms, ease }) => {
        const doc = (globalThis as unknown as { document?: CursorDocWithTransition }).document;
        const el = doc?.getElementById('showrunner-cursor');
        if (!el) return;
        const duration = typeof ms === 'number' && ms > 0 ? ms : 240;
        el.style.transition = `left ${duration}ms ${ease}, top ${duration}ms ${ease}`;
        el.style.left = cx + 'px';
        el.style.top = cy + 'px';
      },
      { x, y, ms: motionMs, ease: CURSOR_EASE },
    );
  } catch {
    // page closed or eval failed â€” cursor is best-effort
  }
}

export async function pulseCursor(page: Page): Promise<void> {
  try {
    await page.evaluate(() => {
      const doc = (globalThis as unknown as { document?: CursorDoc }).document;
      const el = doc?.getElementById('showrunner-cursor');
      if (el) {
        el.classList.remove('sr-cursor-pulse');
        void el.offsetWidth;
        el.classList.add('sr-cursor-pulse');
      }
    });
  } catch {
    // ignore
  }
}
