export async function registerNotificationServiceWorker() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return null;
  }
  try {
    const registration = await navigator.serviceWorker.register("/notification-sw.js", {
      scope: "/"
    });
    return registration;
  } catch (err) {
    console.error("Notification service worker registration failed:", err);
    return null;
  }
}

