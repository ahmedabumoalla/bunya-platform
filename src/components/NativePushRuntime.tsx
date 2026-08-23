"use client";

import { useEffect } from "react";

export function NativePushRuntime() {
  useEffect(() => {
    let disposed = false;
    const handles: Array<{ remove: () => Promise<void> }> = [];
    const start = async () => {
      const preview = new URLSearchParams(window.location.search).get("app") === "1";
      if (preview) {
        document.documentElement.dataset.nativeApp = "preview";
      }
      const [{ Capacitor }, { PushNotifications }] = await Promise.all([
        import("@capacitor/core"),
        import("@capacitor/push-notifications"),
      ]);
      if (!Capacitor.isNativePlatform() || disposed) return;
      document.documentElement.dataset.nativeApp = Capacitor.getPlatform();
      const permission = await PushNotifications.checkPermissions();
      const granted = permission.receive === "granted" ? permission : await PushNotifications.requestPermissions();
      if (granted.receive !== "granted") return;
      handles.push(await PushNotifications.addListener("registration", async ({ value }) => {
        await fetch("/api/push/subscriptions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: value, platform: Capacitor.getPlatform() }),
        });
      }));
      handles.push(await PushNotifications.addListener("pushNotificationActionPerformed", ({ notification }) => {
        const url = typeof notification.data?.url === "string" ? notification.data.url : "/";
        window.location.assign(url.startsWith("/") ? url : "/");
      }));
      await PushNotifications.register();
    };
    void start().catch(() => undefined);
    return () => { disposed = true; void Promise.all(handles.map((handle) => handle.remove())); };
  }, []);
  return null;
}
