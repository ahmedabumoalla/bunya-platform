import type { ReactNode } from "react";
import Link from "next/link";
import { navItems, platformName } from "@/lib/bunya-data";
import { ThemeToggle } from "./ThemeToggle";

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  const compactNav = navItems.filter((item) =>
    ["/", "/products", "/customer", "/contractors", "/subscriptions"].includes(item.href),
  );

  return (
    <main className="app-stage min-h-screen text-[var(--foreground)]">
      <header className="sticky top-0 z-50 border-b border-[var(--glass-border)] bg-white/75 shadow-[0_10px_40px_rgb(95_64_38/0.05)] backdrop-blur-2xl">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-4 xl:flex-row xl:items-center xl:justify-between">
          <Link href="/" className="group flex items-center gap-3">
            <span className="grid h-12 w-12 place-items-center rounded-lg bg-[#214536] text-2xl font-black text-white shadow-[0_16px_38px_rgb(33_69_54/0.16)] transition group-hover:-translate-y-1">
              ب
            </span>
            <span>
              <span className="block text-2xl font-black">{platformName}</span>
              <span className="block text-sm font-semibold text-[var(--muted)]">
                سوق توريد مواد البناء
              </span>
            </span>
          </Link>

          <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
            <nav className="flex gap-2 overflow-x-auto pb-1 xl:flex-wrap xl:justify-end xl:overflow-visible xl:pb-0">
              {compactNav.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="premium-button shrink-0 rounded-lg border border-transparent px-3 py-2 text-sm font-bold text-[var(--muted)] transition hover:border-[#214536]/15 hover:bg-[#edf5ec] hover:text-[#214536]"
                >
                  {item.label}
                </Link>
              ))}
            </nav>

            <div className="flex gap-2 overflow-x-auto pb-1 xl:overflow-visible xl:pb-0">
              <ThemeToggle />
              <Link
                href="/merchant"
                className="premium-button shrink-0 rounded-lg bg-[#214536] px-4 py-2 text-sm font-black text-white"
              >
                دخول التاجر
              </Link>
              <Link
                href="/admin"
                className="premium-button shrink-0 rounded-lg border border-[#b87342]/25 bg-white/70 px-4 py-2 text-sm font-black text-[#8f5f2e] shadow-sm backdrop-blur"
              >
                تجربة الأدمن
              </Link>
            </div>
          </div>
        </div>
      </header>

      {children}

      <footer className="border-t border-[var(--glass-border)] bg-white/60 px-5 py-8 text-[var(--foreground)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <p className="font-black">بُنية: منصة تشغيل لتوريد مواد البناء</p>
          <p className="max-w-2xl text-sm leading-6 text-[var(--muted)]">
            طلب المنتجات، تجميع العروض، اعتماد الأرخص المؤهل، والتسليم بكود
            المصافحة ضمن تجربة Mock منظمة لكل دور.
          </p>
        </div>
      </footer>
    </main>
  );
}
