import 'dart:convert';

import 'package:file_selector/file_selector.dart';
import 'package:flutter/material.dart';

import 'data.dart';
import 'contractor_join_fields.dart';
import 'prepare_join_document.dart';
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
  String contractorType = 'company';
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
  double uploadProgress = 0;
  JoinSubmission? result;

  bool get provider => widget.kind == JoinKind.provider;
  bool get company => provider || contractorType == 'company';
  Map<String, String> get currentDocumentLabels => provider
      ? documentLabels
      : company
      ? contractorCompanyDocuments
      : contractorIndividualDocuments;
  String get policyLabel => provider
      ? 'سياسة التقديم كمزود خدمة في بنية'
      : 'سياسة التقديم كمقاول في بنية';

  @override
  void initState() {
    super.initState();
    loadPolicy();
  }

  Future<void> loadPolicy() async {
    setState(() {
      policyLoading = true;
      policyAccepted = false;
      policyError = null;
      policy = null;
    });
    try {
      final loaded = provider
          ? await widget.repository.loadProviderJoinPolicy()
          : await widget.repository.loadContractorJoinPolicy();
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
      if (size == 0) {
        message('اختر مستندًا غير فارغ');
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
      final prepared = await prepareJoinDocument(file, mime);
      if (mounted) {
        final previous = documents[key];
        setState(() => documents[key] = prepared);
        await previous?.cleanup?.call();
      } else {
        await prepared.cleanup?.call();
      }
    } catch (_) {
      if (mounted) message('تعذر قراءة المستند. أعد اختيار الملف.');
    } finally {
      if (mounted) setState(() => pickingDocument = null);
    }
  }

  Future<void> changeContractorType(String value) async {
    final removed = documents.entries
        .where((entry) => !contractorDocumentAllowed(value, entry.key))
        .toList();
    setState(() {
      contractorType = value;
      for (final entry in removed) {
        documents.remove(entry.key);
      }
    });
    for (final entry in removed) {
      await entry.value.cleanup?.call();
    }
  }

  Future<void> removeDocument(String key) async {
    final previous = documents[key];
    setState(() => documents.remove(key));
    await previous?.cleanup?.call();
  }

  Future<void> pickPortfolio() async {
    setState(() => pickingDocument = 'portfolio');
    try {
      final selected = await openFiles(
        acceptedTypeGroups: const [
          XTypeGroup(
            label: 'صور أو فيديوهات',
            extensions: ['jpg', 'jpeg', 'png', 'webp', 'mp4', 'webm', 'mov'],
            mimeTypes: [
              'image/jpeg',
              'image/png',
              'image/webp',
              'video/mp4',
              'video/webm',
              'video/quicktime',
            ],
            uniformTypeIdentifiers: ['public.image', 'public.movie'],
          ),
        ],
      );
      if (!mounted || selected.isEmpty) return;
      final count = documents.keys
          .where((key) => contractorDocumentType(key) == 'portfolio')
          .length;
      if (count + selected.length > contractorPortfolioLimit) {
        message('الحد الأقصى للأعمال السابقة 20 ملفًا. أزل بعض الملفات أولًا.');
        return;
      }
      for (final file in selected) {
        final mime = contractorFileMime(file.name, portfolio: true);
        if (mime == null || await file.length() == 0) {
          if (mounted) {
            message(
              'اختر صورة JPEG أو PNG أو WebP أو فيديو MP4 أو WebM أو MOV غير فارغ',
            );
          }
          continue;
        }
        final prepared = await prepareJoinDocument(file, mime);
        if (!mounted) {
          await prepared.cleanup?.call();
          return;
        }
        setState(() => documents[newContractorPortfolioKey()] = prepared);
      }
    } catch (_) {
      if (mounted) message('تعذر قراءة ملف الأعمال. أعد اختيار الملف.');
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
    for (final document in documents.values) {
      document.cleanup?.call();
    }
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
      return company ? 'أدخل اسم الشركة بالعربية' : 'أدخل الاسم بالعربية';
    }
    if (!arabic && !RegExp(r'[A-Za-z]').hasMatch(normalized)) {
      return company ? 'أدخل اسم الشركة بالإنجليزية' : 'أدخل الاسم بالإنجليزية';
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
    if (busy || pickingDocument != null) return;
    if (!formKey.currentState!.validate()) return;
    if (!addCity()) return;
    if (provider && selectedCategories.isEmpty) {
      message('اختر تصنيف منتجات واحدًا على الأقل');
      return;
    }
    if (serviceCities.isEmpty) {
      message('أضف مدينة واحدة على الأقل');
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
    if (!provider) {
      final error = validateContractorDocuments(contractorType, documents);
      if (error != null) {
        message(error);
        return;
      }
    }
    if (policy == null || !policyAccepted) {
      message('يجب تحميل سياسة الانضمام والموافقة عليها قبل الإرسال');
      return;
    }
    setState(() {
      busy = true;
      uploadProgress = 0;
    });
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
                'contractorType': contractorType,
                'contractorName': normalizeWords(name.text),
                'contractorNameEn': normalizeWords(nameEn.text),
                'contactName': company ? normalizeWords(contact.text) : '',
                'username': normalizeWords(username.text),
                'serviceCities': jsonEncode(serviceCities),
                'policyAccepted': 'true',
                'policyId': policy!.id,
                'policyVersion': policy!.version,
                'policyUpdatedAt': policy!.updatedAt,
                'mobile': mobile.text.trim(),
                'email': email.text.trim(),
              },
        regions: serviceCities,
        categories: selectedCategories.toList(),
        specialties: values(specialties.text),
        documents: documents,
        onUploadProgress: (progress) {
          if (mounted) setState(() => uploadProgress = progress);
        },
      );
      if (mounted) setState(() => result = submitted);
    } catch (error) {
      if (mounted) message(error.toString().replaceFirst('Exception: ', ''));
      if (mounted &&
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
        if (!provider) ...[
          const SizedBox(height: 16),
          const Text(
            'نوع المقاول',
            style: TextStyle(fontWeight: FontWeight.w900),
          ),
          const SizedBox(height: 8),
          SegmentedButton<String>(
            segments: const [
              ButtonSegment(value: 'company', label: Text('شركة')),
              ButtonSegment(value: 'individual', label: Text('فرد')),
            ],
            selected: {contractorType},
            onSelectionChanged: busy || pickingDocument != null
                ? null
                : (value) => changeContractorType(value.single),
          ),
        ],
        const SizedBox(height: 18),
        _Title(
          number: '01',
          text: provider ? 'بيانات المنشأة' : 'بيانات المقاول',
        ),
        const SizedBox(height: 11),
        TextFormField(
          controller: name,
          validator: (value) => validateCompany(value, arabic: true),
          decoration: InputDecoration(
            labelText: company ? 'اسم الشركة بالعربية' : 'الاسم بالعربية',
            prefixIcon: Icon(provider ? Icons.storefront : Icons.engineering),
          ),
        ),
        const SizedBox(height: 11),
        TextFormField(
          controller: nameEn,
          validator: (value) => validateCompany(value, arabic: false),
          textDirection: TextDirection.ltr,
          decoration: InputDecoration(
            labelText: company ? 'اسم الشركة بالإنجليزية' : 'الاسم بالإنجليزية',
            prefixIcon: const Icon(Icons.storefront),
          ),
        ),
        if (company) ...[
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
        ],
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
          decoration: InputDecoration(
            labelText: 'اسم المستخدم (اختياري)',
            helperText: company
                ? 'إذا تركته فارغًا نستخدم اسم الشركة بالإنجليزية'
                : 'إذا تركته فارغًا نستخدم الاسم بالإنجليزية',
            helperMaxLines: 2,
            prefixIcon: const Icon(Icons.alternate_email_rounded),
          ),
        ),
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
        const SizedBox(height: 16),
        TextFormField(
          controller: city,
          textInputAction: TextInputAction.done,
          onFieldSubmitted: (_) => addCity(),
          decoration: InputDecoration(
            labelText: provider
                ? 'المدن التي يخدمها المزود'
                : 'المدن التي يعمل بها المقاول',
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
        const SizedBox(height: 20),
        const _Title(number: '03', text: 'المستندات الرئيسية'),
        const SizedBox(height: 8),
        const Text(
          'أرفق كل مستند في مكانه. PDF أو JPEG أو PNG أو WebP. تُضغط الصور عند الإمكان مع الحفاظ على وضوح المستند، وتُرفع الملفات على أجزاء.',
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
              children: currentDocumentLabels.entries
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
                            if (documents[entry.key] case final document?) ...[
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
                            if (!provider && documents.containsKey(entry.key))
                              TextButton(
                                onPressed: busy || pickingDocument != null
                                    ? null
                                    : () => removeDocument(entry.key),
                                child: const Text('إزالة الملف المختار'),
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
        if (!provider && !company) ...[
          const SizedBox(height: 16),
          const Text(
            'الأعمال السابقة (مطلوب) — من ملف واحد إلى 20 ملفًا',
            style: TextStyle(fontWeight: FontWeight.w900),
          ),
          const SizedBox(height: 8),
          const Text(
            'اختر عدة صور JPEG أو PNG أو WebP، أو فيديوهات MP4 أو WebM أو MOV. تُرفع الفيديوهات الأصلية دون تغيير.',
          ),
          const SizedBox(height: 8),
          OutlinedButton.icon(
            onPressed: busy || pickingDocument != null ? null : pickPortfolio,
            icon: const Icon(Icons.add_photo_alternate_outlined),
            label: Text(
              pickingDocument == 'portfolio'
                  ? 'جارٍ تجهيز الملفات...'
                  : 'إضافة صور أو فيديوهات',
            ),
          ),
          Text(
            'الملفات المرفقة: ${documents.keys.where((key) => contractorDocumentType(key) == 'portfolio').length} من 20',
          ),
          ...documents.entries
              .where(
                (entry) => contractorDocumentType(entry.key) == 'portfolio',
              )
              .map(
                (entry) => ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(
                    entry.value.name,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                  trailing: IconButton(
                    tooltip: 'إزالة ${entry.value.name}',
                    onPressed: busy || pickingDocument != null
                        ? null
                        : () => removeDocument(entry.key),
                    icon: const Icon(Icons.close),
                  ),
                ),
              ),
        ],
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
                label: 'الموافقة على $policyLabel',
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
                  child: Text(policyLabel),
                ),
              ),
            ],
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
          onPressed:
              busy ||
                  pickingDocument != null ||
                  (policyLoading || policy == null || !policyAccepted)
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
          label: Text(
            busy
                ? uploadProgress < 1
                      ? 'جارٍ رفع المستندات ${(uploadProgress * 100).round()}٪'
                      : 'جارٍ إرسال الطلب...'
                : 'إرسال طلب الانضمام',
          ),
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
