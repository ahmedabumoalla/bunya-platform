export type UserDetailField = { label: string; value: string };
export type UserDetailSection = { title: string; fields: UserDetailField[] };
export type UserDetailSource = { key: string; label: string };
export type UserDetailOverview = {
  id: string; name: string; email: string | null; active: boolean;
  roles: { label: string; primary: boolean; revoked: boolean }[];
  sections: UserDetailSection[];
  documentSources: UserDetailSource[];
  recordSources: UserDetailSource[];
  canViewActivity: boolean; canImpersonate: boolean;
};
export type UserDetailItem = {
  id: string; title: string; subtitle?: string; status?: string;
  date: string; href?: string; fields?: UserDetailField[];
};
export type UserDetailPage = { items: UserDetailItem[]; total: number; page: number; pageSize: number };
