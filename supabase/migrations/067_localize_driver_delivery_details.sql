-- Localize structured delivery details and the reviewed values used by the
-- current delivery journey. Both web and Flutter consume this trusted RPC.

create or replace function public.localize_operational_value(
  p_value text,
  p_locale text
)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_locale text := lower(coalesce(nullif(trim(p_locale), ''), 'ar'));
  v_key text := regexp_replace(trim(coalesce(p_value, '')), '\s+', ' ', 'g');
  v_translation text;
  v_translations constant jsonb := $json$
  {
    "تجربة العميل": {
      "en": "Test Customer",
      "ur": "آزمائشی گاہک",
      "hi": "परीक्षण ग्राहक",
      "bn": "পরীক্ষামূলক গ্রাহক",
      "fil": "Test Customer"
    },
    "7ص الى 4 م": {
      "en": "7 AM to 4 PM",
      "ur": "صبح 7 بجے سے شام 4 بجے تک",
      "hi": "सुबह 7 बजे से शाम 4 बजे तक",
      "bn": "সকাল ৭টা থেকে বিকেল ৪টা পর্যন্ত",
      "fil": "7 AM hanggang 4 PM"
    },
    "التحميل ضمن مسؤولية المزود": {
      "en": "Loading is the provider's responsibility",
      "ur": "لوڈنگ فراہم کنندہ کی ذمہ داری ہے",
      "hi": "लोडिंग प्रदाता की जिम्मेदारी है",
      "bn": "লোডিং সরবরাহকারীর দায়িত্ব",
      "fil": "Responsibilidad ng provider ang loading"
    },
    "العميل يوفّر معدات التحميل": {
      "en": "Customer provides loading equipment",
      "ur": "گاہک لوڈنگ کا سامان فراہم کرتا ہے",
      "hi": "ग्राहक लोडिंग उपकरण उपलब्ध कराता है",
      "bn": "গ্রাহক লোডিং সরঞ্জাম সরবরাহ করেন",
      "fil": "Customer ang nagbibigay ng loading equipment"
    },
    "يلزم تنسيق رافعة أو فوركلفت": {
      "en": "A crane or forklift must be arranged",
      "ur": "کرین یا فورک لفٹ کا انتظام ضروری ہے",
      "hi": "क्रेन या फोर्कलिफ्ट की व्यवस्था करनी होगी",
      "bn": "ক্রেন বা ফর্কলিফটের ব্যবস্থা করতে হবে",
      "fil": "Kailangang mag-ayos ng crane o forklift"
    },
    "العميل يوفّر عمال التنزيل": {
      "en": "Customer provides unloading workers",
      "ur": "گاہک سامان اتارنے کے کارکن فراہم کرتا ہے",
      "hi": "ग्राहक सामान उतारने के लिए श्रमिक उपलब्ध कराता है",
      "bn": "গ্রাহক মাল নামানোর শ্রমিক সরবরাহ করেন",
      "fil": "Customer ang nagbibigay ng mga tauhan sa unloading"
    },
    "العميل يوفّر رافعة أو فوركلفت": {
      "en": "Customer provides a crane or forklift",
      "ur": "گاہک کرین یا فورک لفٹ فراہم کرتا ہے",
      "hi": "ग्राहक क्रेन या फोर्कलिफ्ट उपलब्ध कराता है",
      "bn": "গ্রাহক ক্রেন বা ফর্কলিফট সরবরাহ করেন",
      "fil": "Customer ang nagbibigay ng crane o forklift"
    },
    "مطلوب تضمين التنزيل في العرض": {
      "en": "Include unloading in the quote",
      "ur": "سامان اتارنے کی لاگت پیشکش میں شامل کریں",
      "hi": "सामान उतारने की लागत प्रस्ताव में शामिल करें",
      "bn": "মূল্য প্রস্তাবে মাল নামানোর খরচ অন্তর্ভুক্ত করুন",
      "fil": "Isama ang unloading sa quote"
    },
    "لا يلزم تنزيل - استلام مباشر": {
      "en": "No unloading required — direct pickup",
      "ur": "سامان اتارنے کی ضرورت نہیں — براہِ راست وصولی",
      "hi": "सामान उतारना आवश्यक नहीं — सीधे प्राप्ति",
      "bn": "মাল নামানোর প্রয়োজন নেই — সরাসরি সংগ্রহ",
      "fil": "Hindi kailangan ng unloading — direct pickup"
    },
    "سهل ومناسب للشاحنات الكبيرة": {
      "en": "Easy access and suitable for large trucks",
      "ur": "آسان رسائی اور بڑے ٹرکوں کے لیے موزوں",
      "hi": "आसान पहुँच और बड़े ट्रकों के लिए उपयुक्त",
      "bn": "সহজ প্রবেশ এবং বড় ট্রাকের জন্য উপযোগী",
      "fil": "Madaling daanan at angkop sa malalaking truck"
    },
    "مناسب للشاحنات الصغيرة فقط": {
      "en": "Suitable for small trucks only",
      "ur": "صرف چھوٹے ٹرکوں کے لیے موزوں",
      "hi": "केवल छोटे ट्रकों के लिए उपयुक्त",
      "bn": "শুধু ছোট ট্রাকের জন্য উপযোগী",
      "fil": "Para lamang sa maliliit na truck"
    },
    "دخول مقيد ويحتاج تنسيقًا مسبقًا": {
      "en": "Restricted entry; advance coordination is required",
      "ur": "داخلہ محدود ہے؛ پیشگی رابطہ ضروری ہے",
      "hi": "प्रवेश सीमित है; पहले से समन्वय आवश्यक है",
      "bn": "প্রবেশ সীমিত; আগাম সমন্বয় প্রয়োজন",
      "fil": "Limitado ang pasukan; kailangan ng paunang koordinasyon"
    },
    "طريق غير ممهد أو تحت الإنشاء": {
      "en": "Unpaved road or road under construction",
      "ur": "کچی سڑک یا زیرِ تعمیر راستہ",
      "hi": "कच्ची सड़क या निर्माणाधीन रास्ता",
      "bn": "কাঁচা রাস্তা বা নির্মাণাধীন পথ",
      "fil": "Hindi sementadong daan o daang ginagawa pa"
    },
    "لا يوجد": {
      "en": "None",
      "ur": "کوئی نہیں",
      "hi": "कोई नहीं",
      "bn": "কিছু নেই",
      "fil": "Wala"
    },
    "مسجد صغير": {
      "en": "Small mosque",
      "ur": "چھوٹی مسجد",
      "hi": "छोटी मस्जिद",
      "bn": "ছোট মসজিদ",
      "fil": "Maliit na mosque"
    }
  }
  $json$::jsonb;
begin
  if p_value is null or v_key = '' or v_locale = 'ar' then
    return p_value;
  end if;

  v_key := replace(v_key, 'إلى', 'الى');
  if v_key ~ '^(من\s*)?7\s*ص\s*الى\s*4\s*م$' then
    v_key := '7ص الى 4 م';
  end if;

  v_translation := v_translations -> v_key ->> v_locale;
  return coalesce(nullif(v_translation, ''), p_value);
end;
$$;

revoke all on function public.localize_operational_value(text, text)
  from public, anon, authenticated;

create or replace function public.get_my_driver_deliveries()
returns table (
  delivery_id uuid,
  order_id uuid,
  order_code text,
  fulfillment_code text,
  delivery_status public.provider_delivery_status,
  expected_at timestamptz,
  delivered_at timestamptz,
  google_maps_url text,
  location_hint text,
  recipient_name text,
  recipient_mobile text,
  site_responsible_name text,
  site_responsible_mobile text,
  working_hours text,
  loading_option text,
  unloading_option text,
  road_access text,
  access_instructions text,
  can_confirm boolean,
  items jsonb
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    a.id,
    o.id,
    o.order_code,
    f.fulfillment_code,
    a.status,
    a.expected_at,
    a.delivered_at,
    r.google_maps_url,
    public.localize_operational_value(r.location_hint, profile.preferred_locale),
    public.localize_operational_value(r.recipient_name, profile.preferred_locale),
    r.recipient_mobile,
    public.localize_operational_value(r.site_responsible_name, profile.preferred_locale),
    r.site_responsible_mobile,
    public.localize_operational_value(r.working_hours, profile.preferred_locale),
    public.localize_operational_value(r.loading_option, profile.preferred_locale),
    public.localize_operational_value(r.unloading_option, profile.preferred_locale),
    public.localize_operational_value(r.road_access, profile.preferred_locale),
    public.localize_operational_value(r.access_instructions, profile.preferred_locale),
    (
      a.status = 'arrived'
      and c.verified_at is null
      and c.expires_at > now()
      and c.attempts < c.max_attempts
      and coalesce(c.locked_until, '-infinity'::timestamptz) <= now()
    ),
    coalesce(lines.items, '[]'::jsonb)
  from public.provider_delivery_assignments a
  join public.orders o on o.id = a.order_id
  join public.internal_fulfillment_orders f on f.id = a.fulfillment_order_id
  join public.bunya_customer_quotes q on q.id = o.customer_quote_id
  join public.quote_requests r on r.id = q.customer_request_id
  join public.profiles profile on profile.id = auth.uid()
  left join public.delivery_confirmation_codes c on c.assignment_id = a.id
  left join lateral (
    select jsonb_agg(
      jsonb_build_object(
        'product_name', public.localize_snapshot(
          i.product_name_snapshot,
          i.product_name_translations,
          profile.preferred_locale
        ),
        'quantity', i.quantity,
        'unit_name', public.localize_snapshot(
          i.unit_name_snapshot,
          i.unit_name_translations,
          profile.preferred_locale
        ),
        'measurement', public.localize_snapshot(
          i.measurement_snapshot,
          i.measurement_label_translations,
          profile.preferred_locale
        )
      )
      order by i.id
    ) as items
    from public.order_items i
    where i.order_id = o.id
  ) lines on true
  where a.assigned_driver_id = public.current_provider_driver_id()
    and exists (
      select 1
      from public.provider_drivers d
      where d.id = a.assigned_driver_id
        and d.status = 'active'
    )
  order by
    case when a.status in ('delivered', 'failed_delivery') then 1 else 0 end,
    a.expected_at;
$$;

revoke all on function public.get_my_driver_deliveries()
  from public, anon;
grant execute on function public.get_my_driver_deliveries()
  to authenticated;

comment on function public.localize_operational_value(text, text) is
  'Reviewed translations for structured delivery values and explicitly approved legacy values.';
