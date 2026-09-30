import 'dart:math';

import 'join_document.dart';

const contractorPortfolioLimit = 20;
const contractorCompanyDocuments = {
  'commercial_registration': 'سجل تجاري',
  'municipal_license': 'رخصة بلدية',
  'national_address': 'عنوان وطني',
  'vat_certificate': 'شهادة تسجيل الضريبة للقيمة المضافة',
  'company_profile': 'ملف تعريفي للشركة (اختياري)',
};
const contractorIndividualDocuments = {'national_id': 'الهوية الوطنية'};

String? contractorDocumentType(String key) {
  if (RegExp(
    r'^portfolio_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
    caseSensitive: false,
  ).hasMatch(key)) {
    return 'portfolio';
  }
  return contractorCompanyDocuments.containsKey(key) ||
          contractorIndividualDocuments.containsKey(key)
      ? key
      : null;
}

String newContractorPortfolioKey() {
  final random = Random.secure();
  final bytes = List<int>.generate(16, (_) => random.nextInt(256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  final hex = bytes
      .map((value) => value.toRadixString(16).padLeft(2, '0'))
      .join();
  return 'portfolio_${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
}

String? contractorFileMime(String name, {bool portfolio = false}) {
  return switch (name.split('.').last.toLowerCase()) {
    'jpg' || 'jpeg' => 'image/jpeg',
    'png' => 'image/png',
    'webp' => 'image/webp',
    'pdf' when !portfolio => 'application/pdf',
    'mp4' when portfolio => 'video/mp4',
    'webm' when portfolio => 'video/webm',
    'mov' when portfolio => 'video/quicktime',
    _ => null,
  };
}

bool contractorDocumentAllowed(String type, String key) {
  final documentType = contractorDocumentType(key);
  return type == 'company'
      ? contractorCompanyDocuments.containsKey(documentType)
      : type == 'individual' &&
            (documentType == 'national_id' || documentType == 'portfolio');
}

String? validateContractorDocuments(
  String type,
  Map<String, JoinDocument> documents,
) {
  final required = type == 'company'
      ? contractorCompanyDocuments.keys.where((key) => key != 'company_profile')
      : contractorIndividualDocuments.keys;
  if (required.any((key) => !documents.containsKey(key))) {
    return type == 'company'
        ? 'أرفق المستندات الأربعة المطلوبة'
        : 'أرفق الهوية الوطنية';
  }
  for (final entry in documents.entries) {
    if (!contractorDocumentAllowed(type, entry.key)) {
      return 'أزل المرفقات غير المناسبة لنوع المقاول';
    }
    final isPortfolio = contractorDocumentType(entry.key) == 'portfolio';
    final allowed = {
      'image/jpeg',
      'image/png',
      'image/webp',
      if (isPortfolio) ...{
        'video/mp4',
        'video/webm',
        'video/quicktime',
      } else
        'application/pdf',
    };
    if (entry.value.size <= 0 || !allowed.contains(entry.value.mimeType)) {
      return 'اختر مرفقات غير فارغة من الصيغ الموضحة';
    }
  }
  if (type == 'individual') {
    final count = documents.keys
        .where((key) => contractorDocumentType(key) == 'portfolio')
        .length;
    if (count == 0) {
      return 'أرفق صورة أو فيديو واحدًا على الأقل لأعمالك السابقة';
    }
    if (count > contractorPortfolioLimit) {
      return 'الحد الأقصى للأعمال السابقة 20 ملفًا';
    }
  }
  return null;
}
