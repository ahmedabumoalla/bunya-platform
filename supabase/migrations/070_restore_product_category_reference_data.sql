-- Product categories are platform reference data required by provider onboarding
-- and the storefront. Keep this seed idempotent so an empty catalog can be
-- repaired without restoring any user, product, or transactional data.
insert into public.product_categories (name, slug, sort_order, is_active)
values
  ('الأسمنت', 'cement', 10, true),
  ('الحديد', 'steel', 20, true),
  ('البلك والطوب', 'blocks-bricks', 30, true),
  ('العزل', 'insulation', 40, true),
  ('السباكة', 'plumbing', 50, true),
  ('الكهرباء', 'electrical', 60, true),
  ('الأخشاب', 'wood', 70, true),
  ('الدهانات', 'paint', 80, true),
  ('الأدوات والمعدات', 'tools-equipment', 90, true)
on conflict (slug) do update
set name = excluded.name,
    sort_order = excluded.sort_order,
    is_active = true;

insert into public.product_category_translations (
  category_id,
  locale,
  name,
  reviewed_at
)
select category.id, translation.locale, translation.name, now()
from (
  values
    ('cement', 'en', 'Cement'),
    ('cement', 'ur', 'سیمنٹ'),
    ('cement', 'hi', 'सीमेंट'),
    ('cement', 'bn', 'সিমেন্ট'),
    ('cement', 'fil', 'Semento'),
    ('steel', 'en', 'Steel'),
    ('steel', 'ur', 'اسٹیل'),
    ('steel', 'hi', 'स्टील'),
    ('steel', 'bn', 'ইস্পাত'),
    ('steel', 'fil', 'Bakal'),
    ('blocks-bricks', 'en', 'Blocks and Bricks'),
    ('blocks-bricks', 'ur', 'بلاکس اور اینٹیں'),
    ('blocks-bricks', 'hi', 'ब्लॉक और ईंटें'),
    ('blocks-bricks', 'bn', 'ব্লক ও ইট'),
    ('blocks-bricks', 'fil', 'Mga Bloke at Ladrilyo'),
    ('insulation', 'en', 'Insulation'),
    ('insulation', 'ur', 'موصلیت'),
    ('insulation', 'hi', 'इन्सुलेशन'),
    ('insulation', 'bn', 'নিরোধক'),
    ('insulation', 'fil', 'Insulasyon'),
    ('plumbing', 'en', 'Plumbing'),
    ('plumbing', 'ur', 'پلمبنگ'),
    ('plumbing', 'hi', 'प्लंबिंग'),
    ('plumbing', 'bn', 'প্লাম্বিং'),
    ('plumbing', 'fil', 'Pagtutubero'),
    ('electrical', 'en', 'Electrical'),
    ('electrical', 'ur', 'بجلی'),
    ('electrical', 'hi', 'विद्युत'),
    ('electrical', 'bn', 'বৈদ্যুতিক'),
    ('electrical', 'fil', 'Elektrikal'),
    ('wood', 'en', 'Timber and Wood'),
    ('wood', 'ur', 'لکڑی'),
    ('wood', 'hi', 'लकड़ी'),
    ('wood', 'bn', 'কাঠ'),
    ('wood', 'fil', 'Troso at Kahoy'),
    ('paint', 'en', 'Paints'),
    ('paint', 'ur', 'پینٹس'),
    ('paint', 'hi', 'पेंट'),
    ('paint', 'bn', 'রং'),
    ('paint', 'fil', 'Mga Pintura'),
    ('tools-equipment', 'en', 'Tools and Equipment'),
    ('tools-equipment', 'ur', 'اوزار اور سازوسامان'),
    ('tools-equipment', 'hi', 'औज़ार और उपकरण'),
    ('tools-equipment', 'bn', 'সরঞ্জাম ও যন্ত্রপাতি'),
    ('tools-equipment', 'fil', 'Mga Kasangkapan at Kagamitan')
) as translation(slug, locale, name)
join public.product_categories category on category.slug = translation.slug
on conflict (category_id, locale) do update
set name = excluded.name,
    reviewed_at = excluded.reviewed_at,
    updated_at = now();
