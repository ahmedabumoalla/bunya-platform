"use client";

import {useEffect} from "react";

const legacyPwaStorageKeys = ["bunya-pwa-installed", "bunya-pwa-install-state", "bunya-pwa-last-role-route"];

export function LegacyPwaCleanup() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.getRegistrations().then((registrations) =>
        Promise.all(
          registrations
            .filter((registration) => registration.scope.startsWith(window.location.origin))
            .map((registration) => registration.unregister()),
        ),
      );
    }

    if ("caches" in window) {
      void caches.keys().then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((cacheName) => cacheName.startsWith("bunya-pwa-"))
            .map((cacheName) => caches.delete(cacheName)),
        ),
      );
    }

    for (const key of legacyPwaStorageKeys) window.localStorage.removeItem(key);
  }, []);

  return null;
}
