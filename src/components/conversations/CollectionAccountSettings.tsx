"use client";
import { useEffect, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import styles from "./ContractorConversations.module.css";

export function CollectionAccountSettings() {
  const [account, setAccount] = useState({ bank_name: "", beneficiary: "", iban: "" });
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  useEffect(() => { let active = true;void createClient().from("contractor_collection_account").select("bank_name,beneficiary,iban").maybeSingle().then(result => {
    if (!active) return;if (result.error) setNotice("تعذر تحميل حساب التحصيل.");else if (result.data) setAccount(result.data);setLoading(false);
  });return () => { active = false; }; }, []);
  const save = async (event: FormEvent) => {
    event.preventDefault();setBusy(true);setNotice("");
    try {
      const result = await createClient().rpc("configure_contractor_collection_account", { p_bank: account.bank_name, p_beneficiary: account.beneficiary, p_iban: account.iban });
      if (result.error) { setNotice(/Not authorized/.test(result.error.message) ? "تحتاج صلاحية إدارة المالية." : "تحقق من اسم البنك والمستفيد وصحة الآيبان السعودي.");return; }
      setNotice("حُفظ حساب التحصيل. يظهر لعملاء العروض المعتمدة.");
    } catch { setNotice("تعذر الاتصال؛ أعد المحاولة."); } finally { setBusy(false); }
  };
  return <details className={styles.history}><summary>إعداد حساب التحصيل للمنصة</summary><p>أضف الحساب البنكي الرسمي لبُنية. لا يظهر خيار التحويل قبل حفظ حساب صحيح.</p>{notice ? <p role="status">{notice}</p> : null}<form className={styles.quoteForm} onSubmit={save}><label>اسم البنك<input required maxLength={100} value={account.bank_name} onChange={e => setAccount(v => ({ ...v, bank_name: e.target.value }))}/></label><label>اسم المستفيد<input required maxLength={150} value={account.beneficiary} onChange={e => setAccount(v => ({ ...v, beneficiary: e.target.value }))}/></label><label className={styles.full}>الآيبان السعودي<input required dir="ltr" maxLength={35} value={account.iban} onChange={e => setAccount(v => ({ ...v, iban: e.target.value }))}/></label><label className={styles.check}><input type="checkbox" required />تحققت أن الحساب يخص المنصة وأن بياناته صحيحة.</label><button disabled={busy || loading}>{busy ? "جارٍ الحفظ…" : "حفظ حساب التحصيل"}</button></form></details>;
}
