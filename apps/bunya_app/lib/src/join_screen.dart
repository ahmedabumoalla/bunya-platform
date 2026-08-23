import 'package:flutter/material.dart';

import 'data.dart';
import 'theme.dart';

enum JoinKind { provider, contractor }

class JoinApplicationScreen extends StatefulWidget {
  const JoinApplicationScreen({
    super.key,
    required this.kind,
    required this.repository,
  });

  final JoinKind kind;
  final BunyaRepository repository;

  @override
  State<JoinApplicationScreen> createState() => _JoinApplicationScreenState();
}

class _JoinApplicationScreenState extends State<JoinApplicationScreen> {
  final formKey = GlobalKey<FormState>();
  final name = TextEditingController();
  final contact = TextEditingController();
  final email = TextEditingController();
  final mobile = TextEditingController();
  final username = TextEditingController();
  final maps = TextEditingController();
  final regions = TextEditingController();
  final specialties = TextEditingController();
  late final Future<CatalogData> catalog = widget.repository.loadCatalog();
  final selectedCategories = <String>{};
  bool delivery = true, busy = false;
  JoinSubmission? result;

  bool get provider => widget.kind == JoinKind.provider;

  @override
  void dispose() {
    for (final controller in [
      name,
      contact,
      email,
      mobile,
      username,
      maps,
      regions,
      specialties,
    ]) {
      controller.dispose();
    }
    super.dispose();
  }

  List<String> values(String value) => value
      .split(RegExp(r'[,،]'))
      .map((item) => item.trim())
      .where((item) => item.isNotEmpty)
      .toSet()
      .toList();

  String? requiredText(String? value) =>
      value?.trim().isEmpty == false ? null : 'هذا الحقل مطلوب';

  String? validateEmail(String? value) =>
      RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(value?.trim() ?? '')
      ? null
      : 'أدخل بريدًا إلكترونيًا صحيحًا';

  String? validateMobile(String? value) =>
      RegExp(r'^(?:\+?966|0)?5\d{8}$')
          .hasMatch((value ?? '').replaceAll(' ', ''))
      ? null
      : 'أدخل رقم جوال سعوديًا صحيحًا';

  Future<void> submit() async {
    if (!formKey.currentState!.validate()) return;
    if (provider && selectedCategories.isEmpty) {
      message('اختر تصنيف منتجات واحدًا على الأقل');
      return;
    }
    if (values(regions.text).isEmpty) {
      message(
        provider && !delivery
            ? 'أدخل نطاق عمل المنشأة'
            : 'أدخل منطقة واحدة على الأقل',
      );
      return;
    }
    if (!provider && values(specialties.text).isEmpty) {
      message('أدخل تخصصًا واحدًا على الأقل');
      return;
    }
    setState(() => busy = true);
    try {
      final submitted = await widget.repository.submitJoinApplication(
        kind: provider ? 'provider' : 'contractor',
        fields: provider
            ? {
                'companyName': name.text.trim(),
                'contactName': contact.text.trim(),
                'mobile': mobile.text.trim(),
                'email': email.text.trim(),
                'username': username.text.trim(),
                'mapsUrl': maps.text.trim(),
                'deliveryAvailable': '$delivery',
              }
            : {
                'contractorName': name.text.trim(),
                'mobile': mobile.text.trim(),
                'email': email.text.trim(),
              },
        regions: values(regions.text),
        categories: selectedCategories.toList(),
        specialties: values(specialties.text),
      );
      if (mounted) setState(() => result = submitted);
    } catch (error) {
      if (mounted) message(error.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  void message(String value) =>
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(value)));

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(provider ? 'انضم كمزود' : 'انضم كمقاول')),
    body: result == null ? form() : success(),
  );

  Widget form() => Form(
    key: formKey,
    child: ListView(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
      children: [
        _JoinHero(provider: provider),
        const SizedBox(height: 18),
        _Title(
          number: '01',
          text: provider ? 'بيانات المنشأة' : 'بيانات المقاول',
        ),
        const SizedBox(height: 11),
        TextFormField(
          controller: name,
          validator: requiredText,
          decoration: InputDecoration(
            labelText: provider ? 'اسم الشركة' : 'اسم المقاول',
            prefixIcon: Icon(provider ? Icons.storefront : Icons.engineering),
          ),
        ),
        if (provider) ...[
          const SizedBox(height: 11),
          TextFormField(
            controller: contact,
            validator: requiredText,
            decoration: const InputDecoration(
              labelText: 'اسم المسؤول',
              prefixIcon: Icon(Icons.badge_outlined),
            ),
          ),
          const SizedBox(height: 11),
          TextFormField(
            controller: username,
            validator: (value) => RegExp(r'^[^\s]{4,40}$').hasMatch(value ?? '')
                ? null
                : 'استخدم 4–40 حرفًا بدون مسافات',
            textDirection: TextDirection.ltr,
            decoration: const InputDecoration(
              labelText: 'اسم المستخدم المطلوب',
              prefixIcon: Icon(Icons.alternate_email_rounded),
            ),
          ),
        ],
        const SizedBox(height: 11),
        TextFormField(
          controller: mobile,
          validator: validateMobile,
          keyboardType: TextInputType.phone,
          textDirection: TextDirection.ltr,
          decoration: const InputDecoration(
            labelText: 'رقم الجوال',
            prefixIcon: Icon(Icons.phone_iphone_rounded),
          ),
        ),
        const SizedBox(height: 11),
        TextFormField(
          controller: email,
          validator: validateEmail,
          keyboardType: TextInputType.emailAddress,
          textDirection: TextDirection.ltr,
          decoration: const InputDecoration(
            labelText: 'البريد الإلكتروني',
            prefixIcon: Icon(Icons.mail_outline_rounded),
          ),
        ),
        if (provider) ...[
          const SizedBox(height: 20),
          const _Title(number: '02', text: 'الموقع والمنتجات'),
          const SizedBox(height: 11),
          TextFormField(
            controller: maps,
            validator: requiredText,
            keyboardType: TextInputType.url,
            textDirection: TextDirection.ltr,
            decoration: const InputDecoration(
              labelText: 'رابط موقع المنشأة في Google Maps',
              prefixIcon: Icon(Icons.location_on_outlined),
            ),
          ),
          const SizedBox(height: 12),
          FutureBuilder<CatalogData>(
            future: catalog,
            builder: (_, snapshot) {
              final items = snapshot.data?.categories ?? const <String>[];
              return Wrap(
                spacing: 7,
                runSpacing: 7,
                children: items
                    .map(
                      (item) => FilterChip(
                        label: Text(item),
                        selected: selectedCategories.contains(item),
                        onSelected: (selected) => setState(
                          () => selected
                              ? selectedCategories.add(item)
                              : selectedCategories.remove(item),
                        ),
                      ),
                    )
                    .toList(),
              );
            },
          ),
          const SizedBox(height: 15),
          SwitchListTile.adaptive(
            value: delivery,
            onChanged: (value) => setState(() => delivery = value),
            title: const Text(
              'خدمة التوصيل متوفرة',
              style: TextStyle(fontWeight: FontWeight.w900),
            ),
            subtitle: const Text('حدد المدن أو الأحياء التي تغطيها المنشأة'),
            tileColor: Colors.white,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(18),
            ),
          ),
        ] else ...[
          const SizedBox(height: 20),
          const _Title(number: '02', text: 'نطاق العمل والتخصص'),
          const SizedBox(height: 11),
          TextFormField(
            controller: specialties,
            validator: requiredText,
            maxLines: 2,
            decoration: const InputDecoration(
              labelText: 'التخصصات',
              hintText: 'مثال: بناء عظم، تشطيب، ترميم',
              prefixIcon: Icon(Icons.workspace_premium_outlined),
            ),
          ),
        ],
        const SizedBox(height: 11),
        TextFormField(
          controller: regions,
          validator: requiredText,
          maxLines: 2,
          decoration: InputDecoration(
            labelText: provider && delivery ? 'مناطق التوصيل' : 'مناطق العمل',
            hintText: 'افصل بين المناطق بفاصلة',
            prefixIcon: const Icon(Icons.map_outlined),
          ),
        ),
        const SizedBox(height: 20),
        Container(
          padding: const EdgeInsets.all(15),
          decoration: BoxDecoration(
            color: BunyaColors.mint,
            borderRadius: BorderRadius.circular(18),
          ),
          child: const Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(
                Icons.notifications_active_outlined,
                color: BunyaColors.forest,
              ),
              SizedBox(width: 10),
              Expanded(
                child: Text(
                  'بعد الإرسال تصل تفاصيل الطلب للإدارة عبر إشعار التطبيق وواتساب والبريد. وبعد الموافقة تصلك بيانات الدخول المؤقتة على جوالك وبريدك.',
                  style: TextStyle(
                    color: BunyaColors.forest,
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        FilledButton.icon(
          onPressed: busy ? null : submit,
          icon: busy
              ? const SizedBox(
                  width: 19,
                  height: 19,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: Colors.white,
                  ),
                )
              : const Icon(Icons.send_rounded),
          label: Text(busy ? 'جارٍ رفع الطلب...' : 'إرسال طلب الانضمام'),
        ),
      ],
    ),
  );

  Widget success() => Center(
    child: SingleChildScrollView(
      padding: const EdgeInsets.all(22),
      child: Container(
        padding: const EdgeInsets.all(25),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(28),
          border: Border.all(color: BunyaColors.line),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const CircleAvatar(
              radius: 34,
              backgroundColor: BunyaColors.mint,
              child: Icon(
                Icons.check_rounded,
                size: 38,
                color: BunyaColors.forest,
              ),
            ),
            const SizedBox(height: 17),
            Text(
              'تم استلام طلبك',
              style: Theme.of(context).textTheme.headlineSmall
                  ?.copyWith(fontWeight: FontWeight.w900),
            ),
            const SizedBox(height: 7),
            const Text(
              'ستراجع الإدارة البيانات، ويصلك الرد وبيانات الدخول عبر واتساب والبريد الإلكتروني.',
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 16),
            SelectableText(
              result!.id,
              textDirection: TextDirection.ltr,
              style: const TextStyle(fontWeight: FontWeight.w900),
            ),
            const SizedBox(height: 18),
            FilledButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('العودة للرئيسية'),
            ),
          ],
        ),
      ),
    ),
  );
}

class _JoinHero extends StatelessWidget {
  const _JoinHero({required this.provider});
  final bool provider;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(22),
    decoration: BoxDecoration(
      gradient: LinearGradient(
        colors: provider
            ? const [BunyaColors.copperDark, BunyaColors.copper]
            : const [BunyaColors.forest, Color(0xFF27705C)],
      ),
      borderRadius: BorderRadius.circular(27),
    ),
    child: Row(
      children: [
        Container(
          width: 58,
          height: 58,
          decoration: BoxDecoration(
            color: Colors.white.withValues(alpha: .16),
            borderRadius: BorderRadius.circular(19),
          ),
          child: Icon(
            provider ? Icons.storefront_rounded : Icons.engineering_rounded,
            color: Colors.white,
            size: 31,
          ),
        ),
        const SizedBox(width: 14),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                provider ? 'نمِّ مبيعاتك مع بُنية' : 'مشاريع أكثر، بخبرتك',
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 19,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                provider
                    ? 'اعرض منتجاتك واستقبل طلبات التسعير.'
                    : 'عرّف بتخصصك واستقبل فرص المشاريع.',
                style: const TextStyle(
                  color: Color(0xFFEFE8E1),
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
        ),
      ],
    ),
  );
}

class _Title extends StatelessWidget {
  const _Title({required this.number, required this.text});
  final String number, text;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      CircleAvatar(
        radius: 15,
        backgroundColor: const Color(0xFFF0DDCF),
        child: Text(
          number,
          style: const TextStyle(
            color: BunyaColors.copperDark,
            fontSize: 10,
            fontWeight: FontWeight.w900,
          ),
        ),
      ),
      const SizedBox(width: 9),
      Text(
        text,
        style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 16),
      ),
    ],
  );
}
