"use client";

import { useEffect } from "react";

type Theme = "light" | "dark";

function getInitialTheme(): Theme {
  if (typeof window === "undefined") {
    return "light";
  }

  return (window.localStorage.getItem("bunya-theme") as Theme | null) ?? "light";
}

export function ThemeToggle() {
  useEffect(() => {
    document.documentElement.dataset.theme = getInitialTheme();
  }, []);

  function toggleTheme() {
    const currentTheme = (document.documentElement.dataset.theme as Theme | undefined) ?? "light";
    const nextTheme = currentTheme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = nextTheme;
    window.localStorage.setItem("bunya-theme", nextTheme);
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="premium-button rounded-lg border border-[#214536]/15 bg-white/70 px-3 py-2 text-sm font-black text-[#214536] shadow-sm backdrop-blur"
      aria-label="تبديل الوضع الليلي والفاتح"
    >
      الوضع
    </button>
  );
}
