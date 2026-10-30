"use client";

import { useEffect } from "react";

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      if (process.env.NODE_ENV !== "production") {
        console.error("Service worker registration failed:", error);
      }
    });
  }, []);
  return null;
}
