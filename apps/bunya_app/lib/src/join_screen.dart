import 'dart:convert';

import 'package:file_selector/file_selector.dart';
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
  final nameEn = TextEditingController();
  final city = TextEditingController();
  final contact = TextEditingController();
  final email = TextEditingController();
  final mobile = TextEditingController();
  final username = TextEditingController();
  final maps = TextEditingController();
  final regions = TextEditingController();
  final specialties = TextEditingController();
  late final Future<CatalogData> catalog = widget.repository.loadCatalog();
  final selectedCategories = <String>{};
  final serviceCities = <String>[];
  final documents = <String, JoinDocument>{};
  static const documentLabels = {
    'commercial_registration': 'سجل تجاري',
    'municipal_license': 'رخصة بلدية',
    'national_address': 'عنوان وطني',
    'vat_certificate': 'شهادة تسجيل الضريبة للقيمة المضافة',
  };
  ProviderJoinPolicy? policy;
  String? policyError;
  bool policyLoading = true, policyAccepted = false;
  String? pickingDocument;
  bool delivery = true, busy = false;
  JoinSubmission? result;

  bool get provider => widget.kind == JoinKind.provider;

  @override
  void initState() {
    super.initState();
    if (provider) loadPolicy();
  }

  Future<void> loadPolicy() async {
    setState(() {
      policyLoading = true;
      policyAccepted = false;
      policyError = null;
      policy = null;
    });
    try {
      final loaded = await widget.repository.loadProviderJoinPolicy();
      if (!mounted) return;
      setState(() {
        policy = loaded;
        if (loaded == null) {
          policyError =
              'سياسة الانضمام غير منشورة حاليًا. يرجى المحاولة لاحقًا.';
        }
      });
    } catch (_) {
      if (mounted) {
        setState(
          () => policyError = 'تعذر تحميل سياسة الانضمام. أعد المحاولة.',
        );
      }
    } finally {
      if (mounted) setState(() => policyLoading = false);
    }
  }

  String normalizeWords(String value) =>
      value.trim().replaceAll(RegExp(r'\s+'), ' ');

  bool addCity() {
    final value = normalizeWords(city.text);
    if (value.isEmpty) return true;
    if (value.length < 2 || value.length > 100) {
      message('اكتب اسم مدينة من حرفين إلى 100 حرف');
      return false;
    }
    if (serviceCities.any(
      (item) => item.toLowerCase() == value.toLowerCase(),
    )) {
      city.clear();
      return true;
    }
    if (serviceCities.length >= 50) {
      message('يمكن إضافة 50 مدينة كحد أقصى');
      return false;
    }
    setState(() {
      serviceCities.add(value);
      city.clear();
    });
    return true;
  }

  Future<void> pickDocument(String key) async {
    setState(() => pickingDocument = key);
    try {
      final file = await openFile(
        acceptedTypeGroups: const [
          XTypeGroup(
            label: 'PDF أو صورة',
            extensions: ['pdf', 'jpg', 'jpeg', 'png', 'webp'],
            mimeTypes: [
              'application/pdf',
              'image/jpeg',
              'image/png',
              'image/webp',
            ],
            uniformTypeIdentifiers: [
              'com.adobe.pdf',
              'public.jpeg',
              'public.png',
              'org.webmproject.webp',
            ],
          ),
        ],
      );
      if (file == null || !mounted) return;
      final size = await file.length();
      if (!mounted) return;
      if (size == 0 || size > 10 * 1024 * 1024) {
        message('اختر مستندًا غير فارغ بحجم لا يتجاوز 10 ميجابايت');
        return;
      }
      final mime = switch (file.name.split('.').last.toLowerCase()) {
        'pdf' => 'application/pdf',
        'jpg' || 'jpeg' => 'image/jpeg',
        'png' => 'image/png',
        'webp' => 'image/webp',
        _ => null,
      };
      if (mime == null) {
        message('الملفات المسموحة: PDF وJPEG وPNG وWebP');
        return;
      }
      final bytes = await file.readAsBytes();
      if (mounted) {
        setState(
          () => documents[key] = JoinDocument(
            name: file.name,
            bytes: bytes,
            mimeType: mime,
          ),
        );
      }
    } catch (_) {
      if (mounted) message('تعذر قراءة المستند. أعد اختيار الملف.');
    } finally {
      if (mounted) setState(() => pickingDocument = null);
    }
  }

  void showPolicy() {
    final current = policy;
    if (current == null) return;
    showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        scrollable: true,
        title: Text(current.title),
        content: SelectableText(current.body.join('\n\n')),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('إغلاق'),
          ),
        ],
      ),
    );
  }

  @override
  void dispose() {
    for (final controller in [
      name,
      nameEn,
      city,
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

  String? validateCompany(String? value, {required bool arabic}) {
    final normalized = normalizeWords(value ?? '');
    if (normalized.length < 2 || normalized.length > 160) {
      return 'أدخل اسمًا من حرفين إلى 160 حرفًا، ويمكن استخدام المسافات';
    }
    if (arabic &&
        !RegExp(r'[\u0621-\u064A\u066E-\u06D3]').hasMatch(normalized)) {
      return 'أدخل اسم الشركة بالعربية';
    }
    if (!arabic && !RegExp(r'[A-Za-z]').hasMatch(normalized)) {
      return 'أدخل اسم الشركة بالإنجليزية';
    }
    return null;
  }

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
    if (provider && !addCity()) return;
    if (provider && selectedCategories.isEmpty) {
      message('اختر تصنيف منتجات واحدًا على الأقل');
      return;
    }
    if (provider ? serviceCities.isEmpty : values(regions.text).isEmpty) {
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
    if (provider &&
        documentLabels.keys.any((key) => !documents.containsKey(key))) {
      message('أرفق المستندات الأربعة المطلوبة');
      return;
    }
    if (provider && (policy == null || !policyAccepted)) {
      message('يجب تحميل سياسة الانضمام والموافقة عليها قبل الإرسال');
      return;
    }
    setState(() => busy = true);
    try {
      final submitted = await widget.repository.submitJoinApplication(
        kind: provider ? 'provider' : 'contractor',
        fields: provider
            ? {
                'companyName': normalizeWords(name.text),
                'companyNameEn': normalizeWords(nameEn.text),
                'contactName': normalizeWords(contact.text),
                'serviceCities': jsonEncode(serviceCities),
                'policyAccepted': 'true',
                'policyId': policy!.id,
                'policyVersion': policy!.version,
                'policyUpdatedAt': policy!.updatedAt,
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
        regions: provider ? serviceCities : values(regions.text),
        categories: selectedCategories.toList(),
        specialties: values(specialties.text),
        documents: provider ? documents : const {},
      );
      if (mounted) setState(() => result = submitted);
    } catch (error) {
      if (mounted) message(error.toString().replaceFirst('Exception: ', ''));
      if (mounted &&
          provider &&
          error is JoinSubmissionException &&
          error.statusCode == 409) {
        await loadPolicy();
      }
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
          validator: provider
              ? (value) => validateCompany(value, arabic: true)
              : requiredText,
          decoration: InputDecoration(
            labelText: provider ? 'اسم الشركة بالعربية' : 'اسم المقاول',
            prefixIcon: Icon(provider ? Icons.storefront : Icons.engineering),
          ),
        ),
        if (provider) ...[
          const SizedBox(height: 11),
          TextFormField(
            controller: nameEn,
            validator: (value) => validateCompany(value, arabic: false),
            textDirection: TextDirection.ltr,
            decoration: const InputDecoration(
              labelText: 'اسم الشركة بالإنجليزية',
              prefixIcon: Icon(Icons.storefront),
            ),
          ),
          const SizedBox(height: 11),
          TextFormField(
            controller: contact,
            validator: (value) => normalizeWords(value ?? '').length > 120
                ? 'الحد الأقصى 120 حرفًا'
                : null,
            decoration: const InputDecoration(
              labelText: 'اسم المسؤول (اختياري)',
              prefixIcon: Icon(Icons.badge_outlined),
            ),
          ),
          const SizedBox(height: 11),
          TextFormField(
            controller: username,
            validator: (value) {
              final candidate = normalizeWords(
                value?.trim().isNotEmpty == true ? value! : nameEn.text,
              );
              return candidate.length >= 2 &&
                      candidate.length <= 160 &&
                      !RegExp(r'[\x00-\x1f\x7f]').hasMatch(candidate)
                  ? null
                  : 'استخدم من حرفين إلى 160 حرفًا؛ المسافات مسموحة';
            },
            textDirection: TextDirection.ltr,
            decoration: const InputDecoration(
              labelText: 'اسم المستخدم (اختياري)',
              helperText: 'إذا تركته فارغًا نستخدم اسم الشركة بالإنجليزية',
              helperMaxLines: 2,
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
          const SizedBox(height: 16),
          TextFormField(
            controller: city,
            textInputAction: TextInputAction.done,
            onFieldSubmitted: (_) => addCity(),
            decoration: InputDecoration(
              labelText: 'المدن التي يخدمها المزود',
              helperText: 'اكتب مدينة ثم اضغط إدخال أو زر الإضافة',
              helperMaxLines: 2,
              suffixIcon: IconButton(
                tooltip: 'إضافة المدينة',
                onPressed: busy ? null : addCity,
                icon: const Icon(Icons.add),
              ),
            ),
          ),
          if (serviceCities.isNotEmpty) ...[
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 4,
              children: serviceCities
                  .map(
                    (value) => InputChip(
                      label: Text(value),
                      deleteButtonTooltipMessage: 'إزالة $value',
                      onDeleted: busy
                          ? null
                          : () => setState(() => serviceCities.remove(value)),
                    ),
                  )
                  .toList(),
            ),
          ],
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
            subtitle: const Text('تُحفظ مدن الخدمة المدخلة أعلاه مع الطلب'),
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
        if (!provider) ...[
          const SizedBox(height: 11),
          TextFormField(
            controller: regions,
            validator: requiredText,
            maxLines: 2,
            decoration: InputDecoration(
              labelText: 'مناطق العمل',
              hintText: 'افصل بين المناطق بفاصلة',
              prefixIcon: const Icon(Icons.map_outlined),
            ),
          ),
        ],
        if (provider) ...[
          const SizedBox(height: 20),
          const _Title(number: '03', text: 'المستندات الرئيسية'),
          const SizedBox(height: 8),
          const Text(
            'أرفق كل مستند في مكانه. PDF أو JPEG أو PNG أو WebP، بحد أقصى 10 ميجابايت للمستند.',
          ),
          const SizedBox(height: 12),
          LayoutBuilder(
            builder: (context, constraints) {
              final width = constraints.maxWidth >= 560
                  ? (constraints.maxWidth - 12) / 2
                  : constraints.maxWidth;
              return Wrap(
                spacing: 12,
                runSpacing: 12,
                children: documentLabels.entries
                    .map(
                      (entry) => SizedBox(
                        width: width,
                        child: Container(
                          padding: const EdgeInsets.all(16),
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(18),
                            border: Border.all(color: BunyaColors.line),
                          ),
                          child: Column(
                            children: [
                              const Icon(
                                Icons.description_outlined,
                                size: 30,
                                color: BunyaColors.forest,
                              ),
                              const SizedBox(height: 8),
                              Text(entry.value, textAlign: TextAlign.center),
                              if (documents[entry.key]
                                  case final document?) ...[
                                const SizedBox(height: 6),
                                Text(
                                  document.name,
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                  textAlign: TextAlign.center,
                                ),
                              ],
                              const SizedBox(height: 8),
                              OutlinedButton.icon(
                                onPressed: busy || pickingDocument != null
                                    ? null
                                    : () => pickDocument(entry.key),
                                icon: const Icon(Icons.upload_file),
                                label: Text(
                                  pickingDocument == entry.key
                                      ? 'جارٍ التحميل...'
                                      : documents.containsKey(entry.key)
                                      ? 'استبدال المستند'
                                      : 'تحميل المستند',
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    )
                    .toList(),
              );
            },
          ),
          const SizedBox(height: 16),
          if (policyLoading)
            const LinearProgressIndicator(
              semanticsLabel: 'جارٍ تحميل سياسة الانضمام',
            )
          else if (policyError != null) ...[
            Text(
              policyError!,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
            TextButton(
              onPressed: loadPolicy,
              child: const Text('إعادة تحميل السياسة'),
            ),
          ] else
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Semantics(
                  label: 'الموافقة على سياسة التقديم كمزود خدمة في بنية',
                  child: Checkbox(
                    value: policyAccepted,
                    onChanged: busy
                        ? null
                        : (value) =>
                              setState(() => policyAccepted = value ?? false),
                  ),
                ),
                Expanded(
                  child: TextButton(
                    onPressed: showPolicy,
                    child: const Text('سياسة التقديم كمزود خدمة في بنية'),
                  ),
                ),
              ],
            ),
        ],
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
          onPressed:
              busy ||
                  pickingDocument != null ||
                  (provider &&
                      (policyLoading || policy == null || !policyAccepted))
              ? null
              : submit,
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
