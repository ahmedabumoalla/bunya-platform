import 'dart:convert';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';

import 'product_image_urls.dart';
import 'localization.dart';
import 'apple_auth.dart';
import 'join_document.dart';
import 'provider_document_upload.dart';
import 'contractor_join_fields.dart';

export 'join_document.dart';

const _appUrl = String.fromEnvironment(
  'APP_URL',
  defaultValue: 'https://www.buniahksa.com',
);

// Password recovery must remain available even when the rest of the app is
// pointed at a local API that is stopped or running on a different port.
const _passwordRecoveryUrl =
    'https://www.buniahksa.com/api/auth/password-recovery';

class CatalogProductImage {
  const CatalogProductImage({
    required this.id,
    required this.label,
    required this.alt,
    required this.url,
    required this.fallbackUrl,
    required this.cacheKey,
  });
  final String id, label, alt;
  final String? url, fallbackUrl, cacheKey;
}

class ProductMeasurementOption {
  const ProductMeasurementOption({
    required this.id,
    required this.label,
    required this.unit,
    required this.isDefault,
  });
  final String id, label, unit;
  final bool isDefault;
}

class ProductVariantOption {
  const ProductVariantOption({
    required this.id,
    required this.name,
    required this.attributes,
  });
  final String id, name;
  final Map<String, String> attributes;
}

class ProductRegion {
  const ProductRegion({required this.city, required this.scope});
  final String city, scope;
}

class ProductWarrantyInfo {
  const ProductWarrantyInfo({
    required this.label,
    required this.duration,
    required this.details,
    required this.available,
  });
  final String label, duration, details;
  final bool available;
}

class ProductDeliveryInfo {
  const ProductDeliveryInfo({
    required this.available,
    required this.maximumDuration,
    required this.pricePerKm,
    required this.maximumDistanceKm,
    required this.regions,
    required this.notes,
  });
  final bool available;
  final String maximumDuration, notes;
  final double? pricePerKm, maximumDistanceKm;
  final List<String> regions;
}

class Product {
  const Product({
    required this.id,
    required this.sku,
    required this.name,
    required this.category,
    required this.unit,
    required this.shortDescription,
    required this.description,
    required this.fullDescription,
    required this.availability,
    required this.availabilityStatus,
    required this.leadTime,
    required this.deliveryLabel,
    required this.deliveryWindow,
    required this.deliveryNotes,
    required this.offerType,
    required this.minimumOrder,
    required this.stockQuantity,
    required this.vatInclusive,
    required this.rentalDuration,
    required this.images,
    required this.units,
    required this.measurements,
    required this.variants,
    required this.specifications,
    required this.regions,
    required this.warranty,
    required this.delivery,
    required this.isNew,
  });
  final String id,
      sku,
      name,
      category,
      unit,
      shortDescription,
      description,
      fullDescription,
      availability,
      availabilityStatus,
      leadTime,
      deliveryLabel,
      deliveryWindow,
      deliveryNotes,
      offerType,
      rentalDuration;
  final double? minimumOrder, stockQuantity;
  final bool vatInclusive;
  final List<CatalogProductImage> images;
  final List<String> units, specifications;
  final List<ProductMeasurementOption> measurements;
  final List<ProductVariantOption> variants;
  final List<ProductRegion> regions;
  final ProductWarrantyInfo warranty;
  final ProductDeliveryInfo delivery;
  final bool isNew;

  CatalogProductImage? get primaryImage => images.isEmpty ? null : images.first;
  String? get imageUrl => primaryImage?.url;
  String? get imageFallbackUrl => primaryImage?.fallbackUrl;
  String? get imageCacheKey => primaryImage?.cacheKey;
}

class CatalogData {
  const CatalogData(this.categories, this.products);
  final List<String> categories;
  final List<Product> products;
}

class MobileQuoteItem {
  const MobileQuoteItem({
    required this.product,
    required this.quantity,
    required this.measurement,
    required this.selectedVariants,
    required this.notes,
  });

  final Product product;
  final double quantity;
  final ProductMeasurementOption? measurement;
  final List<ProductVariantOption> selectedVariants;
  final String notes;

  String get unit => measurement?.unit ?? product.unit;
  String get measurementLabel => measurement?.label ?? 'بدون قياس إضافي';
  String get variantLabel => selectedVariants
      .map((variant) {
        if (variant.attributes.isEmpty) return variant.name;
        return variant.attributes.entries
            .map((attribute) => '${attribute.key}: ${attribute.value}')
            .join('، ');
      })
      .join(' · ');
  String get selectionKey {
    final variantIds = selectedVariants.map((variant) => variant.id).toList()
      ..sort();
    return '${product.id}|${measurement?.id ?? ''}|${variantIds.join(',')}';
  }

  MobileQuoteItem copyWith({double? quantity}) => MobileQuoteItem(
    product: product,
    quantity: quantity ?? this.quantity,
    measurement: measurement,
    selectedVariants: selectedVariants,
    notes: notes,
  );
}

class QuoteSubmissionDetails {
  const QuoteSubmissionDetails({
    required this.mapsUrl,
    required this.locationHint,
    required this.requiredAt,
    required this.delivery,
    required this.projectName,
    required this.recipientName,
    required this.recipientMobile,
    required this.siteResponsibleName,
    required this.siteResponsibleMobile,
    required this.contractorName,
    required this.contractorMobile,
    required this.workingHours,
    required this.loadingOption,
    required this.unloadingOption,
    required this.roadAccess,
    required this.accessInstructions,
    required this.notes,
  });

  final String mapsUrl,
      locationHint,
      projectName,
      recipientName,
      recipientMobile,
      siteResponsibleName,
      siteResponsibleMobile,
      contractorName,
      contractorMobile,
      workingHours,
      loadingOption,
      unloadingOption,
      roadAccess,
      accessInstructions,
      notes;
  final DateTime requiredAt;
  final bool delivery;
}

class QuoteSummary {
  const QuoteSummary({
    required this.id,
    required this.code,
    required this.status,
    required this.city,
    required this.createdAt,
    required this.requiredAt,
  });
  final String id, code, status, city;
  final DateTime createdAt, requiredAt;
}

class QuoteItemDetail {
  const QuoteItemDetail({
    required this.name,
    required this.quantity,
    required this.unit,
    required this.measurement,
    required this.notes,
  });
  final String name, unit, measurement, notes;
  final double quantity;
}

class QuoteOfferDetail {
  const QuoteOfferDetail({
    required this.id,
    required this.code,
    required this.status,
    required this.subtotal,
    required this.vat,
    required this.delivery,
    required this.total,
    required this.validUntil,
    required this.expectedDelivery,
    required this.paymentStatus,
  });
  final String id, code, status, paymentStatus;
  final double subtotal, vat, delivery, total;
  final DateTime validUntil, expectedDelivery;

  static bool isPaymentComplete(String value) =>
      const {'paid', 'succeeded'}.contains(value.toLowerCase());

  bool get isPaid => isPaymentComplete(paymentStatus);
}

class QuoteDetail {
  const QuoteDetail({
    required this.summary,
    required this.location,
    required this.mapsUrl,
    required this.deliveryMode,
    required this.notes,
    required this.deadline,
    required this.pricingOpensAt,
    required this.pricingCountdownStartsAt,
    required this.recipientName,
    required this.recipientMobile,
    required this.siteResponsibleName,
    required this.siteResponsibleMobile,
    required this.contractorName,
    required this.contractorMobile,
    required this.workingHours,
    required this.loadingOption,
    required this.unloadingOption,
    required this.roadAccess,
    required this.accessInstructions,
    required this.acknowledgedAt,
    required this.items,
    required this.offer,
  });
  final QuoteSummary summary;
  final String location,
      mapsUrl,
      deliveryMode,
      notes,
      recipientName,
      recipientMobile,
      siteResponsibleName,
      siteResponsibleMobile,
      contractorName,
      contractorMobile,
      workingHours,
      loadingOption,
      unloadingOption,
      roadAccess,
      accessInstructions;
  final DateTime deadline, pricingOpensAt, pricingCountdownStartsAt;
  final DateTime? acknowledgedAt;
  final List<QuoteItemDetail> items;
  final QuoteOfferDetail? offer;
}

class AppNotification {
  const AppNotification({
    required this.id,
    required this.source,
    required this.title,
    required this.message,
    required this.createdAt,
    required this.read,
    this.actionUrl,
    this.entityType,
    this.entityId,
  });
  final String id, source, title, message;
  final DateTime createdAt;
  final bool read;
  final String? actionUrl, entityType, entityId;
}

class Profile {
  const Profile({
    required this.name,
    required this.email,
    required this.mobile,
    required this.role,
    required this.mustChangePassword,
  });
  final String name, email, mobile, role;
  final bool mustChangePassword;
}

class JoinSubmission {
  const JoinSubmission({required this.id, required this.status});
  final String id, status;
}

class JoinSubmissionException implements Exception {
  const JoinSubmissionException(this.statusCode, this.message);

  final int statusCode;
  final String message;

  @override
  String toString() => message;
}

class ProviderJoinPolicy {
  const ProviderJoinPolicy({
    required this.id,
    required this.title,
    required this.version,
    required this.body,
    required this.updatedAt,
  });

  final String id, title, version, updatedAt;
  final List<String> body;

  factory ProviderJoinPolicy.fromJson(Map<String, dynamic> json) =>
      ProviderJoinPolicy(
        id: json['id'] as String,
        title: json['title'] as String,
        version: '${json['version']}',
        body: List<String>.from(json['body'] as List),
        updatedAt: json['updatedAt'] as String,
      );
}

class AppDataRefresh {
  AppDataRefresh._();

  static final ValueNotifier<int> revision = ValueNotifier(0);

  static void notify() => revision.value += 1;
}

class ContractorDirectoryWorkItem {
  const ContractorDirectoryWorkItem({
    required this.title,
    required this.mediaUrl,
    required this.mimeType,
  });

  final String title;
  final String? mediaUrl, mimeType;

  factory ContractorDirectoryWorkItem.fromJson(Map<String, dynamic> json) =>
      ContractorDirectoryWorkItem(
        title: '${json['title'] ?? ''}',
        mediaUrl: json['mediaUrl'] as String?,
        mimeType: json['mimeType'] as String?,
      );
}

class ContractorDirectoryEntry {
  const ContractorDirectoryEntry({
    required this.id,
    required this.displayName,
    required this.commercialName,
    required this.city,
    required this.badge,
    required this.serviceTypes,
    required this.workRegions,
    required this.yearsExperience,
    required this.summary,
    required this.workItems,
    required this.phone,
    required this.email,
    required this.mapsUrl,
    required this.averageRating,
    required this.projectsCount,
    required this.availability,
  });

  final String id,
      displayName,
      commercialName,
      city,
      badge,
      summary,
      phone,
      email,
      availability;
  final String? mapsUrl;
  final List<String> serviceTypes, workRegions;
  final List<ContractorDirectoryWorkItem> workItems;
  final int yearsExperience, projectsCount;
  final double averageRating;

  factory ContractorDirectoryEntry.fromJson(Map<String, dynamic> json) =>
      ContractorDirectoryEntry(
        id: '${json['id'] ?? ''}',
        displayName: '${json['displayName'] ?? ''}',
        commercialName: '${json['commercialName'] ?? ''}',
        city: '${json['city'] ?? 'غير محدد'}',
        badge: '${json['badge'] ?? 'مقاول معتمد من بُنية'}',
        serviceTypes: ((json['serviceTypes'] as List?) ?? const [])
            .map((value) => '$value')
            .where((value) => value.trim().isNotEmpty)
            .toList(),
        workRegions: ((json['workRegions'] as List?) ?? const [])
            .map((value) => '$value')
            .where((value) => value.trim().isNotEmpty)
            .toList(),
        yearsExperience: (json['yearsExperience'] as num?)?.toInt() ?? 0,
        summary: '${json['summary'] ?? 'ملف مقاول معتمد من إدارة بُنية.'}',
        workItems: ((json['workItems'] as List?) ?? const [])
            .map(
              (value) => ContractorDirectoryWorkItem.fromJson(
                Map<String, dynamic>.from(value as Map),
              ),
            )
            .toList(),
        phone: '${json['phone'] ?? ''}',
        email: '${json['email'] ?? ''}',
        mapsUrl: json['mapsUrl'] as String?,
        averageRating: (json['averageRating'] as num?)?.toDouble() ?? 0,
        projectsCount: (json['projectsCount'] as num?)?.toInt() ?? 0,
        availability: '${json['availability'] ?? 'available'}',
      );
}

class BunyaRepository {
  BunyaRepository([SupabaseClient? value])
    : client = value ?? Supabase.instance.client;
  final SupabaseClient client;
  static CatalogData? _catalogCache;
  static DateTime? _catalogCachedAt;
  static Future<CatalogData>? _catalogRequest;
  static int _catalogGeneration = 0;
  String _pendingVerificationPhone = '';
  bool _pendingVerificationCodeSent = false;
  User? get user => client.auth.currentUser;
  String get pendingVerificationPhone => _pendingVerificationPhone;
  bool get pendingVerificationCodeSent => _pendingVerificationCodeSent;

  static void notifyDataChanged() {
    _catalogGeneration += 1;
    _catalogCache = null;
    _catalogCachedAt = null;
    _catalogRequest = null;
    AppDataRefresh.notify();
  }

  Future<CatalogData> loadCatalog({bool forceRefresh = false}) {
    final cachedAt = _catalogCachedAt;
    if (!forceRefresh &&
        _catalogCache != null &&
        cachedAt != null &&
        DateTime.now().difference(cachedAt) < const Duration(minutes: 5)) {
      return Future.value(_catalogCache);
    }
    if (_catalogRequest != null) return _catalogRequest!;
    final generation = _catalogGeneration;
    final request = _fetchCatalog(generation);
    _catalogRequest = request;
    return request.whenComplete(() {
      if (identical(_catalogRequest, request)) _catalogRequest = null;
    });
  }

  Future<CatalogData> _fetchCatalog(int generation) async {
    final results = await Future.wait([
      client
          .from('product_categories')
          .select(
            'id,name,sort_order,product_category_translations(locale,name,reviewed_at)',
          )
          .eq('is_active', true)
          .order('sort_order'),
      client
          .from('products')
          .select(
            'id,sku,name,base_unit,short_description,description,full_description,availability_summary,availability_status,lead_time_label,delivery_label,delivery_window,delivery_notes,is_new,offer_type,minimum_order,stock_quantity,vat_inclusive,rental_duration_value,rental_duration_unit,custom_category,product_translations(locale,name,short_description,description,full_description,availability_summary,lead_time_label,delivery_label,delivery_window,delivery_notes,reviewed_at),product_categories(id,name,product_category_translations(locale,name,reviewed_at)),product_images(id,label,alt_text,image_url,storage_path,is_primary,sort_order),product_units(id,name,is_base,sort_order,product_unit_translations(locale,name,reviewed_at)),product_measurements(id,label,is_default,sort_order,product_measurement_translations(locale,label,reviewed_at),product_units(id,name,product_unit_translations(locale,name,reviewed_at))),product_variants(id,name,attributes,is_active,sort_order),product_specifications(value,sort_order),product_warranties(label,duration,details,is_available),product_availability_regions(city,scope)',
          )
          .eq('is_published', true)
          .eq('review_status', 'approved')
          .order('created_at', ascending: false)
          .limit(80),
    ]);
    final categoryRows = results[0] as List;
    final rows = results[1] as List;
    final locale = BunyaLocaleController.locale.value.languageCode;
    Map<String, dynamic>? reviewedTranslation(dynamic value) {
      if (locale == 'ar' || value is! List) return null;
      for (final raw in value.whereType<Map>()) {
        final item = Map<String, dynamic>.from(raw);
        if (item['locale'] == locale && item['reviewed_at'] != null) {
          return item;
        }
      }
      return null;
    }

    final prepared = rows.map((raw) {
      final row = Map<String, dynamic>.from(raw as Map);
      final productTranslation = reviewedTranslation(
        row['product_translations'],
      );
      if (productTranslation != null) {
        for (final key in const [
          'name',
          'short_description',
          'description',
          'full_description',
          'availability_summary',
          'lead_time_label',
          'delivery_label',
          'delivery_window',
          'delivery_notes',
        ]) {
          final translated = '${productTranslation[key] ?? ''}'.trim();
          if (translated.isNotEmpty) row[key] = translated;
        }
      }
      final categoryRaw = row['product_categories'];
      final custom = '${row['custom_category'] ?? ''}'.trim();
      final category = custom.isNotEmpty
          ? custom
          : categoryRaw is Map
          ? '${reviewedTranslation(categoryRaw['product_category_translations'])?['name'] ?? categoryRaw['name'] ?? 'غير مصنف'}'
          : 'غير مصنف';
      final images =
          ((row['product_images'] as List?) ?? const [])
              .map((item) => Map<String, dynamic>.from(item as Map))
              .toList()
            ..sort((a, b) {
              final primary =
                  (b['is_primary'] == true ? 1 : 0) -
                  (a['is_primary'] == true ? 1 : 0);
              return primary != 0
                  ? primary
                  : (a['sort_order'] as num? ?? 0).compareTo(
                      b['sort_order'] as num? ?? 0,
                    );
            });
      return (row: row, category: category, images: images);
    }).toList();
    final paths = prepared
        .expand((item) => item.images)
        .map((image) => '${image['storage_path'] ?? ''}'.trim())
        .where((path) => path.isNotEmpty)
        .toSet()
        .toList();
    final signedResults = await Future.wait([
      ProductImageUrls.thumbnails(client, paths),
      ProductImageUrls.originals(client, paths),
    ]);
    final signedUrls = signedResults[0];
    final originalUrls = signedResults[1];
    final products = prepared.map((item) {
      final row = item.row;
      final images = item.images.map((image) {
        final path = '${image['storage_path'] ?? ''}'.trim();
        final directUrl = '${image['image_url'] ?? ''}'.trim();
        final thumbnailUrl = (signedUrls[path] ?? '').trim();
        final imageUrl = thumbnailUrl.isNotEmpty ? thumbnailUrl : directUrl;
        return CatalogProductImage(
          id: '${image['id'] ?? path}',
          label: '${image['label'] ?? 'صورة المنتج'}',
          alt: '${image['alt_text'] ?? row['name'] ?? 'صورة المنتج'}',
          url: imageUrl.isEmpty ? null : imageUrl,
          fallbackUrl: path.isEmpty ? null : originalUrls[path],
          cacheKey: path.isNotEmpty
              ? '$path:${image['id'] ?? ''}'
              : (directUrl.isEmpty ? null : '$directUrl:${image['id'] ?? ''}'),
        );
      }).toList();
      final units =
          ((row['product_units'] as List?) ?? const [])
              .map((raw) => Map<String, dynamic>.from(raw as Map))
              .toList()
            ..sort(
              (a, b) => (a['sort_order'] as num? ?? 0).compareTo(
                b['sort_order'] as num? ?? 0,
              ),
            );
      for (final unit in units) {
        final translated = reviewedTranslation(
          unit['product_unit_translations'],
        );
        if (translated != null &&
            '${translated['name'] ?? ''}'.trim().isNotEmpty) {
          unit['name'] = translated['name'];
        }
      }
      final measurements =
          ((row['product_measurements'] as List?) ?? const [])
              .map((raw) => Map<String, dynamic>.from(raw as Map))
              .toList()
            ..sort(
              (a, b) => (a['sort_order'] as num? ?? 0).compareTo(
                b['sort_order'] as num? ?? 0,
              ),
            );
      for (final measurement in measurements) {
        final translated = reviewedTranslation(
          measurement['product_measurement_translations'],
        );
        if (translated != null &&
            '${translated['label'] ?? ''}'.trim().isNotEmpty) {
          measurement['label'] = translated['label'];
        }
        final unitRaw = measurement['product_units'];
        if (unitRaw is Map) {
          final unit = Map<String, dynamic>.from(unitRaw);
          final unitTranslation = reviewedTranslation(
            unit['product_unit_translations'],
          );
          if (unitTranslation != null &&
              '${unitTranslation['name'] ?? ''}'.trim().isNotEmpty) {
            unit['name'] = unitTranslation['name'];
          }
          measurement['product_units'] = unit;
        }
      }
      final variants =
          ((row['product_variants'] as List?) ?? const [])
              .map((raw) => Map<String, dynamic>.from(raw as Map))
              .where((value) => value['is_active'] != false)
              .toList()
            ..sort(
              (a, b) => (a['sort_order'] as num? ?? 0).compareTo(
                b['sort_order'] as num? ?? 0,
              ),
            );
      final specifications =
          ((row['product_specifications'] as List?) ?? const [])
              .map((raw) => Map<String, dynamic>.from(raw as Map))
              .toList()
            ..sort(
              (a, b) => (a['sort_order'] as num? ?? 0).compareTo(
                b['sort_order'] as num? ?? 0,
              ),
            );
      final warrantyRaw = row['product_warranties'];
      final warranty = warrantyRaw is Map
          ? Map<String, dynamic>.from(warrantyRaw)
          : <String, dynamic>{};
      final rentalDuration = _formatCatalogDuration(
        row['rental_duration_value'] as num?,
        '${row['rental_duration_unit'] ?? ''}',
      );
      return Product(
        id: '${row['id']}',
        sku: '${row['sku'] ?? ''}'.trim(),
        name: '${row['name'] ?? 'منتج'}',
        category: item.category,
        unit: '${row['base_unit'] ?? 'وحدة'}',
        shortDescription: '${row['short_description'] ?? ''}'.trim(),
        description: '${row['description'] ?? row['short_description'] ?? ''}',
        fullDescription:
            '${row['full_description'] ?? row['description'] ?? ''}'.trim(),
        availability: '${row['availability_summary'] ?? 'حسب التوفر'}',
        availabilityStatus: _catalogAvailabilityLabel(
          '${row['availability_status'] ?? 'on_request'}',
        ),
        leadTime: '${row['lead_time_label'] ?? 'يحدد بعد الطلب'}',
        deliveryLabel: '${row['delivery_label'] ?? 'حسب الموقع'}',
        deliveryWindow: '${row['delivery_window'] ?? 'يحدد بعد الطلب'}',
        deliveryNotes: '${row['delivery_notes'] ?? ''}'.trim(),
        offerType: row['offer_type'] == 'rental' ? 'تأجير' : 'بيع',
        minimumOrder: (row['minimum_order'] as num?)?.toDouble(),
        stockQuantity: (row['stock_quantity'] as num?)?.toDouble(),
        vatInclusive: row['vat_inclusive'] != false,
        rentalDuration: rentalDuration,
        images: images,
        units: units
            .map((value) => '${value['name'] ?? ''}'.trim())
            .where((value) => value.isNotEmpty)
            .toList(),
        measurements: measurements.map((value) {
          final unitRaw = value['product_units'];
          final measurementUnit = unitRaw is Map
              ? '${unitRaw['name'] ?? row['base_unit'] ?? 'وحدة'}'
              : '${row['base_unit'] ?? 'وحدة'}';
          return ProductMeasurementOption(
            id: '${value['id']}',
            label: '${value['label'] ?? ''}',
            unit: measurementUnit,
            isDefault: value['is_default'] == true,
          );
        }).toList(),
        variants: variants.map((value) {
          final rawAttributes = value['attributes'];
          final attributes = rawAttributes is Map
              ? rawAttributes.map(
                  (key, item) => MapEntry('$key', '${item ?? ''}'),
                )
              : <String, String>{};
          return ProductVariantOption(
            id: '${value['id']}',
            name: '${value['name'] ?? ''}',
            attributes: attributes,
          );
        }).toList(),
        specifications: specifications
            .map((value) => '${value['value'] ?? ''}'.trim())
            .where((value) => value.isNotEmpty)
            .toList(),
        regions: ((row['product_availability_regions'] as List?) ?? const [])
            .map((raw) => Map<String, dynamic>.from(raw as Map))
            .map(
              (value) => ProductRegion(
                city: '${value['city'] ?? ''}',
                scope: '${value['scope'] ?? ''}',
              ),
            )
            .where((value) => value.city.trim().isNotEmpty)
            .toList(),
        warranty: ProductWarrantyInfo(
          label: '${warranty['label'] ?? 'الضمان'}',
          duration: '${warranty['duration'] ?? 'غير متوفر'}',
          details: '${warranty['details'] ?? 'لا توجد معلومات ضمان إضافية.'}',
          available: warranty['is_available'] != false && warranty.isNotEmpty,
        ),
        delivery: ProductDeliveryInfo(
          available:
              '${row['delivery_label'] ?? ''}'.trim().isNotEmpty &&
              !'${row['delivery_label'] ?? ''}'.contains('غير متاح'),
          maximumDuration: '${row['delivery_window'] ?? ''}'.trim(),
          pricePerKm: null,
          maximumDistanceKm: null,
          regions: ((row['product_availability_regions'] as List?) ?? const [])
              .map((raw) => '${(raw as Map)['city'] ?? ''}'.trim())
              .where((value) => value.isNotEmpty)
              .toList(),
          notes: '${row['delivery_notes'] ?? ''}'.trim(),
        ),
        isNew: row['is_new'] == true,
      );
    }).toList();
    final catalog = CatalogData(
      categoryRows.map((raw) {
        final row = Map<String, dynamic>.from(raw as Map);
        return '${reviewedTranslation(row['product_category_translations'])?['name'] ?? row['name']}';
      }).toList(),
      products,
    );
    if (generation == _catalogGeneration) {
      _catalogCache = catalog;
      _catalogCachedAt = DateTime.now();
    }
    return catalog;
  }

  Future<List<ContractorDirectoryEntry>> loadContractorDirectory() async {
    final response = await http.get(
      Uri.parse(
        '${_appUrl.replaceFirst(RegExp(r'/$'), '')}/api/public/contractors',
      ),
      headers: const {'Accept': 'application/json'},
    );
    Map<String, dynamic> body = const {};
    try {
      body = jsonDecode(response.body) as Map<String, dynamic>;
    } catch (_) {
      throw Exception('تعذر قراءة دليل المقاولين من المنصة.');
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception(
        '${body['message'] ?? 'تعذر تحميل دليل المقاولين حاليًا.'}',
      );
    }
    return ((body['contractors'] as List?) ?? const [])
        .map(
          (value) => ContractorDirectoryEntry.fromJson(
            Map<String, dynamic>.from(value as Map),
          ),
        )
        .toList();
  }

  Future<void> signIn(String identifier, String password) async {
    final clean = identifier.trim().toLowerCase();
    if (clean.contains('@')) {
      await client.auth.signInWithPassword(email: clean, password: password);
    } else {
      var digits = clean.replaceAll(RegExp(r'\D'), '');
      if (digits.startsWith('05')) {
        digits = '966${digits.substring(1)}';
      } else if (digits.startsWith('5')) {
        digits = '966$digits';
      }
      if (!RegExp(r'^9665\d{8}$').hasMatch(digits)) {
        throw AuthException(
          'أدخل بريدًا إلكترونيًا صحيحًا أو رقم جوال سعوديًا.',
        );
      }
      await client.auth.signInWithPassword(
        phone: '+$digits',
        password: password,
      );
    }
    try {
      await client.rpc('mark_driver_activity');
    } catch (_) {}
  }

  bool get appleSignInAvailable => supportsNativeAppleSignIn;

  Future<void> signInWithApple() async {
    await AppleAuthService(client).signIn();
    notifyDataChanged();
  }

  Future<bool> registerCustomer({
    required String fullName,
    required String email,
    required String phone,
    required String username,
    required String password,
  }) async {
    final response = await http.post(
      Uri.parse('${_appUrl.replaceFirst(RegExp(r'/$'), '')}/api/auth/register'),
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key':
            'app${DateTime.now().microsecondsSinceEpoch}${Random.secure().nextInt(999999)}',
      },
      body: jsonEncode({
        'fullName': fullName.trim(),
        'email': email.trim().toLowerCase(),
        'phone': phone.trim(),
        'username': username.trim().replaceAll(RegExp(r'\s+'), '_'),
        'password': password,
      }),
    );
    Map<String, dynamic> body = const {};
    try {
      body = jsonDecode(response.body) as Map<String, dynamic>;
    } catch (_) {}
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception('${body['message'] ?? 'تعذر إنشاء الحساب حاليًا'}');
    }
    _pendingVerificationPhone = '${body['phone'] ?? phone}'.trim();
    _pendingVerificationCodeSent = body['verificationSent'] == true;
    await signIn(email, password);
    notifyDataChanged();
    return _pendingVerificationCodeSent;
  }

  bool get hasVerifiedPhone {
    final current = user;
    return current != null &&
        (current.phone?.trim().isNotEmpty ?? false) &&
        current.phoneConfirmedAt != null;
  }

  Future<bool> requiresPhoneVerification() async {
    if (user == null || hasVerifiedPhone) return false;
    final row = await client
        .from('profiles')
        .select('role')
        .eq('id', user!.id)
        .maybeSingle();
    final role = '${row?['role'] ?? ''}';
    return row == null || role == 'customer' || role == 'provider';
  }

  Future<String> requestPhoneVerification(String phone) async {
    final body = await _authenticatedPost(
      '/api/auth/phone-verification/request',
      {'phone': phone.trim()},
      includeIdempotencyKey: true,
    );
    _pendingVerificationPhone = '${body['phone'] ?? phone}'.trim();
    _pendingVerificationCodeSent = true;
    return '${body['message'] ?? 'تم إرسال رمز التحقق عبر واتساب.'}';
  }

  Future<void> completePhoneVerification(String code) async {
    await _authenticatedPost('/api/auth/phone-verification/complete', {
      'code': code.trim(),
    });
    _pendingVerificationPhone = '';
    _pendingVerificationCodeSent = false;
    await client.auth.refreshSession();
    notifyDataChanged();
  }

  Future<Map<String, dynamic>> _authenticatedPost(
    String path,
    Map<String, dynamic> payload, {
    bool includeIdempotencyKey = false,
  }) async {
    final token = client.auth.currentSession?.accessToken;
    if (token == null || token.isEmpty) {
      throw Exception('انتهت جلسة الدخول. سجل الدخول مجددًا.');
    }
    final headers = <String, String>{
      'Content-Type': 'application/json',
      'Authorization': 'Bearer $token',
    };
    if (includeIdempotencyKey) {
      headers['Idempotency-Key'] =
          'app${DateTime.now().microsecondsSinceEpoch}${Random.secure().nextInt(999999)}';
    }
    late http.Response response;
    try {
      response = await http.post(
        Uri.parse('${_appUrl.replaceFirst(RegExp(r'/$'), '')}$path'),
        headers: headers,
        body: jsonEncode(payload),
      );
    } catch (_) {
      throw Exception('تعذر الاتصال بالمنصة. تحقق من تشغيل الخادم والاتصال.');
    }
    Map<String, dynamic> body = const {};
    try {
      body = jsonDecode(response.body) as Map<String, dynamic>;
    } catch (_) {}
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception('${body['message'] ?? 'تعذر إكمال العملية حاليًا.'}');
    }
    return body;
  }

  Future<void> sendPasswordReset(String email) async {
    late http.Response response;
    try {
      response = await http.post(
        Uri.parse(_passwordRecoveryUrl),
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key':
              'recovery-${DateTime.now().microsecondsSinceEpoch}-${Random.secure().nextInt(999999)}',
        },
        body: jsonEncode({'email': email.trim().toLowerCase()}),
      );
    } catch (_) {
      throw Exception('تعذر الاتصال بالمنصة. تحقق من اتصالك وحاول مجددًا.');
    }
    Map<String, dynamic> body = const {};
    try {
      body = jsonDecode(response.body) as Map<String, dynamic>;
    } catch (_) {}
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception(
        '${body['message'] ?? 'تعذر إرسال رابط الاستعادة الآن. حاول مجددًا بعد قليل.'}',
      );
    }
  }

  Future<void> signOut() async {
    _pendingVerificationPhone = '';
    _pendingVerificationCodeSent = false;
    await client.auth.signOut();
    notifyDataChanged();
  }

  Future<Profile?> loadProfile() async {
    if (user == null) return null;
    final row = await client
        .from('profiles')
        .select(
          'full_name,email,mobile,role,must_change_password,preferred_locale',
        )
        .eq('id', user!.id)
        .maybeSingle();
    if (row == null) return null;
    await BunyaLocaleController.adoptProfileLocale(
      row['preferred_locale'] as String?,
    );
    return Profile(
      name: '${row['full_name'] ?? 'مستخدم بُنية'}',
      email: '${row['email'] ?? user!.email ?? ''}',
      mobile: '${row['mobile'] ?? ''}',
      role: '${row['role'] ?? 'customer'}',
      mustChangePassword: row['must_change_password'] == true,
    );
  }

  Future<void> changePassword(
    String password, {
    required bool completeTemporarySetup,
  }) async {
    await client.auth.updateUser(UserAttributes(password: password));
    if (completeTemporarySetup) {
      await client.rpc('complete_temporary_password_change');
      try {
        await client.rpc('mark_driver_activity');
      } catch (_) {}
    }
    notifyDataChanged();
  }

  Future<ProviderJoinPolicy?> loadProviderJoinPolicy() =>
      _loadJoinPolicy('provider');

  Future<ProviderJoinPolicy?> loadContractorJoinPolicy() =>
      _loadJoinPolicy('contractor');

  Future<ProviderJoinPolicy?> _loadJoinPolicy(String kind) async {
    final response = await http
        .get(
          Uri.parse(
            '${_appUrl.replaceFirst(RegExp(r'/$'), '')}/api/public/join/$kind/policy',
          ),
        )
        .timeout(const Duration(seconds: 20));
    if (response.statusCode != 200) {
      throw Exception('تعذر تحميل سياسة الانضمام. أعد المحاولة.');
    }
    final payload = jsonDecode(response.body) as Map<String, dynamic>;
    final policy = payload['policy'];
    return policy == null
        ? null
        : ProviderJoinPolicy.fromJson(policy as Map<String, dynamic>);
  }

  Future<JoinSubmission> submitJoinApplication({
    required String kind,
    required Map<String, String> fields,
    required List<String> regions,
    List<String> categories = const [],
    List<String> specialties = const [],
    Map<String, JoinDocument> documents = const {},
    void Function(double progress)? onUploadProgress,
  }) async {
    final request = http.MultipartRequest(
      'POST',
      Uri.parse(
        '${_appUrl.replaceFirst(RegExp(r'/$'), '')}/api/public/join/$kind',
      ),
    );
    request.headers['Idempotency-Key'] =
        'app${DateTime.now().microsecondsSinceEpoch}${Random.secure().nextInt(999999)}';
    request.fields
      ..addAll(fields)
      ..['regions'] = jsonEncode(regions)
      ..['categories'] = jsonEncode(categories)
      ..['specialties'] = jsonEncode(specialties)
      ..['website'] = '';
    if (kind == 'provider' || kind == 'contractor') {
      if (kind == 'contractor') {
        final error = validateContractorDocuments(
          fields['contractorType'] ?? '',
          documents,
        );
        if (error != null) throw JoinSubmissionException(400, error);
      }
      if (documents.values.any((document) => document.size <= 0)) {
        throw const JoinSubmissionException(400, 'اختر مستندًا غير فارغ');
      }
      final connection = http.Client();
      try {
        final initialize =
            http.MultipartRequest('POST', Uri.parse('${request.url}/uploads'))
              ..headers.addAll(request.headers)
              ..fields.addAll(request.fields);
        initialize.fields['documents'] = jsonEncode(
          documents.entries
              .map(
                (entry) => {
                  'documentType': kind == 'contractor'
                      ? contractorDocumentType(entry.key)
                      : entry.key,
                  if (kind == 'contractor') 'documentKey': entry.key,
                  'name': entry.value.name,
                  'mimeType': entry.value.mimeType,
                  'size': entry.value.size,
                },
              )
              .toList(),
        );
        final initialized = await http.Response.fromStream(
          await connection.send(initialize),
        );
        final upload = jsonDecode(initialized.body) as Map<String, dynamic>;
        if (initialized.statusCode < 200 || initialized.statusCode >= 300) {
          throw JoinSubmissionException(
            initialized.statusCode,
            '${upload['message'] ?? 'تعذر تجهيز المستندات'}',
          );
        }
        final total = documents.values.fold<int>(
          0,
          (sum, document) => sum + document.size,
        );
        var completed = 0;
        final grants = (upload['files'] as List).cast<Map<String, dynamic>>();
        for (final entry in documents.entries) {
          final grant = grants.singleWhere(
            (grant) =>
                grant[kind == 'contractor' ? 'documentKey' : 'documentType'] ==
                entry.key,
          );
          await uploadProviderDocument(
            client: connection,
            endpoint: Uri.parse(upload['endpoint'] as String),
            bucket: upload['bucket'] as String,
            path: grant['path'] as String,
            token: grant['token'] as String,
            document: entry.value,
            onProgress: (uploaded) =>
                onUploadProgress?.call((completed + uploaded) / total),
          );
          completed += entry.value.size;
        }
        request.fields['uploadToken'] = upload['uploadToken'] as String;
      } finally {
        connection.close();
      }
    }
    final streamed = await request.send();
    final response = await http.Response.fromStream(streamed);
    final body = jsonDecode(response.body) as Map<String, dynamic>;
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw JoinSubmissionException(
        response.statusCode,
        '${body['message'] ?? 'تعذر إرسال طلب الانضمام'}',
      );
    }
    final submission = JoinSubmission(
      id: '${body['applicationId']}',
      status: '${body['status']}',
    );
    notifyDataChanged();
    return submission;
  }

  Future<List<QuoteSummary>> loadQuotes() async {
    if (user == null) return const [];
    final rows = await client
        .from('quote_requests')
        .select(
          'id,request_code,status,google_maps_url,created_at,desired_receipt_at',
        )
        .eq('requester_id', user!.id)
        .order('created_at', ascending: false)
        .limit(50);
    return (rows as List).map((raw) {
      final row = raw as Map;
      return QuoteSummary(
        id: '${row['id']}',
        code: '${row['request_code']}',
        status: '${row['status']}',
        city: row['google_maps_url'] == null
            ? 'الموقع غير مكتمل'
            : 'موقع Google Maps معتمد',
        createdAt: DateTime.tryParse('${row['created_at']}') ?? DateTime.now(),
        requiredAt:
            DateTime.tryParse('${row['desired_receipt_at']}') ?? DateTime.now(),
      );
    }).toList();
  }

  Future<List<Map<String, dynamic>>> loadCustomerDeliveries() async {
    if (user == null) return const [];
    final rows = await client.rpc('get_customer_deliveries');
    return (rows as List)
        .map((row) => Map<String, dynamic>.from(row as Map))
        .toList();
  }

  Future<Map<String, dynamic>?> loadCustomerDeliveryTracking(
    String requestId,
  ) async {
    if (user == null) return null;
    final rows = await client.rpc(
      'get_customer_delivery_tracking',
      params: {'p_customer_quote_id': null, 'p_request_id': requestId},
    );
    final values = rows as List;
    return values.isEmpty
        ? null
        : Map<String, dynamic>.from(values.first as Map);
  }

  Future<String> loadCustomerDeliveryCode(String deliveryId) async {
    final token = client.auth.currentSession?.accessToken;
    if (token == null || token.isEmpty) {
      throw Exception('انتهت جلسة الدخول. سجل الدخول مجددًا.');
    }
    final response = await http.get(
      Uri.parse(
        '${_appUrl.replaceFirst(RegExp(r'/$'), '')}/api/customer/deliveries/$deliveryId/code',
      ),
      headers: {'Authorization': 'Bearer $token'},
    );
    Map<String, dynamic> body = const {};
    try {
      body = jsonDecode(response.body) as Map<String, dynamic>;
    } catch (_) {
      throw Exception('تعذر قراءة رمز التسليم من المنصة.');
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception('${body['error'] ?? 'رمز التسليم غير متاح حاليًا.'}');
    }
    final code = '${body['code'] ?? ''}'.trim();
    if (!RegExp(r'^\d{6}$').hasMatch(code)) {
      throw Exception('رمز التسليم غير متاح حاليًا.');
    }
    return code;
  }

  Future<bool> confirmDeliveryCode(String deliveryId, String plainCode) async {
    final token = client.auth.currentSession?.accessToken;
    if (token == null || token.isEmpty) {
      throw Exception('انتهت جلسة الدخول. سجل الدخول مجددًا.');
    }
    final response = await http.post(
      Uri.parse(
        '${_appUrl.replaceFirst(RegExp(r'/$'), '')}/api/deliveries/$deliveryId/confirm',
      ),
      headers: {
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json',
      },
      body: jsonEncode({'code': plainCode.replaceAll(RegExp(r'\D'), '')}),
    );
    Map<String, dynamic> body = const {};
    try {
      body = jsonDecode(response.body) as Map<String, dynamic>;
    } catch (_) {
      throw Exception('تعذر قراءة استجابة تأكيد التسليم من المنصة.');
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception('${body['error'] ?? 'تعذر تأكيد التسليم حاليًا.'}');
    }
    final accepted = body['accepted'] == true;
    if (accepted) notifyDataChanged();
    return accepted;
  }

  Future<QuoteDetail> loadQuoteDetail(QuoteSummary summary) async {
    final request = await client
        .from('quote_requests')
        .select(
          'location_hint,google_maps_url,delivery_mode,notes,quote_deadline,pricing_opens_at,pricing_countdown_starts_at,recipient_name,recipient_mobile,site_responsible_name,site_responsible_mobile,contractor_name,contractor_mobile,working_hours,loading_option,unloading_option,road_access,access_instructions,delivery_details_acknowledged_at',
        )
        .eq('id', summary.id)
        .single();
    final itemRows = await client
        .from('quote_request_items')
        .select(
          'product_name_snapshot,measurement_label_snapshot,unit_name_snapshot,quantity,notes',
        )
        .eq('request_id', summary.id)
        .order('created_at');
    final offerRow = await client
        .from('bunya_customer_quotes')
        .select(
          'id,quote_code,status,subtotal,vat_amount,delivery_fee,total,valid_until,expected_delivery_at,orders(payment_status)',
        )
        .eq('customer_request_id', summary.id)
        .maybeSingle();
    final items = (itemRows as List).map((raw) {
      final row = raw as Map;
      return QuoteItemDetail(
        name: '${row['product_name_snapshot']}',
        quantity: (row['quantity'] as num).toDouble(),
        unit: '${row['unit_name_snapshot']}',
        measurement: '${row['measurement_label_snapshot'] ?? ''}',
        notes: '${row['notes'] ?? ''}',
      );
    }).toList();
    final offer = offerRow == null
        ? null
        : QuoteOfferDetail(
            id: '${offerRow['id']}',
            code: '${offerRow['quote_code']}',
            status: '${offerRow['status']}',
            subtotal: (offerRow['subtotal'] as num).toDouble(),
            vat: (offerRow['vat_amount'] as num).toDouble(),
            delivery: (offerRow['delivery_fee'] as num).toDouble(),
            total: (offerRow['total'] as num).toDouble(),
            validUntil:
                DateTime.tryParse('${offerRow['valid_until']}') ??
                DateTime.now(),
            expectedDelivery:
                DateTime.tryParse('${offerRow['expected_delivery_at']}') ??
                summary.requiredAt,
            paymentStatus: _quoteOrderPaymentStatus(offerRow['orders']),
          );
    return QuoteDetail(
      summary: summary,
      location: '${request['location_hint'] ?? summary.city}',
      mapsUrl: '${request['google_maps_url'] ?? ''}',
      deliveryMode: '${request['delivery_mode'] ?? 'delivery'}',
      notes: '${request['notes'] ?? ''}',
      deadline:
          DateTime.tryParse('${request['quote_deadline']}') ??
          summary.createdAt,
      pricingOpensAt:
          DateTime.tryParse('${request['pricing_opens_at']}') ??
          summary.createdAt,
      pricingCountdownStartsAt:
          DateTime.tryParse('${request['pricing_countdown_starts_at']}') ??
          summary.createdAt,
      recipientName: '${request['recipient_name'] ?? ''}',
      recipientMobile: '${request['recipient_mobile'] ?? ''}',
      siteResponsibleName: '${request['site_responsible_name'] ?? ''}',
      siteResponsibleMobile: '${request['site_responsible_mobile'] ?? ''}',
      contractorName: '${request['contractor_name'] ?? ''}',
      contractorMobile: '${request['contractor_mobile'] ?? ''}',
      workingHours: '${request['working_hours'] ?? ''}',
      loadingOption: '${request['loading_option'] ?? ''}',
      unloadingOption: '${request['unloading_option'] ?? ''}',
      roadAccess: '${request['road_access'] ?? ''}',
      accessInstructions: '${request['access_instructions'] ?? ''}',
      acknowledgedAt: DateTime.tryParse(
        '${request['delivery_details_acknowledged_at'] ?? ''}',
      ),
      items: items,
      offer: offer,
    );
  }

  String _quoteOrderPaymentStatus(dynamic orders) {
    if (orders is Map) {
      return '${orders['payment_status'] ?? 'pending'}';
    }
    if (orders is List && orders.isNotEmpty && orders.first is Map) {
      return '${(orders.first as Map)['payment_status'] ?? 'pending'}';
    }
    return 'pending';
  }

  Future<List<AppNotification>> loadNotifications() async {
    if (user == null) return const [];
    final rows = await client
        .from('notifications')
        .select(
          'id,title,message,created_at,read_at,action_url,entity_type,entity_id',
        )
        .eq('profile_id', user!.id)
        .order('created_at', ascending: false)
        .limit(80);
    final items = (rows as List).map((raw) {
      final row = raw as Map;
      return AppNotification(
        id: '${row['id']}',
        source: 'notifications',
        title: '${row['title']}',
        message: '${row['message']}',
        createdAt: DateTime.tryParse('${row['created_at']}') ?? DateTime.now(),
        read: row['read_at'] != null,
        actionUrl: row['action_url'] as String?,
        entityType: row['entity_type'] as String?,
        entityId: row['entity_id'] == null ? null : '${row['entity_id']}',
      );
    }).toList();
    final profile = await client
        .from('profiles')
        .select('role')
        .eq('id', user!.id)
        .maybeSingle();
    final role = '${profile?['role'] ?? ''}';
    if (role == 'customer') {
      final customerRows = await client
          .from('customer_notifications')
          .select('id,title,message,created_at,read_at,action_url')
          .eq('customer_profile_id', user!.id)
          .order('created_at', ascending: false)
          .limit(80);
      items.addAll(
        (customerRows as List).map((raw) {
          final row = raw as Map;
          return AppNotification(
            id: '${row['id']}',
            source: 'customer_notifications',
            title: '${row['title']}',
            message: '${row['message']}',
            createdAt:
                DateTime.tryParse('${row['created_at']}') ?? DateTime.now(),
            read: row['read_at'] != null,
            actionUrl: row['action_url'] as String?,
          );
        }),
      );
    } else if (role == 'contractor') {
      final contractor = await client
          .from('contractor_profiles')
          .select('id')
          .eq('profile_id', user!.id)
          .maybeSingle();
      if (contractor != null) {
        final contractorRows = await client
            .from('contractor_notifications')
            .select('id,title,message,created_at,read_at,link')
            .eq('contractor_profile_id', contractor['id'])
            .order('created_at', ascending: false)
            .limit(80);
        items.addAll(
          (contractorRows as List).map((raw) {
            final row = raw as Map;
            return AppNotification(
              id: '${row['id']}',
              source: 'contractor_notifications',
              title: '${row['title']}',
              message: '${row['message']}',
              createdAt:
                  DateTime.tryParse('${row['created_at']}') ?? DateTime.now(),
              read: row['read_at'] != null,
              actionUrl: row['link'] as String?,
            );
          }),
        );
      }
    }
    items.sort((a, b) => b.createdAt.compareTo(a.createdAt));
    return items.take(100).toList();
  }

  Future<void> markNotificationRead(AppNotification notification) async =>
      client
          .from(notification.source)
          .update({'read_at': DateTime.now().toUtc().toIso8601String()})
          .eq('id', notification.id);

  Future<String> submitQuote({
    required List<MobileQuoteItem> items,
    required QuoteSubmissionDetails details,
  }) async {
    if (user == null) throw const AuthException('Authentication required');
    if (items.isEmpty) {
      throw const FormatException('أضف منتجًا واحدًا على الأقل');
    }
    final recipientMobile = _normalizeSaudiMobile(details.recipientMobile);
    final responsibleMobile = _normalizeSaudiMobile(
      details.siteResponsibleMobile,
    );
    final contractorMobile = details.contractorMobile.trim().isEmpty
        ? ''
        : _normalizeSaudiMobile(details.contractorMobile);
    if (recipientMobile == null || responsibleMobile == null) {
      throw const FormatException('أرقام التواصل السعودية غير صحيحة');
    }
    if (details.contractorMobile.trim().isNotEmpty &&
        contractorMobile == null) {
      throw const FormatException('رقم جوال المقاول غير صحيح');
    }
    final result = await client.rpc(
      'submit_storefront_rfq',
      params: {
        'p_request': {
          'location_hint': details.locationHint.trim(),
          'google_maps_url': details.mapsUrl.trim(),
          'desired_receipt_at': details.requiredAt.toUtc().toIso8601String(),
          'delivery_mode': details.delivery ? 'delivery' : 'pickup',
          'project_name': details.projectName.trim(),
          'recipient_name': details.recipientName.trim(),
          'recipient_mobile': recipientMobile,
          'site_responsible_name': details.siteResponsibleName.trim(),
          'site_responsible_mobile': responsibleMobile,
          'contractor_name': details.contractorName.trim(),
          'contractor_mobile': contractorMobile ?? '',
          'working_hours': details.workingHours.trim(),
          'loading_option': details.loadingOption,
          'unloading_option': details.unloadingOption,
          'road_access': details.roadAccess,
          'access_instructions': details.accessInstructions.trim(),
          'driver_departure_liability_accepted': true,
          'data_accuracy_accepted': true,
          'notes': details.notes.trim(),
        },
        'p_items': items
            .map(
              (item) => {
                'product_id': item.product.id,
                'quantity': item.quantity,
                'unit': item.unit,
                'measurement': item.measurement?.label ?? '',
                'measurement_id': item.measurement?.id ?? '',
                'variant_ids': item.selectedVariants
                    .map((variant) => variant.id)
                    .toList(),
                'unit_id': '',
                'notes': item.notes.trim(),
              },
            )
            .toList(),
        'p_idempotency_key':
            'mobile-${user!.id}-${DateTime.now().microsecondsSinceEpoch}',
      },
    );
    notifyDataChanged();
    final request = await client
        .from('quote_requests')
        .select('quote_window_label')
        .eq('id', '$result')
        .eq('requester_id', user!.id)
        .maybeSingle();
    return '${request?['quote_window_label'] ?? ''}';
  }
}

String? _normalizeSaudiMobile(String value) {
  var digits = value.replaceAll(RegExp(r'\D'), '');
  if (digits.startsWith('00966')) digits = digits.substring(2);
  if (digits.startsWith('966')) digits = digits.substring(3);
  if (digits.startsWith('0')) digits = digits.substring(1);
  return RegExp(r'^5\d{8}$').hasMatch(digits) ? '+966$digits' : null;
}

String _catalogAvailabilityLabel(String value) =>
    const {
      'available': 'متوفر',
      'limited': 'كمية محدودة',
      'on_request': 'حسب الطلب',
    }[value] ??
    'حسب الطلب';

String _formatCatalogDuration(num? value, String unit) {
  if (value == null || unit.trim().isEmpty) return '';
  final amount = value % 1 == 0 ? value.toInt().toString() : '$value';
  final label =
      const {
        'hour': 'ساعة',
        'day': 'يوم',
        'week': 'أسبوع',
        'month': 'شهر',
        'year': 'سنة',
      }[unit] ??
      unit;
  return '$amount $label';
}
