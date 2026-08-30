/**
 * Desktop browsers only: mobile cannot use getDisplayMedia (iOS Safari not at
 * all), so on unsupported platforms the button must never be shown.
 */
export function checkSupport(): { supported: boolean; reason?: string } {
  if (typeof window === "undefined") {
    return { supported: false, reason: "not a browser" };
  }
  if (!window.isSecureContext) {
    return { supported: false, reason: "requires a secure context (HTTPS)" };
  }
  if (!navigator.mediaDevices?.getDisplayMedia) {
    return { supported: false, reason: "getDisplayMedia not available" };
  }
  if (typeof MediaRecorder === "undefined") {
    return { supported: false, reason: "MediaRecorder not available" };
  }
  const ua = navigator.userAgent;
  const isMobile =
    /Android|iPhone|iPad|iPod|Mobile|Tablet/i.test(ua) ||
    // iPadOS 13+ masquerades as macOS but has touch
    (/(Macintosh)/.test(ua) && navigator.maxTouchPoints > 1);
  if (isMobile) {
    return { supported: false, reason: "mobile devices are not supported" };
  }
  return { supported: true };
}
