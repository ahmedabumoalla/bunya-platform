const paths: Record<string, string> = {
  home: "m3 10 9-7 9 7M5 9v12h14V9M9 21v-8h6v8",
  users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  grid: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
  check: "m9 11 3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11",
  truck: "M1 3h14v13H1zM15 8h4l3 4v4h-7M9 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0M20 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0",
  document: "M14 2H6a2 2 0 0 0-2 2v16h16V8zM14 2v6h6M8 12h8M8 16h6",
  money: "M3 5h18v14H3zM16 12h2M6 12h2M14 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0",
  shield: "m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6zM9 12l2 2 4-4",
  bell: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4",
  search: "M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  settings: "M4 7h16M4 17h16M9 4v6M15 14v6",
  alert: "m12 3 10 18H2zM12 9v5M12 17v.1",
  star: "m12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z",
  flow: "M4 3h6v6H4zM14 15h6v6h-6zM7 9v9h7M10 6h7v9",
  support: "M3 14v-2a9 9 0 0 1 18 0v7h-5M3 12h4v7H3zM17 12h4M10 21h6",
  menu: "M4 6h16M4 12h16M4 18h16",
  close: "m6 6 12 12M6 18 18 6",
  arrow: "M19 12H5m6-6-6 6 6 6",
};
export function AdminIcon({ name, size = 20 }: { name: string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] ?? paths.document} /></svg>;
}
