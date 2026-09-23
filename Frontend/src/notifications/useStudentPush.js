import React from "react";
import api from "../api";
import { registerNotificationServiceWorker } from "../push/registerServiceWorker";
import { useNotifications } from "./NotificationProvider";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function sendSubscriptionToServer(subscription) {
  const body = subscription.toJSON();
  body.userAgent = navigator.userAgent;
  await api.post("/student/notifications/subscribe", body);
}

async function ensureSubscription(registration, publicKey) {
  const existing = await registration.pushManager.getSubscription();
  if (existing) {
    await sendSubscriptionToServer(existing);
    return existing;
  }
  const convertedKey = urlBase64ToUint8Array(publicKey);
  const newSubscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: convertedKey
  });
  await sendSubscriptionToServer(newSubscription);
  return newSubscription;
}

export function useStudentPushNotifications(enabled) {
  const { addNotification } = useNotifications();
  const [status, setStatus] = React.useState({
    permission: typeof window !== "undefined" && "Notification" in window ? Notification.permission : "denied",
    subscribed: false,
    supported: typeof window !== "undefined" && "Notification" in window && "serviceWorker" in navigator,
    error: null
  });

  const requestPermissionAndSubscribe = React.useCallback(async () => {
    if (typeof window === "undefined") return false;
    if (!("Notification" in window)) return false;
    try {
      const permission = await Notification.requestPermission();
      setStatus((prev) => ({ ...prev, permission }));
      if (permission !== "granted") return false;
      const registration = await registerNotificationServiceWorker();
      if (!registration) return false;
      const { data } = await api.get("/student/notifications/public-key");
      if (!data?.enabled || !data?.publicKey) {
        console.warn("Push notifications are not enabled on the server.");
        setStatus((prev) => ({ ...prev, supported: false }));
        return false;
      }
      await ensureSubscription(registration, data.publicKey);
      setStatus({ permission, subscribed: true, supported: true, error: null });
      return true;
    } catch (err) {
      console.error("Failed to enable push notifications:", err);
      setStatus((prev) => ({ ...prev, supported: false, error: err?.message || "Push setup failed." }));
      return false;
    }
  }, []);

  React.useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined" || !("Notification" in window)) return;

    let cancelled = false;

    async function setup() {
      try {
        const permission = Notification.permission;
        setStatus((prev) => ({ ...prev, permission }));
        if (permission === "denied") return;

        const registration = await registerNotificationServiceWorker();
        if (!registration) return;

        const { data } = await api.get("/student/notifications/public-key");
        if (!data?.enabled || !data?.publicKey) {
          if (!cancelled) {
            setStatus((prev) => ({ ...prev, supported: false }));
          }
          return;
        }
        if (permission === "granted") {
          await ensureSubscription(registration, data.publicKey);
          if (!cancelled) {
            setStatus({ permission, subscribed: true, supported: true, error: null });
          }
        } else if (permission === "default") {
          addNotification({
            id: "enable-push",
            title: "Enable book alerts",
            body: "Turn on notifications to get pending, approved, overdue, and returned updates.",
            duration: 0,
            actions: [
              {
                label: "Enable",
                onClick: async () => {
                  const success = await requestPermissionAndSubscribe();
                  if (success) {
                    addNotification({
                      title: "Notifications enabled",
                      body: "You will now receive push alerts for your borrow status.",
                      duration: 5000
                    });
                  }
                }
              }
            ]
          });
        }
      } catch (err) {
        console.error("Failed to initialise push notifications:", err);
        if (!cancelled) {
          setStatus((prev) => ({ ...prev, supported: false, error: err?.message || "Push setup failed." }));
        }
      }
    }

    setup();

    return () => {
      cancelled = true;
    };
  }, [addNotification, enabled, requestPermissionAndSubscribe]);

  return {
    ...status,
    requestPermissionAndSubscribe
  };
}
