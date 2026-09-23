import React from "react";
import { registerNotificationServiceWorker } from "../push/registerServiceWorker";

const NotificationContext = React.createContext({
  addNotification: () => {},
  removeNotification: () => {},
  clearNotifications: () => {}
});

let globalListenerAttached = false;

function ToastContainer({ toasts, onDismiss }) {
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[1000] flex w-full max-w-sm flex-col gap-3 px-4 sm:px-0">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="pointer-events-auto overflow-hidden rounded-2xl border border-slate-200/80 bg-white/95 shadow-xl backdrop-blur-md"
        >
          <div className="flex items-start gap-3 px-4 py-3">
            <div className="mt-1 h-2.5 w-2.5 rounded-full bg-brand-green" />
            <div className="flex-1 text-sm text-slate-700">
              <div className="font-semibold text-slate-900">{toast.title || "Notification"}</div>
              {toast.body ? <p className="mt-1 text-[0.9rem] text-slate-600">{toast.body}</p> : null}
              {toast.actions?.length ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {toast.actions.map((action) => (
                    <button
                      key={action.label}
                      onClick={() => {
                        action.onClick?.();
                        onDismiss(toast.id);
                      }}
                      className="inline-flex items-center rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-brand-green transition hover:border-brand-green hover:bg-brand-green-soft"
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-transparent text-slate-400 transition hover:text-slate-600"
              aria-label="Dismiss notification"
            >
              <span aria-hidden="true">&times;</span>
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

export function NotificationProvider({ children }) {
  const [toasts, setToasts] = React.useState([]);
  const counterRef = React.useRef(0);
  const timersRef = React.useRef(new Map());

  const removeNotification = React.useCallback((id) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
    const timers = timersRef.current;
    if (timers.has(id)) {
      clearTimeout(timers.get(id));
      timers.delete(id);
    }
  }, []);

  const addNotification = React.useCallback(
    (input) => {
      const id = input?.id || `toast-${Date.now()}-${counterRef.current++}`;
      const toast = {
        id,
        title: input?.title || "LibReport Update",
        body: input?.body || "",
        actions: input?.actions || [],
        duration: typeof input?.duration === "number" ? input.duration : 9000
      };
      setToasts((prev) => [...prev.filter((item) => item.id !== id), toast]);
      if (toast.duration > 0) {
        const timers = timersRef.current;
        if (timers.has(id)) clearTimeout(timers.get(id));
        timers.set(
          id,
          setTimeout(() => {
            removeNotification(id);
          }, toast.duration)
        );
      }
      return id;
    },
    [removeNotification]
  );

  const clearNotifications = React.useCallback(() => {
    setToasts([]);
    timersRef.current.forEach((timeoutId) => clearTimeout(timeoutId));
    timersRef.current.clear();
  }, []);

  React.useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    registerNotificationServiceWorker().catch((err) => {
      console.error("Failed to register notification service worker:", err);
    });
  }, []);

  React.useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    if (globalListenerAttached) return;
    const handler = (event) => {
      const payload = event?.data?.payload;
      if (event?.data?.type !== "LIBREPORT_PUSH" || !payload) return;
      addNotification({
        id: payload?.tag,
        title: payload?.title,
        body: payload?.body,
        duration: 10000,
        actions:
          payload?.data?.url && typeof payload.data.url === "string"
            ? [
                {
                  label: "View",
                  onClick: () => {
                    try {
                      window.focus();
                    } catch (err) {
                      // ignore
                    }
                    window.location.href = payload.data.url;
                  }
                }
              ]
            : []
      });
    };
    navigator.serviceWorker.addEventListener("message", handler);
    globalListenerAttached = true;
    return () => {
      navigator.serviceWorker.removeEventListener("message", handler);
      globalListenerAttached = false;
    };
  }, [addNotification]);

  const contextValue = React.useMemo(
    () => ({
      addNotification,
      removeNotification,
      clearNotifications
    }),
    [addNotification, removeNotification, clearNotifications]
  );

  return (
    <NotificationContext.Provider value={contextValue}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={removeNotification} />
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  return React.useContext(NotificationContext);
}
