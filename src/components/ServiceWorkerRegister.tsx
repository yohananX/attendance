"use client";

import { useEffect } from "react";

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    const appCachePrefix = "gh-attendance-";

    if (process.env.NODE_ENV !== "production") {
      void navigator.serviceWorker.getRegistrations().then(async (registrations) => {
        const appRegistrations = registrations.filter((registration) =>
          [registration.active, registration.waiting, registration.installing]
            .some((worker) => worker?.scriptURL === new URL("/sw.js", window.location.href).href),
        );
        if (appRegistrations.length === 0) return;

        await Promise.all(appRegistrations.map((registration) => registration.unregister()));
        const cacheNames = await caches.keys();
        await Promise.all(
          cacheNames
            .filter((name) => name.startsWith(appCachePrefix))
            .map((name) => caches.delete(name)),
        );
        if (navigator.serviceWorker.controller) window.location.reload();
      }).catch((error: unknown) => {
        console.error("Could not remove the production service worker in development:", error);
      });
      return;
    }

    let hadController = Boolean(navigator.serviceWorker.controller);
    const handleControllerChange = () => {
      if (!hadController) {
        hadController = true;
        return;
      }
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);

    void navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" })
      .then((registration) => registration.update())
      .catch((error: unknown) => {
        console.error("Service worker registration or update failed:", error);
      });

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
    };
  }, []);
  return null;
}
