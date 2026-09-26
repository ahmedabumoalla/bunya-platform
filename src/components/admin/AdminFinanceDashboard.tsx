/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import styles from "./AdminFinanceDashboard.module.css";

type ProviderFinanceRow = {
  provider_id: string;
  company_name: string;
  provider_status: string;
  commission_rate: number;
  transaction_count: number;
  gross_amount: number;
  bunya_commission: number;
  net_earned: number;
  paid_out: number;
  reserved_for_settlement: number;
  current_balance: number;
  available_balance: number;
  last_transaction_at: string | null;
};

const db = createClient();
const currency = new Intl.NumberFormat("ar-SA", {
  style: "currency",
  currency: "SAR",
  minimumFractionDigits: 2,
});
const number = new Intl.NumberFormat("ar-SA");

function money(value: number) {
  return currency.format(Number(value || 0));
}

export function AdminFinanceDashboard() {
  const [rows, setRows] = useState<ProviderFinanceRow[]>([]);
  const [rates, setRates] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const result = await db.rpc("admin_provider_financial_summary");
    if (result.error) {
      setError(result.error.message);
      setRows([]);
    } else {
      const next = (result.data ?? []) as ProviderFinanceRow[];
      setRows(next);
      setRates(
        Object.fromEntries(
          next.map((row) => [row.provider_id, String(row.commission_rate)]),
        ),
      );
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (sum, row) => ({
          gross: sum.gross + Number(row.gross_amount),
          profit: sum.profit + Number(row.bunya_commission),
          balance: sum.balance + Number(row.current_balance),
          available: sum.available + Number(row.available_balance),
          transactions: sum.transactions + Number(row.transaction_count),
        }),
        { gross: 0, profit: 0, balance: 0, available: 0, transactions: 0 },
      ),
    [rows],
  );

  const visibleRows = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ar");
    return normalized
      ? rows.filter((row) =>
          row.company_name.toLocaleLowerCase("ar").includes(normalized),
        )
      : rows;
  }, [query, rows]);

  const saveRate = async (row: ProviderFinanceRow) => {
    const nextRate = Number(rates[row.provider_id]);
    if (!rates[row.provider_id]?.trim() || !Number.isFinite(nextRate) || nextRate < 0 || nextRate > 100) {
      setError("نسبة الربح المضافة يجب أن تكون بين 0 و100٪.");
      return;
    }
    setSaving(row.provider_id);
    setError("");
    setMessage("");
    const result = await db.rpc("admin_set_provider_commission", {
      p_provider_id: row.provider_id,
      p_rate: nextRate,
    });
    if (result.error) {
      setError(result.error.message);
    } else {
      setMessage(`تم اعتماد إضافة ${Number(result.data).toFixed(2)}٪ فوق سعر ${row.company_name} للعروض الجديدة. العروض الصادرة سابقًا تحتفظ بأسعارها.`);
      await load();
    }
    setSaving(null);
  };

  return (
    <main className={styles.page} dir="rtl">
      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>دفتر بُنية المالي</p>
          <h1>المالية والأرباح</h1>
          <p>
            تُضاف نسبة ربح بُنية فوق سعر كل مزود عند إعداد عرض العميل، ويحتفظ المزود بكامل سعره.
            تُثبّت النسبة مع العرض وتُسجّل المستحقات عند الدفع.
          </p>
        </div>
        <div className={styles.heroProfit}>
          <span>إجمالي أرباح بُنية</span>
          <strong>{loading ? "…" : error ? "غير متاح" : money(totals.profit)}</strong>
          <small>{loading ? "…" : error ? "—" : number.format(totals.transactions)} عملية مدفوعة</small>
        </div>
      </section>

      <section className={styles.summary} aria-label="ملخص المركز المالي">
        <article>
          <span>قيمة توريد المزودين</span>
          <strong>{loading ? "…" : error ? "غير متاح" : money(totals.gross)}</strong>
          <small>قيمة التوريد المسجلة للعمليات المدفوعة</small>
        </article>
        <article>
          <span>أرباح بُنية</span>
          <strong>{loading ? "…" : error ? "غير متاح" : money(totals.profit)}</strong>
          <small>ربح العروض الجديدة لا يشمل ضريبة الزيادة</small>
        </article>
        <article>
          <span>أرصدة المزودين لدينا</span>
          <strong>{loading ? "…" : error ? "غير متاح" : money(totals.balance)}</strong>
          <small>المستحقات المتبقية بعد الصرف</small>
        </article>
        <article>
          <span>المتاح للصرف</span>
          <strong>{loading ? "…" : error ? "غير متاح" : money(totals.available)}</strong>
          <small>بعد حجز طلبات التسوية</small>
        </article>
      </section>

      {error ? <div role="alert" className={styles.error}>{error}</div> : null}
      {message ? <div role="status" className={styles.success}>{message}</div> : null}

      <section className={styles.ledger}>
        <header className={styles.ledgerHeader}>
          <div>
            <p>حسابات المزودين</p>
            <h2>الرصيد ونسبة الربح لكل مزود</h2>
            <small>مثال: سعر المزود 10 ر.س. + نسبة 10٪ = سعر العميل 11 ر.س. بنفس أساس الضريبة. رسوم التوصيل مستقلة.</small>
          </div>
          <div className={styles.tools}>
            <label>
              <span>بحث</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="اسم المزود"
              />
            </label>
            <button type="button" onClick={() => void load()} disabled={loading}>
              تحديث
            </button>
          </div>
        </header>

        {loading ? (
          <div className={styles.state}>جاري تحميل السجل المالي…</div>
        ) : visibleRows.length ? (
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>المزود</th>
                  <th>العمليات</th>
                  <th>إجمالي التوريد</th>
                  <th>أرباح بُنية</th>
                  <th>صافي المزود</th>
                  <th>الرصيد لدينا</th>
                  <th>نسبة الربح المضافة</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr key={row.provider_id}>
                    <td>
                      <strong>{row.company_name}</strong>
                      <small>
                        {row.provider_status === "approved" ? "مزود معتمد" : row.provider_status}
                        {row.last_transaction_at
                          ? ` · آخر عملية ${new Date(row.last_transaction_at).toLocaleDateString("ar-SA")}`
                          : " · لا توجد عمليات بعد"}
                      </small>
                    </td>
                    <td>{number.format(row.transaction_count)}</td>
                    <td>{money(row.gross_amount)}</td>
                    <td className={styles.profit}>{money(row.bunya_commission)}</td>
                    <td>{money(row.net_earned)}</td>
                    <td>
                      <strong>{money(row.current_balance)}</strong>
                      {Number(row.reserved_for_settlement) > 0 ? (
                        <small>محجوز {money(row.reserved_for_settlement)}</small>
                      ) : (
                        <small>متاح {money(row.available_balance)}</small>
                      )}
                    </td>
                    <td>
                      <div className={styles.rateControl}>
                        <label>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="0.01"
                            inputMode="decimal"
                            value={rates[row.provider_id] ?? "0"}
                            onChange={(event) =>
                              setRates((current) => ({
                                ...current,
                                [row.provider_id]: event.target.value,
                              }))
                            }
                            aria-label={`نسبة الربح المضافة فوق سعر ${row.company_name}`}
                          />
                          <span>٪</span>
                        </label>
                        <button
                          type="button"
                          onClick={() => void saveRate(row)}
                          disabled={saving !== null}
                        >
                          {saving === row.provider_id ? "حفظ…" : "اعتماد"}
                        </button>
                      </div>
                      <small>تُضاف فوق سعر المزود للعروض الجديدة</small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className={styles.state}>لا يوجد مزود مطابق للبحث.</div>
        )}
      </section>
    </main>
  );
}
