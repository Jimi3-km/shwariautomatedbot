/**
 * Pop-ups from the browser itself, shown when the dashboard tab is in the
 * background. Inside the tab the dashboard draws its own pop-ups; this is only
 * for when nobody is looking at it.
 *
 * The browser asks the person for permission, once, and only after they press
 * a button. Nothing here is ever shown without that permission.
 */

export type DesktopAlertsState = 'on' | 'off' | 'blocked' | 'unsupported';

export function desktopAlertsState(): DesktopAlertsState {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'granted') return 'on';
  if (Notification.permission === 'denied') return 'blocked';
  return 'off';
}

/** Ask the browser for permission. Must be called from a click. */
export async function enableDesktopAlerts(): Promise<DesktopAlertsState> {
  if (desktopAlertsState() === 'unsupported') return 'unsupported';
  try {
    await Notification.requestPermission();
  } catch { /* an old browser that only takes a callback: read the result below */ }
  return desktopAlertsState();
}

/** Show one pop-up outside the tab. Does nothing without permission. */
export function showDesktopAlert(title: string, body: string, onClick?: () => void): void {
  if (desktopAlertsState() !== 'on') return;
  try {
    const n = new Notification(title, { body, tag: `shwari:${title}:${body}`.slice(0, 120) });
    n.onclick = () => {
      window.focus();
      onClick?.();
      n.close();
    };
  } catch { /* some mobile browsers only allow this from a service worker */ }
}
