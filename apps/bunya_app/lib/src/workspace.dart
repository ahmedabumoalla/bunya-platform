import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';
import 'package:image_picker/image_picker.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:url_launcher/url_launcher.dart';

import 'brand_logo.dart';
import 'data.dart';
import 'product_image_urls.dart';
import 'push_service.dart';
import 'theme.dart';
import 'localization.dart';

const _apiUrl = String.fromEnvironment(
  'APP_URL',
  defaultValue: 'https://www.buniahksa.com',
);

class RoleContext {
  const RoleContext({
    required this.role,
    required this.name,
    required this.entityId,
  });
  final String role, name;
  final String? entityId;
}

class WorkspaceModule {
  const WorkspaceModule({
    required this.title,
    required this.caption,
    required this.icon,
    required this.table,
    this.filterField,
    this.filterValue,
    this.action,
  });
  final String title, caption, table;
  final IconData icon;
  final String? filterField, filterValue;
  final String? action;
}

class WorkspaceRepository {
  WorkspaceRepository(this.client);
  final SupabaseClient client;

  void _changed() => BunyaRepository.notifyDataChanged();

  Future<String> startQuotePayment(
    String quoteId, {
    required bool acceptFirst,
    String? returnUrl,
  }) async {
    if (acceptFirst) {
      final current = await client
          .from('bunya_customer_quotes')
          .select('status')
          .eq('id', quoteId)
          .single();
      final currentStatus = '${current['status'] ?? ''}';
      if (currentStatus == 'ready' || currentStatus == 'customer_review') {
        final accepted = await client.rpc(
          'accept_customer_quote',
          params: {
            'p_quote_id': quoteId,
            'p_idempotency_key':
                'mobile-${DateTime.now().microsecondsSinceEpoch}',
          },
        );
        if (accepted == null) throw Exception('payment_accept_failed');
      } else if (currentStatus != 'accepted') {
        throw Exception('payment_quote_unavailable');
      }
    }
    final token = client.auth.currentSession?.accessToken;
    if (token == null || token.isEmpty) {
      throw Exception('payment_session_expired');
    }
    final response = await http.post(
      Uri.parse(
        '${_apiUrl.replaceFirst(RegExp(r'/$'), '')}/api/payments/paymob/intention',
      ),
      headers: {
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json',
      },
      body: jsonEncode({
        'quoteId': quoteId,
        if (returnUrl != null && returnUrl.trim().isNotEmpty)
          'returnUrl': returnUrl.trim(),
      }),
    );
    final body = jsonDecode(response.body) as Map<String, dynamic>;
    if (body['status'] == 'succeeded') return 'succeeded';
    final checkoutUrl = '${body['checkoutUrl'] ?? ''}'.trim();
    if (response.statusCode < 200 ||
        response.statusCode >= 300 ||
        checkoutUrl.isEmpty) {
      throw Exception('${body['message'] ?? 'payment_start_failed'}');
    }
    _changed();
    return checkoutUrl;
  }

  Future<String> reconcileQuotePayment(String quoteId) async {
    final token = client.auth.currentSession?.accessToken;
    if (token == null || token.isEmpty) return 'pending';
    final response = await http.post(
      Uri.parse(
        '${_apiUrl.replaceFirst(RegExp(r'/$'), '')}/api/payments/paymob/reconcile',
      ),
      headers: {
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json',
      },
      body: jsonEncode({'quoteId': quoteId}),
    );
    if (response.statusCode < 200 || response.statusCode >= 300) {
      return 'pending';
    }
    final body = jsonDecode(response.body) as Map<String, dynamic>;
    final status = '${body['status'] ?? 'pending'}';
    _changed();
    return status;
  }

  Future<RoleContext> resolve(Profile profile) async {
    final userId = client.auth.currentUser!.id;
    if (profile.role == 'provider') {
      final row = await client
          .from('provider_members')
          .select('provider_id,providers(company_name)')
          .eq('profile_id', userId)
          .eq('is_active', true)
          .limit(1)
          .maybeSingle();
      final provider = row?['providers'];
      return RoleContext(
        role: 'provider',
        name: provider is Map
            ? '${provider['company_name'] ?? profile.name}'
            : profile.name,
        entityId: row == null ? null : '${row['provider_id']}',
      );
    }
    if (profile.role == 'contractor') {
      final row = await client
          .from('contractor_profiles')
          .select('id,display_name')
          .eq('profile_id', userId)
          .limit(1)
          .maybeSingle();
      return RoleContext(
        role: 'contractor',
        name: '${row?['display_name'] ?? profile.name}',
        entityId: row == null ? null : '${row['id']}',
      );
    }
    if (profile.role == 'driver') {
      final row = await client
          .from('provider_driver_accounts')
          .select('driver_id,provider_drivers(full_name,provider_id)')
          .eq('auth_user_id', userId)
          .limit(1)
          .maybeSingle();
      final driver = row?['provider_drivers'];
      return RoleContext(
        role: 'driver',
        name: driver is Map
            ? '${driver['full_name'] ?? profile.name}'
            : profile.name,
        entityId: row == null ? null : '${row['driver_id']}',
      );
    }
    if (profile.role == 'admin') {
      return RoleContext(role: 'admin', name: profile.name, entityId: userId);
    }
    return RoleContext(
      role: profile.role,
      name: profile.name,
      entityId: userId,
    );
  }

  Future<Map<String, int>> metrics(RoleContext context) async {
    Future<int> count(
      String table, {
      String? field,
      String? value,
      String? statusField,
      List<String>? statuses,
    }) async {
      dynamic query = client.from(table).select('id');
      if (field != null && value != null) query = query.eq(field, value);
      if (statusField != null && statuses != null) {
        query = query.inFilter(statusField, statuses);
      }
      try {
        final rows = await query.limit(500).timeout(const Duration(seconds: 5));
        return (rows as List).length;
      } catch (_) {
        return -1;
      }
    }

    if (context.role == 'provider') {
      final values = await Future.wait<int>([
        count('products', field: 'provider_id', value: context.entityId),
        count(
          'internal_sourcing_request_targets',
          field: 'provider_id',
          value: context.entityId,
        ),
        count(
          'internal_fulfillment_orders',
          field: 'provider_id',
          value: context.entityId,
        ),
      ]);
      return {
        'المنتجات': values[0],
        'طلبات التسعير': values[1],
        'أوامر التوريد': values[2],
      };
    }
    if (context.role == 'contractor') {
      Future<int> opportunityCount() async {
        try {
          final rows = await client
              .rpc('get_contractor_opportunities')
              .timeout(const Duration(seconds: 5));
          return (rows as List).length;
        } catch (_) {
          return -1;
        }
      }

      final values = await Future.wait<int>([
        opportunityCount(),
        count(
          'contractor_proposals',
          field: 'contractor_profile_id',
          value: context.entityId,
        ),
        count(
          'contractor_projects',
          field: 'contractor_profile_id',
          value: context.entityId,
        ),
      ]);
      return {'الفرص': values[0], 'العروض': values[1], 'المشاريع': values[2]};
    }
    if (context.role == 'driver') {
      try {
        final rows = await driverDeliveries();
        return {
          'المهام النشطة': rows
              .where(
                (row) => !const {
                  'delivered',
                  'failed_delivery',
                }.contains('${row['delivery_status']}'),
              )
              .length,
          'وصلت للموقع': rows
              .where((row) => row['delivery_status'] == 'arrived')
              .length,
          'تم تسليمها': rows
              .where((row) => row['delivery_status'] == 'delivered')
              .length,
        };
      } catch (_) {
        return {'المهام النشطة': -1, 'وصلت للموقع': -1, 'تم تسليمها': -1};
      }
    }
    final values = await Future.wait<int>([
      count(
        'provider_applications',
        statusField: 'status',
        statuses: ['pending', 'needs_changes'],
      ),
      count(
        'contractor_applications',
        statusField: 'status',
        statuses: ['pending', 'needs_changes'],
      ),
      count(
        'products',
        statusField: 'review_status',
        statuses: ['pending_review'],
      ),
    ]);
    return {
      'طلبات المزودين': values[0],
      'طلبات المقاولين': values[1],
      'مراجعة المنتجات': values[2],
    };
  }

  Future<List<Map<String, dynamic>>> loadModule(
    WorkspaceModule module, {
    String? recordId,
  }) async {
    final isProducts = module.table == 'products';
    final isProductChanges = module.table == 'product_change_requests';
    final isQuoteRequests = module.table == 'quote_requests';
    final selection = isProducts
        ? '*,providers(company_name,contact_name,mobile,email),product_categories(id,name,slug),product_images(id,label,alt_text,tone,image_url,storage_path,file_name,mime_type,file_size_bytes,is_primary,sort_order),product_units(name,is_base,sort_order),product_measurements(label,is_default,sort_order,product_units(name)),product_variants(name,sku,attributes,is_active,sort_order),product_specifications(value,sort_order),product_warranties(label,duration,details),product_availability_regions(city,scope),product_delivery_configs(is_available,maximum_duration,duration_unit,price_per_km,maximum_distance_km,notes),product_delivery_regions(region_name),product_review_history(from_status,to_status,notes,changed_at),product_change_requests(id,status,created_at)'
        : isProductChanges
        ? '*,products(id,name,sku),providers(company_name)'
        : isQuoteRequests
        ? '*,quote_request_items(product_name_snapshot,product_name_translations,measurement_label_snapshot,measurement_label_translations,variant_label_snapshot,variant_selections,unit_name_snapshot,unit_name_translations,quantity,notes),bunya_customer_quotes(id,quote_code,subtotal,vat_amount,delivery_fee,total,valid_until,expected_delivery_at,status,processing_stage,orders(id,order_code,payment_status))'
        : '*';
    dynamic query = client.from(module.table).select(selection);
    if (recordId != null) query = query.eq('id', recordId);
    if (module.filterField != null && module.filterValue != null) {
      query = query.eq(module.filterField!, module.filterValue!);
    }
    if (module.table == 'contractor_documents') {
      query = query.eq('is_current', true);
    }
    final rows = await query.limit(80);
    final records = (rows as List)
        .map((row) => Map<String, dynamic>.from(row as Map))
        .toList()
        .reversed
        .toList();
    if (!isProducts) return records;

    final paths = <String>{};
    for (final row in records) {
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
      if (images.isEmpty) continue;
      row['_primary_image'] = images.first;
      final path = '${images.first['storage_path'] ?? ''}'.trim();
      if (path.isNotEmpty) paths.add(path);
    }
    final signedResults = await Future.wait([
      ProductImageUrls.thumbnails(client, paths),
      ProductImageUrls.originals(client, paths),
    ]);
    final signedUrls = signedResults[0];
    final originalUrls = signedResults[1];
    for (final row in records) {
      final image = row['_primary_image'];
      if (image is! Map) continue;
      final path = '${image['storage_path'] ?? ''}'.trim();
      final directUrl = '${image['image_url'] ?? ''}'.trim();
      final thumbnailUrl = (signedUrls[path] ?? '').trim();
      row['_image_url'] = thumbnailUrl.isNotEmpty ? thumbnailUrl : directUrl;
      row['_image_fallback_url'] = originalUrls[path] ?? directUrl;
      final imageId = '${image['id'] ?? ''}'.trim();
      row['_image_cache_key'] = path.isNotEmpty
          ? '$path:$imageId'
          : '$directUrl:$imageId';
    }
    return records;
  }

  Future<List<Map<String, dynamic>>> loadAdminProviderFinance() async {
    final result = await client.rpc('admin_provider_financial_summary');
    return (result as List)
        .map((row) => Map<String, dynamic>.from(row as Map))
        .toList();
  }

  Future<void> setProviderCommission(String providerId, double rate) async {
    await client.rpc(
      'admin_set_provider_commission',
      params: {'p_provider_id': providerId, 'p_rate': rate},
    );
    _changed();
  }

  Future<void> reviewProduct(String id, String decision, String reason) async {
    await client.rpc(
      'review_product',
      params: {
        'p_product_id': id,
        'p_decision': decision,
        'p_reason': reason,
        'p_idempotency_key':
            'app-review-${DateTime.now().microsecondsSinceEpoch}',
      },
    );
    _changed();
  }

  Future<void> requestProductChange({
    required Map<String, dynamic> product,
    required String name,
    required String categoryId,
    required String? customCategory,
    required String baseUnit,
    required String description,
    required String? sku,
    required double? minimumOrder,
    required double? stockQuantity,
    required String availabilityStatus,
    required String leadTime,
    required String deliveryWindow,
    required String deliveryNotes,
    required String offerType,
    required double? rentalDuration,
    required String? rentalDurationUnit,
    required List<String> measurements,
    required List<Map<String, String>> variants,
    required List<String> specifications,
    required String? warrantyDuration,
    required String? warrantyDetails,
    required List<String> retainedImageIds,
    required List<Map<String, String>> availabilityRegions,
    required List<String> deliveryRegions,
    required bool deliveryAvailable,
    required double? deliveryMaximumDuration,
    required String? deliveryDurationUnit,
    required double? deliveryPricePerKm,
    required double? deliveryMaximumDistanceKm,
    required String? deliveryConfigNotes,
    required String? requestNote,
    Uint8List? imageBytes,
    String? imageName,
    String? imageMime,
  }) async {
    final token = client.auth.currentSession?.accessToken;
    if (token == null || token.isEmpty) {
      throw Exception('انتهت جلسة الدخول. سجل الدخول ثم أعد المحاولة.');
    }
    final productId = '${product['id']}';
    final uri = Uri.parse(
      '${_apiUrl.replaceFirst(RegExp(r'/$'), '')}/api/provider/products/$productId/change-requests',
    );
    final request = http.MultipartRequest('POST', uri)
      ..headers['Authorization'] = 'Bearer $token'
      ..headers['Idempotency-Key'] =
          'app-product-change-${DateTime.now().microsecondsSinceEpoch}';
    String encodeNumber(double? value) => value == null ? '' : value.toString();
    request.fields.addAll({
      'name': name,
      'category_id': categoryId,
      'custom_category': customCategory ?? '',
      'base_unit': baseUnit,
      'description': description,
      'sku': sku ?? '',
      'minimum_order': encodeNumber(minimumOrder),
      'stock_quantity': encodeNumber(stockQuantity),
      'availability_status': availabilityStatus,
      'lead_time_label': leadTime,
      'delivery_window': deliveryWindow,
      'delivery_notes': deliveryNotes,
      'offer_type': offerType,
      'rental_duration_value': encodeNumber(rentalDuration),
      'rental_duration_unit': rentalDurationUnit ?? '',
      'measurements': jsonEncode(measurements),
      'variants': jsonEncode(variants),
      'retained_image_ids': jsonEncode(retainedImageIds),
      'availability_regions': jsonEncode(availabilityRegions),
      'delivery_regions': jsonEncode([
        for (final region in deliveryRegions) {'region_name': region},
      ]),
      'delivery_available': '$deliveryAvailable',
      'delivery_maximum_duration': encodeNumber(deliveryMaximumDuration),
      'delivery_duration_unit': deliveryDurationUnit ?? '',
      'delivery_price_per_km': encodeNumber(deliveryPricePerKm),
      'delivery_maximum_distance_km': encodeNumber(deliveryMaximumDistanceKm),
      'delivery_config_notes': deliveryConfigNotes ?? '',
      'warranty_duration': warrantyDuration ?? '',
      'warranty_details': warrantyDetails ?? '',
      'request_note': requestNote ?? '',
    });
    const specificationInputs = {
      'GTIN / الباركود': 'gtin',
      'المصنّع / العلامة': 'manufacturer',
      'بلد المنشأ': 'country_of_origin',
      'المادة / التركيبة': 'material',
      'الدرجة / الفئة': 'grade',
      'الوزن': 'weight',
      'اللون / التشطيب': 'color',
      'التعبئة': 'packaging',
      'المواصفة أو شهادة المطابقة': 'standard_reference',
      'الاستخدام المخصص': 'intended_use',
      'السلامة والمناولة': 'safety_notes',
      'شروط التخزين': 'storage_conditions',
    };
    for (final specification in specifications) {
      for (final entry in specificationInputs.entries) {
        final prefix = '${entry.key}:';
        if (specification.startsWith(prefix)) {
          request.fields[entry.value] = specification
              .substring(prefix.length)
              .trim();
        }
      }
    }
    if (imageBytes != null && imageName != null && imageMime != null) {
      request.files.add(
        http.MultipartFile.fromBytes(
          'images',
          imageBytes,
          filename: imageName,
          contentType: MediaType.parse(imageMime),
        ),
      );
    }
    final streamed = await request.send();
    final response = await http.Response.fromStream(streamed);
    final payload = jsonDecode(response.body) as Map<String, dynamic>;
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception('${payload['error'] ?? 'تعذر إرسال طلب تعديل المنتج.'}');
    }
    _changed();
  }

  Future<void> reviewProductChange(
    String id,
    String decision,
    String reason,
  ) async {
    final token = client.auth.currentSession?.accessToken;
    if (token == null || token.isEmpty) {
      throw Exception('انتهت جلسة الدخول. سجل الدخول ثم أعد المحاولة.');
    }
    final response = await http.post(
      Uri.parse(
        '${_apiUrl.replaceFirst(RegExp(r'/$'), '')}/api/admin/product-change-requests/$id/review',
      ),
      headers: {
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json',
        'Idempotency-Key':
            'app-product-change-review-${DateTime.now().microsecondsSinceEpoch}',
      },
      body: jsonEncode({'decision': decision, 'reason': reason}),
    );
    final payload = jsonDecode(response.body) as Map<String, dynamic>;
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception(
        '${payload['error'] ?? 'تعذر حفظ قرار مراجعة التعديلات.'}',
      );
    }
    _changed();
  }

  Future<void> updateProductCategory(
    String productId,
    String categoryId,
  ) async {
    await client.rpc(
      'admin_update_product_category',
      params: {'p_product_id': productId, 'p_category_id': categoryId},
    );
    _changed();
  }

  Future<List<Map<String, dynamic>>> productCategories() async {
    final rows = await client
        .from('product_categories')
        .select('id,name,slug')
        .eq('is_active', true)
        .order('sort_order');
    return (rows as List)
        .map((row) => Map<String, dynamic>.from(row as Map))
        .toList();
  }

  Future<void> createProviderProduct({
    required String providerId,
    required String name,
    required String categoryId,
    required String categoryTone,
    required String baseUnit,
    required String description,
    required String? sku,
    required double? minimumOrder,
    required double? stockQuantity,
    required String availabilityStatus,
    required String leadTime,
    required String deliveryWindow,
    required String deliveryNotes,
    required String offerType,
    required double? rentalDuration,
    required String? rentalDurationUnit,
    required List<String> measurements,
    required List<Map<String, String>> variants,
    required List<String> specifications,
    required String? warrantyDuration,
    required String? warrantyDetails,
    required Uint8List imageBytes,
    required String imageName,
    required String imageMime,
  }) async {
    final userId = client.auth.currentUser!.id;
    final stamp = DateTime.now().microsecondsSinceEpoch;
    String? productId, imagePath;
    try {
      final availability = availabilityStatus == 'limited'
          ? 'كمية محدودة: ${stockQuantity ?? 0} $baseUnit'
          : availabilityStatus == 'on_request'
          ? 'متوفر حسب الطلب'
          : availabilityStatus == 'unavailable'
          ? 'غير متوفر حاليًا'
          : 'متوفر لدى المزود';
      final inserted = await client
          .from('products')
          .insert({
            'provider_id': providerId,
            'created_by': userId,
            'category_id': categoryId,
            'custom_category': null,
            'slug': 'app-product-$stamp',
            'sku': sku,
            'name': name,
            'base_unit': baseUnit,
            'short_description': description,
            'description': description,
            'full_description': description,
            'availability_summary': availability,
            'availability_status': availabilityStatus,
            'lead_time_label': leadTime,
            'delivery_label': 'يتم تنسيق التسليم مع العميل',
            'delivery_window': deliveryWindow,
            'delivery_notes': deliveryNotes,
            'offer_type': offerType,
            'minimum_order': minimumOrder,
            'stock_quantity': stockQuantity,
            'rental_duration_value': offerType == 'rental'
                ? rentalDuration
                : null,
            'rental_duration_unit': offerType == 'rental'
                ? rentalDurationUnit
                : null,
            'review_status': 'draft',
            'is_published': false,
            'is_new': true,
          })
          .select('id')
          .single();
      productId = '${inserted['id']}';
      if (measurements.isNotEmpty) {
        final base = await client
            .from('product_units')
            .select('id')
            .eq('product_id', productId)
            .eq('is_base', true)
            .maybeSingle();
        if (base != null) {
          await client.from('product_measurements').insert([
            for (var index = 0; index < measurements.length; index++)
              {
                'product_id': productId,
                'unit_id': base['id'],
                'label': measurements[index],
                'is_default': index == 0,
                'sort_order': index,
              },
          ]);
        }
      }
      if (variants.isNotEmpty) {
        await client.from('product_variants').insert([
          for (var index = 0; index < variants.length; index++)
            {
              'product_id': productId,
              'sku': '${sku?.isNotEmpty == true ? sku : 'APP'}-$stamp-$index',
              'name': '${variants[index]['type']}: ${variants[index]['value']}',
              'attributes': {
                '${variants[index]['type']}': variants[index]['value'],
              },
              'is_active': true,
              'sort_order': index,
            },
        ]);
      }
      if (specifications.isNotEmpty) {
        await client.from('product_specifications').insert([
          for (var index = 0; index < specifications.length; index++)
            {
              'product_id': productId,
              'value': specifications[index],
              'sort_order': index,
            },
        ]);
      }
      if (warrantyDuration?.trim().isNotEmpty == true) {
        await client.from('product_warranties').insert({
          'product_id': productId,
          'label': 'ضمان المنتج',
          'duration': warrantyDuration!.trim(),
          'details': warrantyDetails?.trim().isNotEmpty == true
              ? warrantyDetails!.trim()
              : 'حسب شروط وضمان المزود',
        });
      }
      final safeName = imageName.replaceAll(RegExp(r'[^a-zA-Z0-9._-]'), '-');
      imagePath = '$providerId/$productId/$stamp-$safeName';
      await client.storage
          .from('provider-product-images')
          .uploadBinary(
            imagePath,
            imageBytes,
            fileOptions: FileOptions(contentType: imageMime, upsert: false),
          );
      await client.from('product_images').insert({
        'product_id': productId,
        'label': '$name - الصورة الأساسية',
        'alt_text': 'صورة المنتج $name',
        'tone':
            const {
              'blocks-bricks': 'blocks',
              'electrical': 'electric',
              'tools-equipment': 'tools',
            }[categoryTone] ??
            categoryTone,
        'storage_path': imagePath,
        'file_name': imageName,
        'mime_type': imageMime,
        'file_size_bytes': imageBytes.length,
        'is_primary': true,
        'sort_order': 0,
      });
      await client.rpc(
        'submit_product_for_review',
        params: {'p_product_id': productId},
      );
      _changed();
    } catch (_) {
      if (imagePath != null) {
        try {
          await client.storage.from('provider-product-images').remove([
            imagePath,
          ]);
        } catch (_) {}
      }
      if (productId != null) {
        await client.from('products').delete().eq('id', productId);
      }
      rethrow;
    }
  }

  Future<void> transitionFulfillment(
    String id,
    String status,
    String note,
  ) async {
    await client.rpc(
      'transition_fulfillment_order',
      params: {'p_fulfillment_id': id, 'p_status': status, 'p_note': note},
    );
    _changed();
  }

  Future<Map<String, dynamic>?> providerDeliveryForFulfillment(
    String fulfillmentId,
  ) async {
    final row = await client
        .from('provider_delivery_assignments')
        .select(
          'id,status,expected_at,assigned_at,delivered_at,assigned_driver_id,provider_drivers(full_name,mobile)',
        )
        .eq('fulfillment_order_id', fulfillmentId)
        .maybeSingle();
    return row == null ? null : Map<String, dynamic>.from(row);
  }

  Future<List<Map<String, dynamic>>> providerDrivers() async {
    final rows = await client
        .from('provider_drivers')
        .select('id,full_name,mobile,status,must_change_password')
        .order('full_name');
    return (rows as List)
        .map((row) => Map<String, dynamic>.from(row as Map))
        .toList();
  }

  Future<String> assignDeliveryDriver(
    String fulfillmentId,
    String driverId,
  ) async {
    final token = client.auth.currentSession?.accessToken;
    if (token == null || token.isEmpty) {
      throw Exception('انتهت جلسة الدخول. سجل الدخول مجددًا.');
    }
    final response = await http.post(
      Uri.parse('$_apiUrl/api/provider/deliveries/assign-driver'),
      headers: {
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json',
      },
      body: jsonEncode({'fulfillmentId': fulfillmentId, 'driverId': driverId}),
    );
    final body = jsonDecode(response.body) as Map<String, dynamic>;
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception(
        '${body['error'] ?? 'تعذر إسناد السائق وإرسال الإشعارات'}',
      );
    }
    _changed();
    return '${body['message'] ?? 'تم إسناد الطلب للسائق.'}';
  }

  Future<List<Map<String, dynamic>>> providerRfqs(String providerId) async {
    final rows = await client.rpc('get_my_provider_rfq_list');
    final values = (rows as List)
        .map((row) => Map<String, dynamic>.from(row as Map))
        .toList();
    final images = await ProductImageUrls.thumbnails(
      client,
      values.map((row) => '${row['product_image_storage_path'] ?? ''}'),
    );
    for (final row in values) {
      final path = '${row['product_image_storage_path'] ?? ''}';
      row['signed_image_url'] = images[path] ?? '';
    }
    return values;
  }

  Future<Map<String, dynamic>> providerRfq(String id) async {
    final results = await Future.wait([
      client.rpc(
        'get_provider_rfq_context',
        params: {'p_sourcing_item_id': id},
      ),
      client.rpc(
        'get_my_provider_rfq_response',
        params: {'p_sourcing_item_id': id},
      ),
    ]);
    final target = Map<String, dynamic>.from(results[0] as Map);
    final path = '${target['product_image_storage_path'] ?? ''}';
    if (path.isNotEmpty) {
      final images = await ProductImageUrls.thumbnails(client, [path]);
      target['signed_image_url'] = images[path] ?? '';
    }
    if (results[1] is Map) {
      target['existing_response'] = Map<String, dynamic>.from(
        results[1] as Map,
      );
    }
    return target;
  }

  Future<void> submitProviderPrice({
    required String id,
    required double price,
    required double quantity,
    required double deliveryFee,
    required int preparationHours,
    required int deliveryHours,
    required String notes,
    bool revision = false,
  }) async {
    await client.rpc(
      revision
          ? 'revise_provider_pricing_response'
          : 'submit_provider_pricing_response',
      params: {
        'p_sourcing_item_id': id,
        'p_response': {
          'unit_price': price,
          'vat_inclusive': true,
          'available': true,
          'available_quantity': quantity,
          'preparation_hours': preparationHours,
          'delivery_hours': deliveryHours,
          'delivery_fee': deliveryFee,
          'region_eligible': true,
          'price_expires_at': DateTime.now()
              .add(const Duration(hours: 72))
              .toUtc()
              .toIso8601String(),
          'notes': notes,
        },
      },
    );
    _changed();
  }

  Future<List<Map<String, dynamic>>> contractorOpportunities() async =>
      (await client.rpc('get_contractor_opportunities') as List)
          .map((row) => Map<String, dynamic>.from(row as Map))
          .toList();

  Future<void> submitContractorProposal({
    required String opportunityId,
    required double amount,
    required String duration,
    required String scope,
  }) async {
    final start = DateTime.now().add(const Duration(days: 2));
    await client.rpc(
      'save_contractor_proposal',
      params: {
        'p_opportunity_id': opportunityId,
        'p_proposal': {
          'amount': amount,
          'vat_inclusive': true,
          'execution_duration': duration,
          'proposed_start_at': start.toIso8601String().split('T').first,
          'scope_details': scope,
          'includes': <String>[],
          'excludes': <String>[],
          'valid_until': DateTime.now()
              .add(const Duration(days: 3))
              .toUtc()
              .toIso8601String(),
          'policy_accepted': true,
        },
        'p_stages': [
          {
            'name': 'تنفيذ المشروع',
            'description': scope,
            'duration': duration,
            'value_percentage': 100,
            'expected_at': DateTime.now()
                .add(const Duration(days: 30))
                .toIso8601String()
                .split('T')
                .first,
            'sort_order': 1,
          },
        ],
        'p_submit': true,
        'p_idempotency_key': 'app-${DateTime.now().microsecondsSinceEpoch}',
      },
    );
    _changed();
  }

  Future<List<Map<String, dynamic>>> driverDeliveries() async {
    try {
      await client.rpc('mark_driver_activity');
    } catch (_) {}
    final rows = await client.rpc('get_my_driver_deliveries');
    return (rows as List)
        .map((row) => Map<String, dynamic>.from(row as Map))
        .toList();
  }

  Future<void> transitionDelivery(String id, String status) async {
    await client.rpc(
      'transition_delivery_assignment',
      params: {'p_assignment_id': id, 'p_status': status, 'p_note': null},
    );
    _changed();
  }

  Future<bool> confirmDelivery(String id, String code) async {
    final token = client.auth.currentSession?.accessToken;
    if (token == null || token.isEmpty) {
      throw Exception('انتهت جلسة الدخول. سجل الدخول مجددًا.');
    }
    final response = await http.post(
      Uri.parse(
        '${_apiUrl.replaceFirst(RegExp(r'/$'), '')}/api/deliveries/$id/confirm',
      ),
      headers: {
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json',
      },
      body: jsonEncode({'code': code.replaceAll(RegExp(r'\D'), '')}),
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
    if (accepted) _changed();
    return accepted;
  }

  Future<Map<String, dynamic>> createProviderDriver({
    required String fullName,
    required String mobile,
    required String email,
    required String username,
    String internalNotes = '',
  }) async {
    final token = client.auth.currentSession!.accessToken;
    final response = await http.post(
      Uri.parse('$_apiUrl/api/provider/drivers'),
      headers: {
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json',
        'Idempotency-Key': 'driver-${DateTime.now().microsecondsSinceEpoch}',
      },
      body: jsonEncode({
        'fullName': fullName.trim(),
        'mobile': mobile.trim(),
        'email': email.trim().toLowerCase(),
        'username': username.trim(),
        'internalNotes': internalNotes.trim(),
      }),
    );
    final body = jsonDecode(response.body) as Map<String, dynamic>;
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception('${body['error'] ?? 'تعذر إنشاء حساب السائق'}');
    }
    _changed();
    return Map<String, dynamic>.from(body['credentials'] as Map);
  }

  Future<List<Map<String, dynamic>>> adminApplications() async {
    final token = client.auth.currentSession!.accessToken;
    final responses = await Future.wait([
      http.get(
        Uri.parse('$_apiUrl/api/admin/join-requests/provider'),
        headers: {'Authorization': 'Bearer $token'},
      ),
      http.get(
        Uri.parse('$_apiUrl/api/admin/join-requests/contractor'),
        headers: {'Authorization': 'Bearer $token'},
      ),
    ]);
    final output = <Map<String, dynamic>>[];
    for (var i = 0; i < responses.length; i++) {
      final body = jsonDecode(responses[i].body) as Map<String, dynamic>;
      if (responses[i].statusCode != 200) {
        throw Exception('${body['message'] ?? 'تعذر تحميل الطلبات'}');
      }
      for (final raw in (body['applications'] as List? ?? const [])) {
        output.add({
          ...Map<String, dynamic>.from(raw as Map),
          '_kind': i == 0 ? 'provider' : 'contractor',
        });
      }
    }
    output.sort((a, b) => '${b['created_at']}'.compareTo('${a['created_at']}'));
    return output;
  }

  Future<String> reviewApplication({
    required String kind,
    required String id,
    required String action,
    String reason = '',
  }) async {
    final token = client.auth.currentSession!.accessToken;
    final response = await http.post(
      Uri.parse('$_apiUrl/api/admin/join-requests/$kind/$id/$action'),
      headers: {
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json',
      },
      body: jsonEncode({'reason': reason}),
    );
    final body = jsonDecode(response.body) as Map<String, dynamic>;
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception('${body['message'] ?? 'تعذر تنفيذ القرار'}');
    }
    _changed();
    return '${body['status'] ?? 'تم التنفيذ'}';
  }
}

class DriverDeliveriesScreen extends StatefulWidget {
  const DriverDeliveriesScreen({super.key, required this.repository});
  final WorkspaceRepository repository;

  @override
  State<DriverDeliveriesScreen> createState() => _DriverDeliveriesScreenState();
}

class _DriverDeliveriesScreenState extends State<DriverDeliveriesScreen> {
  late Future<List<Map<String, dynamic>>> rows = widget.repository
      .driverDeliveries();
  final Map<String, String> codes = {};
  String busyId = '';

  Future<void> reload() async {
    setState(() {
      rows = widget.repository.driverDeliveries();
    });
    await rows;
  }

  Future<void> move(String id, String status) async {
    setState(() => busyId = id);
    try {
      await widget.repository.transitionDelivery(id, status);
      if (mounted) _notice(context, context.tr('deliveryStatusUpdated'));
      await reload();
    } catch (error) {
      if (mounted) _notice(context, _clean(error));
    } finally {
      if (mounted) setState(() => busyId = '');
    }
  }

  Future<void> confirm(String id) async {
    final code = (codes[id] ?? '').replaceAll(RegExp(r'\D'), '');
    if (code.length < 4) {
      _notice(context, context.tr('enterDeliveryCode'));
      return;
    }
    setState(() => busyId = id);
    try {
      final accepted = await widget.repository.confirmDelivery(id, code);
      if (!mounted) return;
      _notice(
        context,
        accepted
            ? context.tr('deliveryCompleted')
            : context.tr('invalidDeliveryCode'),
      );
      if (accepted) await reload();
    } catch (error) {
      if (mounted) _notice(context, _clean(error));
    } finally {
      if (mounted) setState(() => busyId = '');
    }
  }

  Future<void> openExternal(Uri uri, String failureMessage) async {
    try {
      final opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
      if (!opened && mounted) _notice(context, failureMessage);
    } catch (_) {
      if (mounted) _notice(context, failureMessage);
    }
  }

  Future<void> showCompletedDeliveries(
    List<Map<String, dynamic>> deliveries,
  ) async {
    await showModalBottomSheet<void>(
      context: context,
      useSafeArea: true,
      isScrollControlled: true,
      backgroundColor: const Color(0xFFF7F1E8),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
      ),
      builder: (sheetContext) => FractionallySizedBox(
        heightFactor: .78,
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsetsDirectional.fromSTEB(20, 18, 12, 10),
              child: Row(
                children: [
                  Container(
                    width: 44,
                    height: 44,
                    decoration: const BoxDecoration(
                      color: BunyaColors.mint,
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(
                      Icons.inventory_2_outlined,
                      color: BunyaColors.forest,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          context.tr('completedDeliveries'),
                          style: const TextStyle(
                            fontSize: 20,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                        Text(
                          '${deliveries.length}',
                          style: const TextStyle(
                            color: BunyaColors.muted,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    tooltip: MaterialLocalizations.of(sheetContext)
                        .closeButtonTooltip,
                    onPressed: () => Navigator.pop(sheetContext),
                    icon: const Icon(Icons.close_rounded),
                  ),
                ],
              ),
            ),
            const Divider(height: 1),
            Expanded(
              child: deliveries.isEmpty
                  ? Padding(
                      padding: const EdgeInsets.all(16),
                      child: _Empty(text: context.tr('noCompletedDeliveries')),
                    )
                  : ListView.separated(
                      padding: const EdgeInsets.all(16),
                      itemCount: deliveries.length,
                      separatorBuilder: (_, _) => const SizedBox(height: 10),
                      itemBuilder: (_, index) =>
                          _DriverArchivedCard(row: deliveries[index]),
                    ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(
    BuildContext context,
  ) => FutureBuilder<List<Map<String, dynamic>>>(
    future: rows,
    builder: (context, snapshot) {
      if (snapshot.connectionState == ConnectionState.waiting) {
        return const Center(child: CircularProgressIndicator());
      }
      if (snapshot.hasError) {
        return Center(child: Text(_clean(snapshot.error!)));
      }
      final deliveries = snapshot.data ?? const [];
      final completedDeliveries = deliveries
          .where(
            (row) => const {
              'delivered',
              'failed_delivery',
            }.contains('${row['delivery_status']}'),
          )
          .toList();
      final activeDeliveries = deliveries
          .where(
            (row) => !const {
              'delivered',
              'failed_delivery',
            }.contains('${row['delivery_status']}'),
          )
          .toList();
      return RefreshIndicator(
        onRefresh: reload,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            _DetailHeader(
              title: context.tr('deliveryTasks'),
              caption: context.tr('deliveryTasksCaption'),
              trailing: _DriverArchiveButton(
                count: completedDeliveries.length,
                tooltip: context.tr('completedDeliveries'),
                onPressed: () => showCompletedDeliveries(completedDeliveries),
              ),
            ),
            const SizedBox(height: 16),
            if (activeDeliveries.isEmpty)
              SizedBox(
                height: 260,
                child: _Empty(
                  text: deliveries.isEmpty
                      ? context.tr('noAssignedTasks')
                      : context.tr('noActiveDeliveries'),
                ),
              )
            else
              ...activeDeliveries.map((row) {
                final id = '${row['delivery_id']}';
                final status = '${row['delivery_status']}';
                final maps = '${row['google_maps_url'] ?? ''}'.trim();
                final recipientMobile = '${row['recipient_mobile'] ?? ''}'
                    .trim();
                final siteMobile = '${row['site_responsible_mobile'] ?? ''}'
                    .trim();
                final recipientName = '${row['recipient_name'] ?? '—'}'.trim();
                final siteName = '${row['site_responsible_name'] ?? '—'}'
                    .trim();
                final orderItems = (row['items'] as List? ?? const [])
                    .whereType<Map>()
                    .map((item) => Map<String, dynamic>.from(item))
                    .toList();
                return Container(
                  margin: const EdgeInsets.only(bottom: 10),
                  clipBehavior: Clip.antiAlias,
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(18),
                    border: Border.all(color: BunyaColors.line),
                  ),
                  child: Theme(
                    data: Theme.of(context).copyWith(
                      dividerColor: Colors.transparent,
                      splashColor: BunyaColors.mint,
                    ),
                    child: ExpansionTile(
                      maintainState: true,
                      tilePadding: const EdgeInsetsDirectional.fromSTEB(
                        14,
                        8,
                        10,
                        8,
                      ),
                      childrenPadding: const EdgeInsetsDirectional.fromSTEB(
                        14,
                        0,
                        14,
                        14,
                      ),
                      leading: Container(
                        width: 42,
                        height: 42,
                        decoration: const BoxDecoration(
                          color: BunyaColors.mint,
                          shape: BoxShape.circle,
                        ),
                        child: const Icon(
                          Icons.local_shipping_outlined,
                          color: BunyaColors.forest,
                          size: 21,
                        ),
                      ),
                      title: Text(
                        '${row['order_code']}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        textDirection: TextDirection.ltr,
                        style: const TextStyle(
                          fontSize: 15,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      subtitle: Padding(
                        padding: const EdgeInsets.only(top: 4),
                        child: Row(
                          children: [
                            Expanded(
                              child: Text(
                                '$recipientName · ${_date(row['expected_at'])}',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  color: BunyaColors.muted,
                                  fontSize: 11,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ),
                            const SizedBox(width: 6),
                            _MiniStatus(text: context.localizedStatus(status)),
                          ],
                        ),
                      ),
                      children: [
                        const Divider(height: 1),
                        const SizedBox(height: 14),
                        Align(
                          alignment: AlignmentDirectional.centerStart,
                          child: Text(
                            '${row['fulfillment_code']}',
                            style: const TextStyle(
                              color: BunyaColors.muted,
                              fontSize: 11,
                              fontWeight: FontWeight.w800,
                              letterSpacing: .2,
                            ),
                          ),
                        ),
                        const SizedBox(height: 12),
                        _DriverSectionTitle(
                          icon: Icons.people_alt_outlined,
                          text: context.tr('deliveryContacts'),
                        ),
                        const SizedBox(height: 8),
                        _DriverContactPanel(
                          recipientName: recipientName,
                          recipientMobile: recipientMobile,
                          siteName: siteName,
                          siteMobile: siteMobile,
                          onCallRecipient: recipientMobile.isEmpty
                              ? null
                              : () => openExternal(
                                  Uri(
                                    scheme: 'tel',
                                    path: recipientMobile.replaceAll(
                                      RegExp(r'\s+'),
                                      '',
                                    ),
                                  ),
                                  context.tr('callFailed'),
                                ),
                          onCallSite: siteMobile.isEmpty
                              ? null
                              : () => openExternal(
                                  Uri(
                                    scheme: 'tel',
                                    path: siteMobile.replaceAll(
                                      RegExp(r'\s+'),
                                      '',
                                    ),
                                  ),
                                  context.tr('callFailed'),
                                ),
                        ),
                        const SizedBox(height: 16),
                        _DriverSectionTitle(
                          icon: Icons.fact_check_outlined,
                          text: context.tr('siteReadiness'),
                        ),
                        const SizedBox(height: 8),
                        _DriverOperationsPanel(
                          deliveryTime: _date(row['expected_at']),
                          workingHours: '${row['working_hours'] ?? '—'}',
                          loadingUnloading:
                              '${row['loading_option'] ?? '—'} · ${row['unloading_option'] ?? '—'}',
                          roadAccess: '${row['road_access'] ?? '—'}',
                          accessInstructions:
                              '${row['access_instructions'] ?? '—'}',
                        ),
                        if (orderItems.isNotEmpty) ...[
                          const SizedBox(height: 16),
                          _DriverSectionTitle(
                            icon: Icons.inventory_2_outlined,
                            text: context.tr('orderItems'),
                          ),
                          const SizedBox(height: 8),
                          _DriverOrderItems(items: orderItems),
                        ],
                        if (maps.isNotEmpty) ...[
                          const SizedBox(height: 14),
                          OutlinedButton.icon(
                            onPressed: () => openExternal(
                              Uri.parse(maps),
                              context.tr('mapsFailed'),
                            ),
                            icon: const Icon(Icons.map_outlined),
                            label: Text(context.tr('openGoogleMaps')),
                            style: OutlinedButton.styleFrom(
                              minimumSize: const Size.fromHeight(50),
                              side: const BorderSide(color: BunyaColors.copper),
                              foregroundColor: BunyaColors.copperDark,
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(15),
                              ),
                            ),
                          ),
                        ],
                        const SizedBox(height: 10),
                        if (status == 'assigned')
                          FilledButton(
                            onPressed: busyId == id
                                ? null
                                : () => move(id, 'picked_up'),
                            child: Text(context.tr('pickedUpFromProvider')),
                          )
                        else if (status == 'picked_up')
                          FilledButton(
                            onPressed: busyId == id
                                ? null
                                : () => move(id, 'in_transit'),
                            child: Text(context.tr('outForDelivery')),
                          )
                        else if (status == 'in_transit')
                          FilledButton(
                            onPressed: busyId == id
                                ? null
                                : () => move(id, 'arrived'),
                            child: Text(context.tr('arrivedCustomer')),
                          )
                        else if (status == 'arrived') ...[
                          Container(
                            padding: const EdgeInsets.all(13),
                            decoration: BoxDecoration(
                              color: const Color(0xFFFFF8EF),
                              borderRadius: BorderRadius.circular(16),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                Text(
                                  context.tr('customerDeliveryCode'),
                                  style: const TextStyle(
                                    fontWeight: FontWeight.w900,
                                  ),
                                ),
                                Text(
                                  context.tr('deliveryCodeWarning'),
                                  style: const TextStyle(
                                    color: BunyaColors.muted,
                                    fontSize: 12,
                                  ),
                                ),
                                const SizedBox(height: 8),
                                TextField(
                                  keyboardType: TextInputType.number,
                                  textDirection: TextDirection.ltr,
                                  maxLength: 12,
                                  autofillHints: const [
                                    AutofillHints.oneTimeCode,
                                  ],
                                  onChanged: (value) => codes[id] = value,
                                  decoration: InputDecoration(
                                    counterText: '',
                                    labelText: context.tr('customerCode'),
                                  ),
                                ),
                                const SizedBox(height: 8),
                                FilledButton.icon(
                                  onPressed: busyId == id
                                      ? null
                                      : () => confirm(id),
                                  icon: const Icon(
                                    Icons.verified_user_outlined,
                                  ),
                                  label: Text(context.tr('confirmAndClose')),
                                ),
                              ],
                            ),
                          ),
                        ],
                        if (!const {
                          'delivered',
                          'failed_delivery',
                        }.contains(status)) ...[
                          const SizedBox(height: 7),
                          TextButton(
                            onPressed: busyId == id
                                ? null
                                : () => move(id, 'failed_delivery'),
                            child: Text(context.tr('deliveryFailed')),
                          ),
                        ],
                      ],
                    ),
                  ),
                );
              }),
          ],
        ),
      );
    },
  );
}

class _DriverArchiveButton extends StatelessWidget {
  const _DriverArchiveButton({
    required this.count,
    required this.tooltip,
    required this.onPressed,
  });

  final int count;
  final String tooltip;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    label: '$tooltip: $count',
    child: Stack(
      clipBehavior: Clip.none,
      children: [
        IconButton(
          tooltip: tooltip,
          onPressed: onPressed,
          style: IconButton.styleFrom(
            minimumSize: const Size(48, 48),
            backgroundColor: Colors.white.withValues(alpha: .14),
            foregroundColor: Colors.white,
            side: BorderSide(color: Colors.white.withValues(alpha: .28)),
          ),
          icon: const Icon(Icons.inventory_2_outlined),
        ),
        if (count > 0)
          PositionedDirectional(
            top: -4,
            end: -4,
            child: Container(
              constraints: const BoxConstraints(minWidth: 22, minHeight: 22),
              padding: const EdgeInsets.symmetric(horizontal: 5),
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: BunyaColors.copper,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: Colors.white, width: 2),
              ),
              child: Text(
                count > 99 ? '99+' : '$count',
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 10,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ),
          ),
      ],
    ),
  );
}

class _DriverArchivedCard extends StatelessWidget {
  const _DriverArchivedCard({required this.row});

  final Map<String, dynamic> row;

  @override
  Widget build(BuildContext context) {
    final status = '${row['delivery_status']}';
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(17),
        border: Border.all(color: BunyaColors.line),
      ),
      child: Row(
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: const BoxDecoration(
              color: BunyaColors.mint,
              shape: BoxShape.circle,
            ),
            child: Icon(
              status == 'delivered'
                  ? Icons.task_alt_rounded
                  : Icons.report_gmailerrorred_rounded,
              color: status == 'delivered'
                  ? BunyaColors.forest
                  : BunyaColors.copperDark,
            ),
          ),
          const SizedBox(width: 11),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${row['order_code']}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  textDirection: TextDirection.ltr,
                  style: const TextStyle(fontWeight: FontWeight.w900),
                ),
                const SizedBox(height: 3),
                Text(
                  '${row['recipient_name'] ?? '—'} · ${_date(row['delivered_at'] ?? row['expected_at'])}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: BunyaColors.muted,
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          _MiniStatus(text: context.localizedStatus(status)),
        ],
      ),
    );
  }
}

class _DriverSectionTitle extends StatelessWidget {
  const _DriverSectionTitle({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      Icon(icon, size: 18, color: BunyaColors.copper),
      const SizedBox(width: 7),
      Expanded(
        child: Text(
          text,
          style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w900),
        ),
      ),
    ],
  );
}

class _DriverContactPanel extends StatelessWidget {
  const _DriverContactPanel({
    required this.recipientName,
    required this.recipientMobile,
    required this.siteName,
    required this.siteMobile,
    required this.onCallRecipient,
    required this.onCallSite,
  });

  final String recipientName;
  final String recipientMobile;
  final String siteName;
  final String siteMobile;
  final VoidCallback? onCallRecipient;
  final VoidCallback? onCallSite;

  @override
  Widget build(BuildContext context) => Container(
    decoration: _driverInsetDecoration(),
    child: Column(
      children: [
        _DriverContactRow(
          icon: Icons.person_outline_rounded,
          label: context.tr('recipient'),
          name: recipientName,
          mobile: recipientMobile,
          callLabel: context.tr('callRecipient'),
          onCall: onCallRecipient,
        ),
        const Divider(height: 1, indent: 58, endIndent: 14),
        _DriverContactRow(
          icon: Icons.engineering_outlined,
          label: context.tr('siteResponsible'),
          name: siteName,
          mobile: siteMobile,
          callLabel: context.tr('callSiteResponsible'),
          onCall: onCallSite,
        ),
      ],
    ),
  );
}

class _DriverContactRow extends StatelessWidget {
  const _DriverContactRow({
    required this.icon,
    required this.label,
    required this.name,
    required this.mobile,
    required this.callLabel,
    required this.onCall,
  });

  final IconData icon;
  final String label;
  final String name;
  final String mobile;
  final String callLabel;
  final VoidCallback? onCall;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsetsDirectional.fromSTEB(12, 11, 8, 11),
    child: Row(
      children: [
        Container(
          width: 38,
          height: 38,
          decoration: const BoxDecoration(
            color: BunyaColors.mint,
            shape: BoxShape.circle,
          ),
          child: Icon(icon, size: 20, color: BunyaColors.forest),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label,
                style: const TextStyle(
                  color: BunyaColors.muted,
                  fontSize: 10,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                name.isEmpty ? '—' : name,
                style: const TextStyle(fontWeight: FontWeight.w900),
              ),
              Text(
                mobile.isEmpty ? '—' : mobile,
                textDirection: TextDirection.ltr,
                style: const TextStyle(
                  color: BunyaColors.muted,
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
        ),
        IconButton(
          onPressed: onCall,
          tooltip: callLabel,
          visualDensity: VisualDensity.compact,
          style: IconButton.styleFrom(
            minimumSize: const Size(44, 44),
            backgroundColor: Colors.white,
            foregroundColor: BunyaColors.copperDark,
            side: const BorderSide(color: BunyaColors.line),
          ),
          icon: const Icon(Icons.phone_outlined, size: 20),
        ),
      ],
    ),
  );
}

class _DriverOperationsPanel extends StatelessWidget {
  const _DriverOperationsPanel({
    required this.deliveryTime,
    required this.workingHours,
    required this.loadingUnloading,
    required this.roadAccess,
    required this.accessInstructions,
  });

  final String deliveryTime;
  final String workingHours;
  final String loadingUnloading;
  final String roadAccess;
  final String accessInstructions;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(14),
    decoration: _driverInsetDecoration(),
    child: Column(
      children: [
        LayoutBuilder(
          builder: (context, constraints) {
            final metrics = [
              _DriverMetric(
                icon: Icons.event_available_outlined,
                label: context.tr('deliveryTime'),
                value: deliveryTime,
              ),
              _DriverMetric(
                icon: Icons.schedule_outlined,
                label: context.tr('workingHours'),
                value: workingHours,
              ),
            ];
            if (constraints.maxWidth < 270) {
              return Column(
                children: [
                  metrics.first,
                  const Divider(height: 20),
                  metrics.last,
                ],
              );
            }
            return IntrinsicHeight(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Expanded(child: metrics.first),
                  const VerticalDivider(width: 22),
                  Expanded(child: metrics.last),
                ],
              ),
            );
          },
        ),
        const Divider(height: 24),
        _DriverInfoRow(
          icon: Icons.inventory_2_outlined,
          label: context.tr('loadingUnloading'),
          value: loadingUnloading,
        ),
        const Divider(height: 20, indent: 32),
        _DriverInfoRow(
          icon: Icons.route_outlined,
          label: context.tr('roadAccess'),
          value: roadAccess,
        ),
        const Divider(height: 20, indent: 32),
        _DriverInfoRow(
          icon: Icons.signpost_outlined,
          label: context.tr('accessInstructions'),
          value: accessInstructions,
        ),
      ],
    ),
  );
}

class _DriverMetric extends StatelessWidget {
  const _DriverMetric({
    required this.icon,
    required this.label,
    required this.value,
  });

  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Row(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Icon(icon, size: 19, color: BunyaColors.copper),
      const SizedBox(width: 8),
      Expanded(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              label,
              style: const TextStyle(
                color: BunyaColors.muted,
                fontSize: 10,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 2),
            Text(value, style: const TextStyle(fontWeight: FontWeight.w900)),
          ],
        ),
      ),
    ],
  );
}

class _DriverInfoRow extends StatelessWidget {
  const _DriverInfoRow({
    required this.icon,
    required this.label,
    required this.value,
  });

  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Row(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Padding(
        padding: const EdgeInsets.only(top: 2),
        child: Icon(icon, size: 19, color: BunyaColors.forest),
      ),
      const SizedBox(width: 12),
      Expanded(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              label,
              style: const TextStyle(
                color: BunyaColors.muted,
                fontSize: 10,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              value,
              style: const TextStyle(height: 1.45, fontWeight: FontWeight.w800),
            ),
          ],
        ),
      ),
    ],
  );
}

class _DriverOrderItems extends StatelessWidget {
  const _DriverOrderItems({required this.items});

  final List<Map<String, dynamic>> items;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 14),
    decoration: _driverInsetDecoration(),
    child: Column(
      children: [
        for (var index = 0; index < items.length; index++) ...[
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 12),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    '${items[index]['product_name'] ?? '—'}',
                    style: const TextStyle(fontWeight: FontWeight.w900),
                  ),
                ),
                const SizedBox(width: 10),
                Text(
                  '${items[index]['quantity'] ?? '—'} ${items[index]['unit_name'] ?? ''}',
                  textDirection: TextDirection.ltr,
                  style: const TextStyle(
                    color: BunyaColors.muted,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ],
            ),
          ),
          if (index < items.length - 1) const Divider(height: 1),
        ],
      ],
    ),
  );
}

BoxDecoration _driverInsetDecoration() => BoxDecoration(
  color: const Color(0xFFFBF8F3),
  borderRadius: BorderRadius.circular(16),
  border: Border.all(color: BunyaColors.line),
);

class RoleWorkspace extends StatefulWidget {
  const RoleWorkspace({
    super.key,
    required this.profile,
    required this.repository,
    required this.onChangePassword,
    required this.onLogout,
    this.storefrontHome,
    this.quoteItemCount = 0,
    this.onOpenQuoteBasket,
  });
  final Profile profile;
  final BunyaRepository repository;
  final VoidCallback onChangePassword;
  final Future<void> Function() onLogout;
  final Widget? storefrontHome;
  final int quoteItemCount;
  final VoidCallback? onOpenQuoteBasket;

  @override
  State<RoleWorkspace> createState() => _RoleWorkspaceState();
}

class _RoleWorkspaceState extends State<RoleWorkspace> {
  late final WorkspaceRepository workspace = WorkspaceRepository(
    widget.repository.client,
  );
  late Future<RoleContext> identity = workspace.resolve(widget.profile);
  int index = 0;

  @override
  void initState() {
    super.initState();
    PushService.notificationOpenRevision.addListener(
      _openNotificationsFromSystem,
    );
    _openNotificationsFromSystem();
  }

  @override
  void dispose() {
    PushService.notificationOpenRevision.removeListener(
      _openNotificationsFromSystem,
    );
    super.dispose();
  }

  void _openNotificationsFromSystem() {
    if (!PushService.consumeNotificationsPageRequest()) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      Navigator.of(context).popUntil((route) => route.isFirst);
      setState(() => index = 3);
    });
  }

  Future<void> confirmLogout() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(context.tr('logout')),
        content: Text(context.tr('confirmLogout')),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: Text(context.tr('cancel')),
          ),
          FilledButton.icon(
            onPressed: () => Navigator.pop(dialogContext, true),
            icon: const Icon(Icons.logout_rounded),
            label: Text(context.tr('logout')),
          ),
        ],
      ),
    );
    if (confirmed == true) await widget.onLogout();
  }

  @override
  Widget build(BuildContext context) => FutureBuilder<RoleContext>(
    future: identity,
    builder: (_, snapshot) {
      if (!snapshot.hasData) {
        return const Scaffold(body: Center(child: CircularProgressIndicator()));
      }
      final role = snapshot.data!;
      final storefrontHome =
          const {'provider', 'contractor'}.contains(role.role)
          ? widget.storefrontHome
          : null;
      final pages = [
        storefrontHome ?? _RoleHome(repository: workspace, contextData: role),
        if (role.role == 'admin')
          _AdminApplications(repository: workspace)
        else if (role.role == 'provider')
          _ProviderRfqs(repository: workspace, providerId: role.entityId!)
        else if (role.role == 'driver')
          DriverDeliveriesScreen(repository: workspace)
        else
          _ContractorOpportunities(repository: workspace),
        _RoleModules(repository: workspace, contextData: role),
        _RoleNotifications(
          repository: widget.repository,
          workspace: workspace,
          contextData: role,
        ),
        _WorkspaceAccount(
          profile: widget.profile,
          contextData: role,
          onChangePassword: widget.onChangePassword,
          onLogout: widget.onLogout,
        ),
      ];
      return Scaffold(
        appBar: AppBar(
          title: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                role.name,
                style: const TextStyle(
                  fontSize: 15,
                  height: 1.2,
                  fontWeight: FontWeight.w800,
                ),
              ),
              Text(
                _roleLabel(context, role.role),
                style: const TextStyle(
                  color: BunyaColors.muted,
                  fontSize: 9,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
          actions: [
            const BunyaLanguageButton(),
            if (widget.onOpenQuoteBasket != null)
              Badge(
                isLabelVisible: widget.quoteItemCount > 0,
                label: Text('${widget.quoteItemCount}'),
                child: IconButton.filledTonal(
                  tooltip: context.tr('quoteRequest'),
                  onPressed: widget.onOpenQuoteBasket,
                  icon: const Icon(Icons.receipt_long_outlined),
                ),
              ),
            if (role.role == 'driver')
              IconButton(
                tooltip: context.tr('logout'),
                onPressed: confirmLogout,
                icon: const Icon(Icons.logout_rounded),
              ),
            const Padding(
              padding: EdgeInsetsDirectional.only(end: 12),
              child: BunyaBrandLogo(width: 112, height: 40),
            ),
          ],
        ),
        body: IndexedStack(index: index, children: pages),
        bottomNavigationBar: NavigationBar(
          selectedIndex: index,
          onDestinationSelected: (value) => setState(() => index = value),
          destinations: [
            NavigationDestination(
              icon: const Icon(Icons.dashboard_outlined),
              selectedIcon: const Icon(Icons.dashboard_rounded),
              label: context.tr('homeNav'),
            ),
            NavigationDestination(
              icon: Icon(
                role.role == 'admin'
                    ? Icons.fact_check_outlined
                    : role.role == 'provider'
                    ? Icons.request_quote_outlined
                    : role.role == 'driver'
                    ? Icons.local_shipping_outlined
                    : Icons.work_outline_rounded,
              ),
              label: role.role == 'admin'
                  ? context.tr('approvalsNav')
                  : role.role == 'provider'
                  ? context.tr('pricingNav')
                  : role.role == 'driver'
                  ? context.tr('deliveriesNav')
                  : context.tr('opportunitiesNav'),
            ),
            NavigationDestination(
              icon: const Icon(Icons.apps_rounded),
              label: context.tr('servicesNav'),
            ),
            NavigationDestination(
              icon: const Icon(Icons.notifications_none_rounded),
              label: context.tr('notificationsNav'),
            ),
            NavigationDestination(
              icon: const Icon(Icons.person_outline_rounded),
              label: context.tr('accountNav'),
            ),
          ],
        ),
      );
    },
  );
}

class _RoleHome extends StatefulWidget {
  const _RoleHome({required this.repository, required this.contextData});
  final WorkspaceRepository repository;
  final RoleContext contextData;

  @override
  State<_RoleHome> createState() => _RoleHomeState();
}

class _RoleHomeState extends State<_RoleHome> {
  late Future<Map<String, int>> metrics;

  @override
  void initState() {
    super.initState();
    metrics = widget.repository.metrics(widget.contextData);
    AppDataRefresh.revision.addListener(_repositoryChanged);
  }

  void _repositoryChanged() => refresh();

  @override
  void dispose() {
    AppDataRefresh.revision.removeListener(_repositoryChanged);
    super.dispose();
  }

  Future<void> refresh() async {
    final next = widget.repository.metrics(widget.contextData);
    setState(() => metrics = next);
    await next;
  }

  @override
  Widget build(BuildContext context) => RefreshIndicator(
    onRefresh: refresh,
    child: ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Container(
          padding: const EdgeInsets.all(22),
          decoration: BoxDecoration(
            gradient: LinearGradient(
              colors: widget.contextData.role == 'admin'
                  ? const [Color(0xFF2D273F), Color(0xFF54466F)]
                  : widget.contextData.role == 'provider'
                  ? const [BunyaColors.copperDark, BunyaColors.copper]
                  : const [BunyaColors.forest, Color(0xFF2B715D)],
            ),
            borderRadius: BorderRadius.circular(27),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                _welcome(context, widget.contextData.role),
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 22,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 5),
              Text(
                _roleCaption(context, widget.contextData.role),
                style: const TextStyle(
                  color: Colors.white70,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 18),
        FutureBuilder<Map<String, int>>(
          future: metrics,
          builder: (_, snapshot) {
            if (!snapshot.hasData) {
              return const Center(child: CircularProgressIndicator());
            }
            return Row(
              children: snapshot.data!.entries
                  .map(
                    (entry) => Expanded(
                      child: Container(
                        margin: const EdgeInsets.symmetric(horizontal: 4),
                        padding: const EdgeInsets.symmetric(vertical: 17),
                        decoration: _panel(),
                        child: Column(
                          children: [
                            Text(
                              entry.value < 0 ? '—' : '${entry.value}',
                              style: const TextStyle(
                                fontSize: 24,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                            const SizedBox(height: 3),
                            Text(
                              _metricLabel(context, entry.key),
                              textAlign: TextAlign.center,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                color: BunyaColors.muted,
                                fontSize: 10,
                                fontWeight: FontWeight.w700,
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
        const SizedBox(height: 18),
        Container(
          padding: const EdgeInsets.all(17),
          decoration: _panel(),
          child: Row(
            children: [
              const CircleAvatar(
                backgroundColor: BunyaColors.mint,
                child: Icon(Icons.sync_rounded, color: BunyaColors.forest),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      context.tr('liveConnectedData'),
                      style: const TextStyle(fontWeight: FontWeight.w900),
                    ),
                    Text(
                      context.tr('liveConnectedDataCaption'),
                      style: const TextStyle(
                        color: BunyaColors.muted,
                        fontSize: 11,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ],
    ),
  );
}

class _ProviderRfqs extends StatefulWidget {
  const _ProviderRfqs({required this.repository, required this.providerId});
  final WorkspaceRepository repository;
  final String providerId;
  @override
  State<_ProviderRfqs> createState() => _ProviderRfqsState();
}

class _ProviderRfqsState extends State<_ProviderRfqs> {
  late Future<List<Map<String, dynamic>>> rows = widget.repository.providerRfqs(
    widget.providerId,
  );
  void reload() => setState(() {
    rows = widget.repository.providerRfqs(widget.providerId);
  });

  @override
  void initState() {
    super.initState();
    AppDataRefresh.revision.addListener(reload);
  }

  @override
  void dispose() {
    AppDataRefresh.revision.removeListener(reload);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => _FutureList(
    title: 'طلبات التسعير',
    caption: 'كل بطاقة لمنتج واحد متوفر لديك. سعّر ما تستطيع توفيره فقط؛ ولا يلزم توفير بقية منتجات طلب العميل.',
    future: rows,
    item: (row) => _ProviderRfqCard(
      row: row,
      onOpen: () async {
        await Navigator.of(context).push(
          MaterialPageRoute(
            builder: (_) => ProviderPriceScreen(
              repository: widget.repository,
              id: '${row['sourcing_request_item_id']}',
            ),
          ),
        );
        reload();
      },
    ),
  );
}

class _ProviderRfqCard extends StatefulWidget {
  const _ProviderRfqCard({required this.row, required this.onOpen});
  final Map<String, dynamic> row;
  final VoidCallback onOpen;

  @override
  State<_ProviderRfqCard> createState() => _ProviderRfqCardState();
}

class _ProviderRfqCardState extends State<_ProviderRfqCard> {
  late final Timer timer;

  @override
  void initState() {
    super.initState();
    timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    timer.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final row = widget.row;
    final window = _pricingState(row);
    final answered = '${row['existing_response_code'] ?? ''}'.isNotEmpty;
    final canRevise = row['can_revise'] == true;
    final signed = '${row['signed_image_url'] ?? ''}';
    final fallback = '${row['product_image_url'] ?? ''}';
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      clipBehavior: Clip.antiAlias,
      decoration: _panel(),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: double.infinity,
            height: 168,
            child: FastProductImage(
              imageUrl: signed,
              fallbackUrl: fallback,
              cacheKey: 'provider-rfq-${row['sourcing_request_item_id']}',
              fit: BoxFit.cover,
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        '${row['product_name'] ?? 'منتج مطلوب'}',
                        style: const TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ),
                    _MiniStatus(
                      text: answered
                          ? canRevise
                                ? 'متاح تخفيض السعر'
                                : 'تم حفظ عرضك'
                          : window.$1
                          ? 'متاح للتسعير'
                          : window.$2,
                    ),
                  ],
                ),
                const SizedBox(height: 7),
                Text(
                  '${row['quantity'] ?? '—'} ${row['unit_snapshot'] ?? ''} · ${row['internal_code'] ?? row['request_code'] ?? ''}',
                  style: const TextStyle(
                    color: BunyaColors.muted,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 11),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: BunyaColors.mint,
                    borderRadius: BorderRadius.circular(14),
                  ),
                  child: Text(
                    answered
                        ? 'عرضك محفوظ: ${row['existing_unit_price'] ?? '—'} ر.س للوحدة${row['current_lowest_unit_price'] == null ? '' : '\nأقل سعر منافس: ${row['current_lowest_unit_price']} ر.س'}'
                        : row['current_lowest_unit_price'] == null
                        ? 'لا يوجد سعر منافس لهذا المنتج حتى الآن'
                        : 'أقل سعر وحدة من مزود آخر: ${row['current_lowest_unit_price']} ر.س',
                    style: const TextStyle(
                      color: BunyaColors.forest,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ),
                const SizedBox(height: 9),
                Text(
                  '${window.$2} · ${_clock(window.$3)}',
                  textDirection: TextDirection.rtl,
                  style: TextStyle(
                    color: window.$1
                        ? BunyaColors.forest
                        : BunyaColors.copperDark,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 11),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton(
                    onPressed: window.$1 || answered ? widget.onOpen : null,
                    child: Text(
                      answered
                          ? canRevise
                                ? 'مراجعة المنافس وتخفيض السعر'
                                : 'عرض السعر المحفوظ'
                          : 'مراجعة الموقع وإدخال السعر',
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _MiniStatus extends StatelessWidget {
  const _MiniStatus({required this.text});
  final String text;
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
    decoration: BoxDecoration(
      color: BunyaColors.sand,
      borderRadius: BorderRadius.circular(30),
    ),
    child: Text(
      text,
      style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w900),
    ),
  );
}

(bool, String, Duration) _pricingState(Map<String, dynamic> row) {
  final now = DateTime.now();
  final opens =
      DateTime.tryParse('${row['pricing_opens_at']}')?.toLocal() ?? now;
  final starts =
      DateTime.tryParse('${row['pricing_countdown_starts_at']}')?.toLocal() ??
      opens;
  final closes =
      DateTime.tryParse('${row['response_deadline_at']}')?.toLocal() ?? now;
  if (now.isBefore(opens)) {
    return (false, 'يفتح التسعير بعد', opens.difference(now));
  }
  if (now.isBefore(starts)) {
    return (true, 'يبدأ عداد 3 ساعات بعد', starts.difference(now));
  }
  if (now.isBefore(closes)) {
    return (true, 'الوقت المتبقي للتسعير', closes.difference(now));
  }
  return (false, 'انتهت مهلة التسعير', Duration.zero);
}

String _clock(Duration value) {
  final seconds = value.inSeconds.clamp(0, 359999);
  final hours = seconds ~/ 3600;
  final minutes = (seconds % 3600) ~/ 60;
  final rest = seconds % 60;
  return '${hours.toString().padLeft(2, '0')}:${minutes.toString().padLeft(2, '0')}:${rest.toString().padLeft(2, '0')}';
}

class ProviderPriceScreen extends StatefulWidget {
  const ProviderPriceScreen({
    super.key,
    required this.repository,
    required this.id,
  });
  final WorkspaceRepository repository;
  final String id;
  @override
  State<ProviderPriceScreen> createState() => _ProviderPriceScreenState();
}

class _ProviderPriceScreenState extends State<ProviderPriceScreen> {
  final price = TextEditingController(),
      delivery = TextEditingController(text: '0'),
      preparation = TextEditingController(text: '0'),
      deliveryHours = TextEditingController(text: '0'),
      notes = TextEditingController();
  late Future<Map<String, dynamic>> target = widget.repository.providerRfq(
    widget.id,
  );
  late final Timer timer;
  int ticks = 0;
  bool busy = false;
  bool locationReviewed = false;
  bool revisionDraftInitialized = false;
  @override
  void initState() {
    super.initState();
    timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted) return;
      ticks++;
      if (ticks % 30 == 0) {
        target = widget.repository.providerRfq(widget.id);
      }
      setState(() {});
    });
  }

  @override
  void dispose() {
    timer.cancel();
    for (final c in [price, delivery, preparation, deliveryHours, notes]) {
      c.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('طلب التسعير')),
    body: FutureBuilder<Map<String, dynamic>>(
      future: target,
      builder: (_, snapshot) {
        if (!snapshot.hasData) {
          return const Center(child: CircularProgressIndicator());
        }
        final row = snapshot.data!;
        final quantity = (row['quantity'] as num? ?? 0).toDouble();
        final existing = row['existing_response'] is Map
            ? Map<String, dynamic>.from(row['existing_response'] as Map)
            : null;
        final canRevise = existing?['can_revise'] == true;
        final unitPrice = (existing?['unit_price'] as num? ?? 0).toDouble();
        final deliveryFee = (existing?['delivery_fee'] as num? ?? 0).toDouble();
        if (canRevise && !revisionDraftInitialized) {
          price.text = '$unitPrice';
          delivery.text = '$deliveryFee';
          preparation.text = '${existing?['preparation_hours'] ?? 0}';
          deliveryHours.text = '${existing?['delivery_hours'] ?? 0}';
          notes.text = '${existing?['notes'] ?? ''}';
          revisionDraftInitialized = true;
        }
        final subtotal = unitPrice * quantity;
        final vat = existing?['vat_inclusive'] == true ? 0.0 : subtotal * .15;
        final mapsUrl = '${row['google_maps_url'] ?? ''}'.trim();
        final window = _pricingState(row);
        final signedImage = '${row['signed_image_url'] ?? ''}';
        final fallbackImage = '${row['product_image_url'] ?? ''}';
        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            _DetailHeader(
              title: '${row['product_name'] ?? 'منتج مطلوب'}',
              caption: '${row['request_code'] ?? row['internal_code'] ?? ''}',
            ),
            const SizedBox(height: 12),
            ClipRRect(
              borderRadius: BorderRadius.circular(20),
              child: SizedBox(
                height: 220,
                child: FastProductImage(
                  imageUrl: signedImage,
                  fallbackUrl: fallbackImage,
                  cacheKey: 'provider-rfq-detail-${widget.id}',
                  fit: BoxFit.contain,
                ),
              ),
            ),
            const SizedBox(height: 12),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: window.$1 ? BunyaColors.mint : const Color(0xFFFFF2DF),
                borderRadius: BorderRadius.circular(16),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    window.$2,
                    style: const TextStyle(fontWeight: FontWeight.w900),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    _clock(window.$3),
                    textDirection: TextDirection.ltr,
                    style: const TextStyle(
                      fontSize: 24,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 4),
                  const Text(
                    'التسعير 3 ساعات. الطلب خارج 8 ص–4 م يُتاح من 6 ص ويبدأ عداده 8 ص بتوقيت الرياض.',
                    style: TextStyle(
                      fontSize: 11,
                      height: 1.55,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),
            _Facts(
              values: {
                'الكمية': '$quantity ${row['unit_snapshot'] ?? ''}',
                'المنطقة': '${row['delivery_region'] ?? '—'}',
                'أقل سعر وحدة من مزود آخر':
                    row['current_lowest_unit_price'] == null
                    ? 'لا يوجد عرض'
                    : '${row['current_lowest_unit_price']} ر.س',
                'الموقع': '${row['location_hint'] ?? '—'}',
              },
            ),
            const SizedBox(height: 14),
            if (mapsUrl.isNotEmpty) ...[
              OutlinedButton.icon(
                onPressed: () => launchUrl(
                  Uri.parse(mapsUrl),
                  mode: LaunchMode.externalApplication,
                ),
                icon: const Icon(Icons.map_rounded),
                label: const Text('فتح موقع التسليم في Google Maps'),
              ),
              const SizedBox(height: 10),
            ],
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: const Color(0xFFFFF5E2),
                border: Border.all(color: const Color(0xFFE2B66D)),
                borderRadius: BorderRadius.circular(16),
              ),
              child: const Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(Icons.warning_amber_rounded, color: Color(0xFF915911)),
                  SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      'تنبيه قبل التسعير: افتح رابط Google Maps وراجع مسار الوصول والبوابة وخيارات التنزيل بعناية. لا تعتمد السعر والتوفر حتى تتأكد من إمكانية التوصيل للموقع.',
                      style: TextStyle(
                        color: Color(0xFF6E430E),
                        fontWeight: FontWeight.w800,
                        height: 1.65,
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 14),
            if (existing != null) ...[
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: BunyaColors.mint,
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Row(
                  children: [
                    const Icon(
                      Icons.check_circle_rounded,
                      color: BunyaColors.forest,
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        canRevise
                            ? 'وصل سعر منافس أقل. عرضك ${existing['response_code'] ?? ''} محفوظ، ويمكنك اختيار تخفيضه قبل انتهاء المهلة.'
                            : 'تم حفظ عرضك ${existing['response_code'] ?? ''} وأُغلق التعديل عليه.',
                        style: const TextStyle(
                          color: BunyaColors.forest,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 12),
              _Facts(
                values: {
                  'سعر الوحدة': '$unitPrice ر.س',
                  'الكمية المتوفرة':
                      '${existing['available_quantity'] ?? '—'} ${row['unit_snapshot'] ?? ''}',
                  'تكلفة التوصيل': '$deliveryFee ر.س',
                  'إجمالي العرض': '${subtotal + vat + deliveryFee} ر.س',
                  'التجهيز': '${existing['preparation_hours'] ?? 0} ساعة',
                  'التوصيل': '${existing['delivery_hours'] ?? 0} ساعة',
                  'الضريبة': existing['vat_inclusive'] == true
                      ? 'شامل الضريبة'
                      : 'تضاف 15%',
                  'الحالة': _status('${existing['status'] ?? 'proposed'}'),
                },
              ),
              if ('${existing['notes'] ?? ''}'.trim().isNotEmpty) ...[
                const SizedBox(height: 12),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(16),
                  decoration: _panel(),
                  child: Text(
                    '${existing['notes']}',
                    style: const TextStyle(fontWeight: FontWeight.w700),
                  ),
                ),
              ],
              if (canRevise) ...[
                const SizedBox(height: 12),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: const Color(0xFFFFF5E2),
                    border: Border.all(color: const Color(0xFFE2B66D)),
                    borderRadius: BorderRadius.circular(16),
                  ),
                  child: Text(
                    'أقل تكلفة منافسة الآن: ${existing['current_competitor_landed_cost'] ?? '—'} ر.س. التخفيض اختياري في كل جولة، ويجب أن يكون إجمالي عرضك الجديد شامل الضريبة والتوصيل أقل من السعر المنافس الحالي.',
                    style: const TextStyle(
                      color: Color(0xFF6E430E),
                      fontWeight: FontWeight.w900,
                      height: 1.55,
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: price,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(
                    labelText: 'سعر الوحدة الجديد (ر.س)',
                  ),
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: delivery,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(
                    labelText: 'تكلفة التوصيل الجديدة',
                  ),
                ),
                const SizedBox(height: 10),
                CheckboxListTile(
                  value: locationReviewed,
                  onChanged: (value) =>
                      setState(() => locationReviewed = value ?? false),
                  controlAffinity: ListTileControlAffinity.leading,
                  contentPadding: const EdgeInsets.symmetric(horizontal: 4),
                  title: const Text(
                    'راجعت موقع التسليم، وأؤكد أن السعر والمدة الجديدة صالحان لهذا الموقع.',
                    style: TextStyle(fontWeight: FontWeight.w800, height: 1.55),
                  ),
                ),
                const SizedBox(height: 12),
                FilledButton.icon(
                  onPressed: busy || !locationReviewed
                      ? null
                      : () async {
                          if ((double.tryParse(price.text) ?? 0) <= 0) {
                            return _notice(context, 'أدخل سعرًا صحيحًا');
                          }
                          final newUnit = double.parse(price.text);
                          final newDelivery =
                              double.tryParse(delivery.text) ?? 0;
                          final competitor =
                              (existing['current_competitor_landed_cost']
                                      as num?)
                                  ?.toDouble();
                          final newTotal =
                              newUnit *
                                  quantity *
                                  (existing['vat_inclusive'] == true
                                      ? 1
                                      : 1.15) +
                              newDelivery;
                          if (competitor != null && newTotal >= competitor) {
                            return _notice(
                              context,
                              'يجب أن يكون الإجمالي الجديد أقل من السعر المنافس الحالي',
                            );
                          }
                          setState(() => busy = true);
                          try {
                            await widget.repository.submitProviderPrice(
                              id: widget.id,
                              price: double.parse(price.text),
                              quantity: quantity,
                              deliveryFee: double.tryParse(delivery.text) ?? 0,
                              preparationHours:
                                  (existing['preparation_hours'] as num? ?? 0)
                                      .toInt(),
                              deliveryHours:
                                  (existing['delivery_hours'] as num? ?? 0)
                                      .toInt(),
                              notes: notes.text,
                              revision: true,
                            );
                            if (context.mounted) {
                              _notice(context, 'تم حفظ السعر المخفّض');
                              Navigator.pop(context);
                            }
                          } catch (error) {
                            if (context.mounted) {
                              _notice(context, _clean(error));
                            }
                          }
                          if (mounted) setState(() => busy = false);
                        },
                  icon: const Icon(Icons.trending_down_rounded),
                  label: const Text('حفظ السعر المخفّض'),
                ),
              ],
            ] else if (!window.$1) ...[
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: const Color(0xFFFFECE7),
                  borderRadius: BorderRadius.circular(18),
                ),
                child: Text(
                  window.$2 == 'انتهت مهلة التسعير'
                      ? 'انتهت المهلة ولا يقبل النظام أي سعر جديد لهذا المنتج.'
                      : 'يمكن مراجعة الطلب عند فتح النافذة، ولن يقبل النظام إرسال السعر قبل الموعد الموضح.',
                  style: const TextStyle(
                    color: BunyaColors.copperDark,
                    fontWeight: FontWeight.w900,
                    height: 1.6,
                  ),
                ),
              ),
            ] else ...[
              TextField(
                controller: price,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(
                  labelText: 'سعر الوحدة (ر.س)',
                ),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: delivery,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(labelText: 'تكلفة التوصيل'),
              ),
              const SizedBox(height: 10),
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: preparation,
                      keyboardType: TextInputType.number,
                      decoration: const InputDecoration(
                        labelText: 'ساعات التجهيز',
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: TextField(
                      controller: deliveryHours,
                      keyboardType: TextInputType.number,
                      decoration: const InputDecoration(
                        labelText: 'ساعات التوصيل',
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              TextField(
                controller: notes,
                maxLines: 3,
                decoration: const InputDecoration(labelText: 'ملاحظات العرض'),
              ),
              const SizedBox(height: 10),
              CheckboxListTile(
                value: locationReviewed,
                onChanged: (value) =>
                    setState(() => locationReviewed = value ?? false),
                controlAffinity: ListTileControlAffinity.leading,
                contentPadding: const EdgeInsets.symmetric(horizontal: 4),
                title: const Text(
                  'أؤكد أنني راجعت رابط Google Maps وتعليمات الوصول ويمكنني التوصيل للموقع بالسعر والمدة المدخلين.',
                  style: TextStyle(fontWeight: FontWeight.w800, height: 1.55),
                ),
              ),
              const SizedBox(height: 16),
              FilledButton.icon(
                onPressed: busy || !locationReviewed
                    ? null
                    : () async {
                        if ((double.tryParse(price.text) ?? 0) <= 0) {
                          return _notice(context, 'أدخل سعرًا صحيحًا');
                        }
                        setState(() => busy = true);
                        try {
                          await widget.repository.submitProviderPrice(
                            id: widget.id,
                            price: double.parse(price.text),
                            quantity: quantity,
                            deliveryFee: double.tryParse(delivery.text) ?? 0,
                            preparationHours:
                                int.tryParse(preparation.text) ?? 0,
                            deliveryHours:
                                int.tryParse(deliveryHours.text) ?? 0,
                            notes: notes.text,
                          );
                          if (context.mounted) {
                            _notice(context, 'تم استلام عرض السعر');
                            Navigator.pop(context);
                          }
                        } catch (error) {
                          if (context.mounted) {
                            _notice(context, _clean(error));
                          }
                        }
                        if (mounted) setState(() => busy = false);
                      },
                icon: const Icon(Icons.send_rounded),
                label: const Text('تأكيد وإرسال العرض'),
              ),
            ],
          ],
        );
      },
    ),
  );
}

class _ContractorOpportunities extends StatefulWidget {
  const _ContractorOpportunities({required this.repository});
  final WorkspaceRepository repository;
  @override
  State<_ContractorOpportunities> createState() =>
      _ContractorOpportunitiesState();
}

class _ContractorOpportunitiesState extends State<_ContractorOpportunities> {
  late Future<List<Map<String, dynamic>>> rows = widget.repository
      .contractorOpportunities();

  void reload() => setState(() {
    rows = widget.repository.contractorOpportunities();
  });

  @override
  void initState() {
    super.initState();
    AppDataRefresh.revision.addListener(reload);
  }

  @override
  void dispose() {
    AppDataRefresh.revision.removeListener(reload);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => _FutureList(
    title: 'فرص المشاريع',
    caption: 'فرص مطابقة للتخصص والمنطقة وحالة الحساب.',
    future: rows,
    item: (row) => _RecordCard(
      title: '${row['title'] ?? 'مشروع جديد'}',
      subtitle: '${row['city'] ?? '—'} · ${row['project_type'] ?? '—'}',
      status: '${row['request_code'] ?? 'فرصة'}',
      onTap: () => Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => ContractorProposalScreen(
            repository: widget.repository,
            opportunity: row,
          ),
        ),
      ),
    ),
  );
}

class ContractorProposalScreen extends StatefulWidget {
  const ContractorProposalScreen({
    super.key,
    required this.repository,
    required this.opportunity,
  });
  final WorkspaceRepository repository;
  final Map<String, dynamic> opportunity;
  @override
  State<ContractorProposalScreen> createState() =>
      _ContractorProposalScreenState();
}

class _ContractorProposalScreenState extends State<ContractorProposalScreen> {
  final amount = TextEditingController(),
      duration = TextEditingController(),
      scope = TextEditingController();
  bool busy = false;
  @override
  void dispose() {
    amount.dispose();
    duration.dispose();
    scope.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('تقديم عرض المشروع')),
    body: ListView(
      padding: const EdgeInsets.all(16),
      children: [
        _DetailHeader(
          title: '${widget.opportunity['title']}',
          caption: '${widget.opportunity['request_code']}',
        ),
        const SizedBox(height: 12),
        _Facts(
          values: {
            'المدينة': '${widget.opportunity['city'] ?? '—'}',
            'النوع': '${widget.opportunity['project_type'] ?? '—'}',
            'الميزانية':
                '${widget.opportunity['estimated_budget_min'] ?? '—'} – ${widget.opportunity['estimated_budget_max'] ?? '—'} ر.س',
            'البداية': '${widget.opportunity['expected_start_at'] ?? '—'}',
          },
        ),
        const SizedBox(height: 14),
        TextField(
          controller: amount,
          keyboardType: TextInputType.number,
          decoration: const InputDecoration(labelText: 'قيمة العرض (ر.س)'),
        ),
        const SizedBox(height: 10),
        TextField(
          controller: duration,
          decoration: const InputDecoration(labelText: 'مدة التنفيذ'),
        ),
        const SizedBox(height: 10),
        TextField(
          controller: scope,
          maxLines: 5,
          decoration: const InputDecoration(
            labelText: 'نطاق العمل وتفاصيل العرض',
          ),
        ),
        const SizedBox(height: 16),
        FilledButton.icon(
          onPressed: busy
              ? null
              : () async {
                  if ((double.tryParse(amount.text) ?? 0) <= 0 ||
                      duration.text.trim().isEmpty ||
                      scope.text.trim().length < 10) {
                    return _notice(
                      context,
                      'أكمل قيمة العرض والمدة ونطاق العمل',
                    );
                  }
                  setState(() => busy = true);
                  try {
                    await widget.repository.submitContractorProposal(
                      opportunityId: '${widget.opportunity['opportunity_id']}',
                      amount: double.parse(amount.text),
                      duration: duration.text.trim(),
                      scope: scope.text.trim(),
                    );
                    if (context.mounted) {
                      _notice(context, 'تم استلام عرض المشروع');
                      Navigator.pop(context);
                    }
                  } catch (error) {
                    if (context.mounted) _notice(context, _clean(error));
                  }
                  if (mounted) setState(() => busy = false);
                },
          icon: const Icon(Icons.send_rounded),
          label: const Text('إرسال العرض للإدارة والعميل'),
        ),
      ],
    ),
  );
}

class _AdminApplications extends StatefulWidget {
  const _AdminApplications({required this.repository});
  final WorkspaceRepository repository;
  @override
  State<_AdminApplications> createState() => _AdminApplicationsState();
}

class _AdminApplicationsState extends State<_AdminApplications> {
  late Future<List<Map<String, dynamic>>> rows = widget.repository
      .adminApplications();
  String selectedKind = 'provider';
  String selectedStatus = 'all';

  void reload() => setState(() {
    rows = widget.repository.adminApplications();
  });

  @override
  void initState() {
    super.initState();
    AppDataRefresh.revision.addListener(reload);
  }

  @override
  void dispose() {
    AppDataRefresh.revision.removeListener(reload);
    super.dispose();
  }

  Future<void> open(Map<String, dynamic> row) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) =>
          _AdminDecisionSheet(repository: widget.repository, row: row),
    );
    reload();
  }

  @override
  Widget build(BuildContext context) =>
      FutureBuilder<List<Map<String, dynamic>>>(
        future: rows,
        builder: (context, snapshot) {
          final data = snapshot.data ?? const <Map<String, dynamic>>[];
          final providers = data
              .where((row) => row['_kind'] == 'provider')
              .length;
          final contractors = data
              .where((row) => row['_kind'] == 'contractor')
              .length;
          final kindRows = data
              .where((row) => row['_kind'] == selectedKind)
              .toList();
          final visible = kindRows.where((row) {
            if (selectedStatus == 'all') return true;
            if (selectedStatus == 'active') {
              return const {
                'pending',
                'needs_changes',
              }.contains('${row['status']}');
            }
            return '${row['status']}' == selectedStatus;
          }).toList();

          return RefreshIndicator(
            onRefresh: () async {
              reload();
              await rows;
            },
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 26),
              children: [
                const _PageHeading(
                  title: 'طلبات الانضمام',
                  caption: 'مراجعة منظمة، تفاصيل كاملة، وقرار واضح لكل طلب.',
                ),
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(
                      child: _JoinTypeSelector(
                        title: 'المزودون',
                        caption: 'توريد وتسعير',
                        count: providers,
                        icon: Icons.storefront_rounded,
                        selected: selectedKind == 'provider',
                        color: BunyaColors.forest,
                        onTap: () => setState(() {
                          selectedKind = 'provider';
                          selectedStatus = 'all';
                        }),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: _JoinTypeSelector(
                        title: 'المقاولون',
                        caption: 'مشاريع وتنفيذ',
                        count: contractors,
                        icon: Icons.engineering_rounded,
                        selected: selectedKind == 'contractor',
                        color: BunyaColors.copperDark,
                        onTap: () => setState(() {
                          selectedKind = 'contractor';
                          selectedStatus = 'all';
                        }),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Row(
                    children: [
                      for (final filter in const [
                        ('all', 'الكل'),
                        ('active', 'بانتظار القرار'),
                        ('needs_changes', 'بحاجة تعديل'),
                        ('approved', 'معتمد'),
                        ('rejected', 'مرفوض'),
                      ]) ...[
                        ChoiceChip(
                          label: Text(filter.$2),
                          selected: selectedStatus == filter.$1,
                          onSelected: (_) =>
                              setState(() => selectedStatus = filter.$1),
                          showCheckmark: false,
                          selectedColor: selectedKind == 'provider'
                              ? BunyaColors.forest
                              : BunyaColors.copperDark,
                          labelStyle: TextStyle(
                            color: selectedStatus == filter.$1
                                ? Colors.white
                                : BunyaColors.ink,
                            fontSize: 11,
                            fontWeight: FontWeight.w900,
                          ),
                          side: const BorderSide(color: BunyaColors.line),
                        ),
                        const SizedBox(width: 7),
                      ],
                    ],
                  ),
                ),
                const SizedBox(height: 14),
                Row(
                  children: [
                    Text(
                      selectedKind == 'provider'
                          ? 'طلبات المزودين'
                          : 'طلبات المقاولين',
                      style: const TextStyle(
                        fontSize: 17,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const Spacer(),
                    Text(
                      '${visible.length} طلب',
                      style: const TextStyle(
                        color: BunyaColors.muted,
                        fontSize: 11,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                if (snapshot.connectionState == ConnectionState.waiting)
                  const Center(
                    child: Padding(
                      padding: EdgeInsets.all(35),
                      child: CircularProgressIndicator(),
                    ),
                  )
                else if (snapshot.hasError)
                  _Empty(text: _clean(snapshot.error!))
                else if (visible.isEmpty)
                  const _Empty(text: 'لا توجد طلبات مطابقة لهذه الفلترة')
                else
                  ...visible.map(
                    (row) =>
                        _JoinApplicationCard(row: row, onTap: () => open(row)),
                  ),
              ],
            ),
          );
        },
      );
}

class _JoinTypeSelector extends StatelessWidget {
  const _JoinTypeSelector({
    required this.title,
    required this.caption,
    required this.count,
    required this.icon,
    required this.selected,
    required this.color,
    required this.onTap,
  });
  final String title, caption;
  final int count;
  final IconData icon;
  final bool selected;
  final Color color;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Material(
    color: selected ? color : Colors.white,
    borderRadius: BorderRadius.circular(24),
    child: InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(24),
      child: Container(
        padding: const EdgeInsets.all(15),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(24),
          border: Border.all(color: selected ? color : BunyaColors.line),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 39,
                  height: 39,
                  decoration: BoxDecoration(
                    color: selected
                        ? Colors.white.withValues(alpha: .16)
                        : color.withValues(alpha: .10),
                    borderRadius: BorderRadius.circular(13),
                  ),
                  child: Icon(icon, color: selected ? Colors.white : color),
                ),
                const Spacer(),
                Text(
                  '$count',
                  style: TextStyle(
                    color: selected ? Colors.white : color,
                    fontSize: 22,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 13),
            Text(
              title,
              style: TextStyle(
                color: selected ? Colors.white : BunyaColors.ink,
                fontSize: 16,
                fontWeight: FontWeight.w900,
              ),
            ),
            Text(
              caption,
              style: TextStyle(
                color: selected ? Colors.white70 : BunyaColors.muted,
                fontSize: 10,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
      ),
    ),
  );
}

class _JoinApplicationCard extends StatelessWidget {
  const _JoinApplicationCard({required this.row, required this.onTap});
  final Map<String, dynamic> row;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final provider = row['_kind'] == 'provider';
    final status = '${row['status']}';
    final active = const {'pending', 'needs_changes'}.contains(status);
    final regions =
        ((row[provider
                        ? 'provider_delivery_regions'
                        : 'contractor_work_regions']
                    as List?) ??
                const [])
            .length;
    final expertise =
        ((row[provider
                        ? 'provider_application_categories'
                        : 'contractor_specialties']
                    as List?) ??
                const [])
            .length;
    final color = provider ? BunyaColors.forest : BunyaColors.copperDark;
    final name = '${provider ? row['company_name'] : row['contractor_name']}';

    return Card(
      margin: const EdgeInsets.only(bottom: 11),
      elevation: 0,
      color: Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(23),
        side: BorderSide(
          color: active ? color.withValues(alpha: .30) : BunyaColors.line,
        ),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(15),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    width: 48,
                    height: 48,
                    decoration: BoxDecoration(
                      color: color.withValues(alpha: .10),
                      borderRadius: BorderRadius.circular(16),
                    ),
                    child: Icon(
                      provider
                          ? Icons.storefront_rounded
                          : Icons.engineering_rounded,
                      color: color,
                    ),
                  ),
                  const SizedBox(width: 11),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          name,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 15,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                        const SizedBox(height: 3),
                        Text(
                          provider
                              ? '${row['contact_name'] ?? 'مسؤول المنشأة'}'
                              : 'مقدم طلب مقاول',
                          style: const TextStyle(
                            color: BunyaColors.muted,
                            fontSize: 10,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ],
                    ),
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 9,
                      vertical: 6,
                    ),
                    decoration: BoxDecoration(
                      color: active ? BunyaColors.mint : BunyaColors.sand,
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Text(
                      _status(status),
                      style: TextStyle(
                        color: active ? BunyaColors.forest : BunyaColors.muted,
                        fontSize: 9,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 13),
              _JoinContactLine(
                icon: Icons.phone_outlined,
                text: '${row['mobile']}',
              ),
              const SizedBox(height: 6),
              _JoinContactLine(
                icon: Icons.alternate_email_rounded,
                text: '${row['email']}',
              ),
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 12),
                child: Divider(height: 1, color: BunyaColors.line),
              ),
              Row(
                children: [
                  _JoinMetric(
                    icon: provider
                        ? Icons.category_outlined
                        : Icons.handyman_outlined,
                    text: '$expertise ${provider ? 'تصنيف' : 'تخصص'}',
                  ),
                  const SizedBox(width: 12),
                  _JoinMetric(icon: Icons.map_outlined, text: '$regions منطقة'),
                  const Spacer(),
                  Text(
                    _date(row['created_at']),
                    style: const TextStyle(
                      color: BunyaColors.muted,
                      fontSize: 9,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Container(
                height: 42,
                decoration: BoxDecoration(
                  color: color.withValues(alpha: .07),
                  borderRadius: BorderRadius.circular(14),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text(
                      active
                          ? 'مراجعة الطلب واتخاذ القرار'
                          : 'عرض الملف الكامل',
                      style: TextStyle(
                        color: color,
                        fontSize: 11,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(width: 7),
                    Icon(Icons.arrow_back_rounded, color: color, size: 18),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _JoinContactLine extends StatelessWidget {
  const _JoinContactLine({required this.icon, required this.text});
  final IconData icon;
  final String text;
  @override
  Widget build(BuildContext context) => Row(
    children: [
      Icon(icon, size: 16, color: BunyaColors.copper),
      const SizedBox(width: 7),
      Expanded(
        child: Text(
          text,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700),
        ),
      ),
    ],
  );
}

class _JoinMetric extends StatelessWidget {
  const _JoinMetric({required this.icon, required this.text});
  final IconData icon;
  final String text;
  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      Icon(icon, size: 15, color: BunyaColors.muted),
      const SizedBox(width: 4),
      Text(
        text,
        style: const TextStyle(
          color: BunyaColors.muted,
          fontSize: 9,
          fontWeight: FontWeight.w800,
        ),
      ),
    ],
  );
}

class _AdminDecisionSheet extends StatefulWidget {
  const _AdminDecisionSheet({required this.repository, required this.row});
  final WorkspaceRepository repository;
  final Map<String, dynamic> row;
  @override
  State<_AdminDecisionSheet> createState() => _AdminDecisionSheetState();
}

class _AdminDecisionSheetState extends State<_AdminDecisionSheet> {
  final reason = TextEditingController();
  bool busy = false;
  @override
  void dispose() {
    reason.dispose();
    super.dispose();
  }

  Future<void> action(String value) async {
    if ((value == 'reject' || value == 'needs-changes') &&
        reason.text.trim().length < 5) {
      return _notice(context, 'اكتب سبب القرار بوضوح');
    }
    setState(() => busy = true);
    try {
      final result = await widget.repository.reviewApplication(
        kind: '${widget.row['_kind']}',
        id: '${widget.row['id']}',
        action: value,
        reason: reason.text.trim(),
      );
      if (mounted) {
        _notice(context, 'تم التنفيذ: $result');
        Navigator.pop(context);
      }
    } catch (error) {
      if (mounted) _notice(context, _clean(error));
    }
    if (mounted) setState(() => busy = false);
  }

  @override
  Widget build(BuildContext context) {
    final provider = widget.row['_kind'] == 'provider';
    final row = widget.row;
    final categories =
        ((row['provider_application_categories'] as List?) ?? const [])
            .map((raw) {
              final item = raw as Map;
              final category = item['product_categories'];
              return '${item['custom_category'] ?? (category is Map ? category['name'] : null) ?? ''}'
                  .trim();
            })
            .where((value) => value.isNotEmpty)
            .toList();
    final regions =
        (((provider
                        ? row['provider_delivery_regions']
                        : row['contractor_work_regions'])
                    as List?) ??
                const [])
            .map((raw) => '${(raw as Map)['region_name'] ?? ''}'.trim())
            .where((value) => value.isNotEmpty)
            .toList();
    final specialties = ((row['contractor_specialties'] as List?) ?? const [])
        .map((raw) => '${(raw as Map)['specialty_name'] ?? ''}'.trim())
        .where((value) => value.isNotEmpty)
        .toList();
    final documents = ((row['documents'] as List?) ?? const [])
        .map((raw) => Map<String, dynamic>.from(raw as Map))
        .toList();
    final reviews = ((row['reviews'] as List?) ?? const [])
        .map((raw) => Map<String, dynamic>.from(raw as Map))
        .toList();
    final onboarding = row['onboarding'] is Map
        ? Map<String, dynamic>.from(row['onboarding'] as Map)
        : null;
    final mapsUrl = '${row['google_maps_url'] ?? ''}'.trim();
    final editable = const {'pending', 'needs_changes'}.contains(row['status']);
    return SafeArea(
      top: false,
      child: Container(
        height: MediaQuery.sizeOf(context).height * .94,
        decoration: const BoxDecoration(
          color: BunyaColors.surface,
          borderRadius: BorderRadius.vertical(top: Radius.circular(30)),
        ),
        child: SingleChildScrollView(
          padding: EdgeInsets.fromLTRB(
            18,
            10,
            18,
            MediaQuery.viewInsetsOf(context).bottom + 24,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  width: 44,
                  height: 5,
                  margin: const EdgeInsets.only(bottom: 14),
                  decoration: BoxDecoration(
                    color: BunyaColors.line,
                    borderRadius: BorderRadius.circular(20),
                  ),
                ),
              ),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    colors: provider
                        ? const [BunyaColors.forest, Color(0xFF26745F)]
                        : const [BunyaColors.copperDark, BunyaColors.copper],
                  ),
                  borderRadius: BorderRadius.circular(27),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Container(
                          width: 46,
                          height: 46,
                          decoration: BoxDecoration(
                            color: Colors.white.withValues(alpha: .14),
                            borderRadius: BorderRadius.circular(15),
                          ),
                          child: Icon(
                            provider
                                ? Icons.storefront_rounded
                                : Icons.engineering_rounded,
                            color: Colors.white,
                          ),
                        ),
                        const Spacer(),
                        IconButton(
                          onPressed: () => Navigator.pop(context),
                          icon: const Icon(
                            Icons.close_rounded,
                            color: Colors.white,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 18),
                    Text(
                      provider ? 'طلب انضمام مزود' : 'طلب انضمام مقاول',
                      style: const TextStyle(
                        color: Colors.white70,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      '${provider ? row['company_name'] : row['contractor_name']}',
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 23,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 11),
                    Wrap(
                      spacing: 7,
                      runSpacing: 7,
                      children: [
                        _HeroBadge(
                          text: _status('${row['status']}'),
                          icon: Icons.verified_outlined,
                        ),
                        _HeroBadge(
                          text: _date(row['created_at']),
                          icon: Icons.event_outlined,
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 22),
              const _SectionTitle(
                icon: Icons.badge_outlined,
                title: 'بيانات مقدم الطلب',
              ),
              const SizedBox(height: 10),
              LayoutBuilder(
                builder: (context, constraints) {
                  final width = (constraints.maxWidth - 9) / 2;
                  return Wrap(
                    spacing: 9,
                    runSpacing: 9,
                    children: [
                      if (provider)
                        SizedBox(
                          width: width,
                          child: _RecordFact(
                            label: 'اسم المسؤول',
                            value: '${row['contact_name'] ?? 'غير محدد'}',
                            icon: Icons.person_outline_rounded,
                            wide: false,
                          ),
                        ),
                      SizedBox(
                        width: width,
                        child: _RecordFact(
                          label: 'رقم الجوال',
                          value: '${row['mobile'] ?? 'غير محدد'}',
                          icon: Icons.phone_rounded,
                          wide: false,
                        ),
                      ),
                      SizedBox(
                        width: provider ? constraints.maxWidth : width,
                        child: _RecordFact(
                          label: 'البريد الإلكتروني',
                          value: '${row['email'] ?? 'غير محدد'}',
                          icon: Icons.alternate_email_rounded,
                          wide: provider,
                        ),
                      ),
                      if (provider)
                        SizedBox(
                          width: width,
                          child: _RecordFact(
                            label: 'اسم المستخدم المطلوب',
                            value: '${row['requested_username'] ?? 'غير محدد'}',
                            icon: Icons.account_circle_outlined,
                            wide: false,
                          ),
                        ),
                      if (provider)
                        SizedBox(
                          width: width,
                          child: _RecordFact(
                            label: 'خدمة التوصيل',
                            value: row['delivery_available'] == true
                                ? 'متوفرة'
                                : 'غير متوفرة',
                            icon: Icons.local_shipping_outlined,
                            wide: false,
                          ),
                        ),
                    ],
                  );
                },
              ),
              const SizedBox(height: 22),
              _SectionTitle(
                icon: provider
                    ? Icons.category_outlined
                    : Icons.handyman_outlined,
                title: provider ? 'تصنيفات المنتجات' : 'التخصصات',
              ),
              const SizedBox(height: 10),
              _JoinTags(
                values: provider ? categories : specialties,
                empty: provider
                    ? 'لم تُحدد تصنيفات للمنتجات'
                    : 'لم تُحدد تخصصات',
              ),
              const SizedBox(height: 18),
              const _SectionTitle(
                icon: Icons.map_outlined,
                title: 'مناطق العمل والتغطية',
              ),
              const SizedBox(height: 10),
              _JoinTags(values: regions, empty: 'لم تُحدد مناطق تغطية'),
              if (mapsUrl.isNotEmpty) ...[
                const SizedBox(height: 10),
                _RecordFact(
                  label: 'موقع المنشأة على الخريطة',
                  value: mapsUrl,
                  icon: Icons.location_on_outlined,
                  url: mapsUrl,
                  wide: true,
                ),
              ],
              const SizedBox(height: 22),
              const _SectionTitle(
                icon: Icons.folder_copy_outlined,
                title: 'المستندات المرفقة',
              ),
              const SizedBox(height: 10),
              if (documents.isEmpty)
                const _Empty(text: 'لا توجد مستندات مرفقة')
              else
                ...documents.map(
                  (document) => Container(
                    margin: const EdgeInsets.only(bottom: 8),
                    padding: const EdgeInsets.all(14),
                    decoration: _panel(),
                    child: Row(
                      children: [
                        Container(
                          width: 42,
                          height: 42,
                          decoration: BoxDecoration(
                            color: BunyaColors.sand,
                            borderRadius: BorderRadius.circular(13),
                          ),
                          child: const Icon(
                            Icons.description_outlined,
                            color: BunyaColors.copper,
                          ),
                        ),
                        const SizedBox(width: 11),
                        Expanded(
                          child: Text(
                            '${document['name'] ?? 'مستند مرفق'}',
                            style: const TextStyle(fontWeight: FontWeight.w900),
                          ),
                        ),
                        const Icon(
                          Icons.verified_rounded,
                          color: BunyaColors.forest,
                          size: 19,
                        ),
                      ],
                    ),
                  ),
                ),
              if ('${row['review_notes'] ?? ''}'.trim().isNotEmpty ||
                  reviews.isNotEmpty) ...[
                const SizedBox(height: 22),
                const _SectionTitle(
                  icon: Icons.history_rounded,
                  title: 'سجل المراجعة',
                ),
                const SizedBox(height: 10),
                if ('${row['review_notes'] ?? ''}'.trim().isNotEmpty)
                  _JoinReviewCard(
                    outcome: '${row['status']}',
                    reason: '${row['review_notes']}',
                    date: row['reviewed_at'],
                  ),
                ...reviews
                    .take(4)
                    .map(
                      (review) => _JoinReviewCard(
                        outcome: '${review['outcome'] ?? 'pending'}',
                        reason: '${review['reason'] ?? ''}',
                        date: review['created_at'],
                      ),
                    ),
              ],
              if (onboarding != null) ...[
                const SizedBox(height: 22),
                const _SectionTitle(
                  icon: Icons.outgoing_mail,
                  title: 'تسليم بيانات الدخول',
                ),
                const SizedBox(height: 10),
                _Facts(
                  values: {
                    'إنشاء الحساب': _status(
                      '${onboarding['provisioning_status'] ?? 'pending'}',
                    ),
                    'البريد': _status(
                      '${onboarding['email_delivery_status'] ?? 'pending'}',
                    ),
                    'واتساب': _status(
                      '${onboarding['whatsapp_delivery_status'] ?? 'pending'}',
                    ),
                  },
                ),
                if ('${onboarding['last_delivery_error'] ?? ''}'
                    .trim()
                    .isNotEmpty) ...[
                  const SizedBox(height: 8),
                  Text(
                    'تعذر آخر إرسال، ويمكن إعادة المحاولة من سجل الإشعارات.',
                    style: const TextStyle(
                      color: BunyaColors.danger,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ],
              if (editable) ...[
                const SizedBox(height: 24),
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: BunyaColors.sand,
                    borderRadius: BorderRadius.circular(23),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'قرار الطلب',
                        style: TextStyle(
                          fontSize: 17,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      const SizedBox(height: 5),
                      const Text(
                        'راجع جميع البيانات والمرفقات قبل اعتماد الحساب.',
                        style: TextStyle(
                          color: BunyaColors.muted,
                          fontSize: 11,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 12),
                      TextField(
                        controller: reason,
                        maxLines: 3,
                        decoration: const InputDecoration(
                          hintText: 'سبب الرفض أو البيانات المطلوب تعديلها',
                        ),
                      ),
                      const SizedBox(height: 12),
                      FilledButton.icon(
                        onPressed: busy ? null : () => action('approve'),
                        icon: const Icon(Icons.verified_rounded),
                        label: const Text('اعتماد الحساب وإرسال بيانات الدخول'),
                      ),
                      const SizedBox(height: 8),
                      OutlinedButton.icon(
                        onPressed: busy ? null : () => action('needs-changes'),
                        icon: const Icon(Icons.edit_note_rounded),
                        label: const Text('طلب تعديل البيانات'),
                        style: OutlinedButton.styleFrom(
                          minimumSize: const Size.fromHeight(50),
                        ),
                      ),
                      TextButton.icon(
                        onPressed: busy ? null : () => action('reject'),
                        icon: const Icon(Icons.close_rounded),
                        label: const Text('رفض الطلب'),
                        style: TextButton.styleFrom(
                          foregroundColor: BunyaColors.danger,
                          minimumSize: const Size.fromHeight(48),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _JoinTags extends StatelessWidget {
  const _JoinTags({required this.values, required this.empty});
  final List<String> values;
  final String empty;
  @override
  Widget build(BuildContext context) => values.isEmpty
      ? _Empty(text: empty)
      : Wrap(
          spacing: 7,
          runSpacing: 7,
          children: values
              .map(
                (value) => Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 8,
                  ),
                  decoration: BoxDecoration(
                    color: BunyaColors.mint,
                    borderRadius: BorderRadius.circular(30),
                  ),
                  child: Text(
                    value,
                    style: const TextStyle(
                      color: BunyaColors.forest,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ),
              )
              .toList(),
        );
}

class _JoinReviewCard extends StatelessWidget {
  const _JoinReviewCard({
    required this.outcome,
    required this.reason,
    required this.date,
  });
  final String outcome, reason;
  final Object? date;
  @override
  Widget build(BuildContext context) => Container(
    width: double.infinity,
    margin: const EdgeInsets.only(bottom: 8),
    padding: const EdgeInsets.all(14),
    decoration: _panel(),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Text(
              _status(outcome),
              style: const TextStyle(
                color: BunyaColors.forest,
                fontWeight: FontWeight.w900,
              ),
            ),
            const Spacer(),
            Text(
              _date(date),
              style: const TextStyle(
                color: BunyaColors.muted,
                fontSize: 10,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
        if (reason.trim().isNotEmpty) ...[
          const SizedBox(height: 6),
          Text(
            reason,
            style: const TextStyle(
              color: BunyaColors.muted,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ],
    ),
  );
}

class AdminFinanceScreen extends StatefulWidget {
  const AdminFinanceScreen({super.key, required this.repository});
  final WorkspaceRepository repository;

  @override
  State<AdminFinanceScreen> createState() => _AdminFinanceScreenState();
}

class _AdminFinanceScreenState extends State<AdminFinanceScreen> {
  late Future<List<Map<String, dynamic>>> _rows = widget.repository
      .loadAdminProviderFinance();

  void _reload() => setState(() {
    _rows = widget.repository.loadAdminProviderFinance();
  });

  double _amount(Map<String, dynamic> row, String key) =>
      (row[key] as num?)?.toDouble() ?? 0;

  String _money(double value) => '${value.toStringAsFixed(2)} ر.س';

  Future<void> _editRate(Map<String, dynamic> row) async {
    final controller = TextEditingController(
      text: _amount(row, 'commission_rate').toStringAsFixed(2),
    );
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (sheetContext) => Padding(
        padding: EdgeInsets.only(
          bottom: MediaQuery.viewInsetsOf(sheetContext).bottom,
        ),
        child: Container(
          padding: const EdgeInsets.fromLTRB(20, 14, 20, 24),
          decoration: const BoxDecoration(
            color: BunyaColors.surface,
            borderRadius: BorderRadius.vertical(top: Radius.circular(26)),
          ),
          child: SafeArea(
            top: false,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Center(
                  child: Container(
                    width: 42,
                    height: 4,
                    decoration: BoxDecoration(
                      color: BunyaColors.line,
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                ),
                const SizedBox(height: 20),
                const Text(
                  'تحديد عمولة بُنية',
                  style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900),
                ),
                const SizedBox(height: 5),
                Text(
                  '${row['company_name'] ?? 'المزود'} · تطبق على العمليات الجديدة فقط',
                  style: const TextStyle(
                    color: BunyaColors.muted,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 18),
                TextField(
                  controller: controller,
                  autofocus: true,
                  keyboardType: const TextInputType.numberWithOptions(
                    decimal: true,
                  ),
                  decoration: const InputDecoration(
                    labelText: 'نسبة العمولة',
                    suffixText: '٪',
                    helperText: 'أدخل نسبة بين 0 و100',
                  ),
                ),
                const SizedBox(height: 16),
                FilledButton(
                  onPressed: () async {
                    final rate = double.tryParse(controller.text.trim());
                    if (rate == null || rate < 0 || rate > 100) {
                      ScaffoldMessenger.of(sheetContext).showSnackBar(
                        const SnackBar(
                          content: Text('النسبة يجب أن تكون بين 0 و100٪.'),
                        ),
                      );
                      return;
                    }
                    try {
                      await widget.repository.setProviderCommission(
                        '${row['provider_id']}',
                        rate,
                      );
                      if (sheetContext.mounted) {
                        Navigator.of(sheetContext).pop(true);
                      }
                    } catch (error) {
                      if (sheetContext.mounted) {
                        ScaffoldMessenger.of(sheetContext).showSnackBar(
                          SnackBar(content: Text('تعذر الحفظ: $error')),
                        );
                      }
                    }
                  },
                  child: const Text('اعتماد النسبة'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
    controller.dispose();
    if (saved == true && mounted) {
      _reload();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تم تحديث نسبة عمولة المزود.')),
      );
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: const Text('المالية والأرباح'),
      actions: [
        IconButton(
          onPressed: _reload,
          tooltip: 'تحديث',
          icon: const Icon(Icons.refresh_rounded),
        ),
      ],
    ),
    body: FutureBuilder<List<Map<String, dynamic>>>(
      future: _rows,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return const Center(child: CircularProgressIndicator());
        }
        if (snapshot.hasError) {
          return Center(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(
                    Icons.error_outline_rounded,
                    color: BunyaColors.danger,
                    size: 38,
                  ),
                  const SizedBox(height: 12),
                  Text(
                    'تعذر تحميل السجل المالي: ${snapshot.error}',
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 16),
                  FilledButton.tonal(
                    onPressed: _reload,
                    child: const Text('إعادة المحاولة'),
                  ),
                ],
              ),
            ),
          );
        }
        final rows = snapshot.data ?? const <Map<String, dynamic>>[];
        final gross = rows.fold<double>(
          0,
          (sum, row) => sum + _amount(row, 'gross_amount'),
        );
        final profit = rows.fold<double>(
          0,
          (sum, row) => sum + _amount(row, 'bunya_commission'),
        );
        final balances = rows.fold<double>(
          0,
          (sum, row) => sum + _amount(row, 'current_balance'),
        );
        return RefreshIndicator(
          onRefresh: () async {
            _reload();
            await _rows;
          },
          child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 28),
            children: [
              Container(
                padding: const EdgeInsets.all(22),
                decoration: BoxDecoration(
                  color: BunyaColors.forest,
                  borderRadius: BorderRadius.circular(22),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'دفتر بُنية المالي',
                      style: TextStyle(
                        color: Color(0xFFD8B29E),
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 10),
                    const Text(
                      'إجمالي أرباح بُنية',
                      style: TextStyle(
                        color: Colors.white70,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    Text(
                      _money(profit),
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 30,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 18),
                    Row(
                      children: [
                        Expanded(
                          child: _FinanceHeroValue(
                            label: 'إجمالي التوريد',
                            value: _money(gross),
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: _FinanceHeroValue(
                            label: 'أرصدة المزودين',
                            value: _money(balances),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 22),
              const _PageHeading(
                title: 'حسابات المزودين',
                caption: 'الرصيد بعد عمولة بُنية ونسبة كل مزود',
              ),
              const SizedBox(height: 12),
              if (rows.isEmpty)
                Container(
                  padding: const EdgeInsets.all(24),
                  decoration: _panel(),
                  child: const Text(
                    'لا يوجد مزودون في السجل المالي بعد.',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: BunyaColors.muted,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                )
              else
                for (final row in rows) ...[
                  _ProviderFinanceCard(
                    row: row,
                    money: _money,
                    amount: _amount,
                    onEditRate: () => _editRate(row),
                  ),
                  const SizedBox(height: 10),
                ],
            ],
          ),
        );
      },
    ),
  );
}

class _FinanceHeroValue extends StatelessWidget {
  const _FinanceHeroValue({required this.label, required this.value});
  final String label, value;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(13),
    decoration: BoxDecoration(
      color: Colors.white.withValues(alpha: 0.08),
      borderRadius: BorderRadius.circular(14),
      border: Border.all(color: Colors.white.withValues(alpha: 0.12)),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: const TextStyle(
            color: Colors.white70,
            fontSize: 10,
            fontWeight: FontWeight.w700,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          value,
          maxLines: 1,
          style: const TextStyle(
            color: Colors.white,
            fontWeight: FontWeight.w900,
          ),
        ),
      ],
    ),
  );
}

class _ProviderFinanceCard extends StatelessWidget {
  const _ProviderFinanceCard({
    required this.row,
    required this.money,
    required this.amount,
    required this.onEditRate,
  });
  final Map<String, dynamic> row;
  final String Function(double) money;
  final double Function(Map<String, dynamic>, String) amount;
  final VoidCallback onEditRate;

  @override
  Widget build(BuildContext context) {
    final rate = amount(row, 'commission_rate');
    return Container(
      padding: const EdgeInsets.all(17),
      decoration: _panel(),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 42,
                height: 42,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: BunyaColors.mint,
                  borderRadius: BorderRadius.circular(13),
                ),
                child: const Icon(
                  Icons.storefront_outlined,
                  color: BunyaColors.forest,
                ),
              ),
              const SizedBox(width: 11),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '${row['company_name'] ?? 'مزود'}',
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    Text(
                      '${row['transaction_count'] ?? 0} عملية مدفوعة',
                      style: const TextStyle(
                        color: BunyaColors.muted,
                        fontSize: 10,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
              ),
              OutlinedButton(
                onPressed: onEditRate,
                style: OutlinedButton.styleFrom(
                  minimumSize: const Size(76, 44),
                  foregroundColor: BunyaColors.copperDark,
                  side: const BorderSide(color: BunyaColors.line),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(13),
                  ),
                ),
                child: Text('${rate.toStringAsFixed(2)}٪'),
              ),
            ],
          ),
          const SizedBox(height: 15),
          const Divider(height: 1, color: BunyaColors.line),
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: _FinanceValue(
                  label: 'إجمالي التوريد',
                  value: money(amount(row, 'gross_amount')),
                ),
              ),
              Expanded(
                child: _FinanceValue(
                  label: 'عمولة بُنية',
                  value: money(amount(row, 'bunya_commission')),
                  accent: true,
                ),
              ),
              Expanded(
                child: _FinanceValue(
                  label: 'الرصيد لدينا',
                  value: money(amount(row, 'current_balance')),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _FinanceValue extends StatelessWidget {
  const _FinanceValue({
    required this.label,
    required this.value,
    this.accent = false,
  });
  final String label, value;
  final bool accent;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(
        label,
        style: const TextStyle(
          color: BunyaColors.muted,
          fontSize: 9,
          fontWeight: FontWeight.w700,
        ),
      ),
      const SizedBox(height: 4),
      Text(
        value,
        maxLines: 1,
        style: TextStyle(
          color: accent ? BunyaColors.copperDark : BunyaColors.ink,
          fontSize: 11,
          fontWeight: FontWeight.w900,
        ),
      ),
    ],
  );
}

class _RoleModules extends StatelessWidget {
  const _RoleModules({required this.repository, required this.contextData});
  final WorkspaceRepository repository;
  final RoleContext contextData;

  List<WorkspaceModule> get modules {
    final id = contextData.entityId;
    if (contextData.role == 'provider') {
      return [
        WorkspaceModule(
          title: 'المنتجات',
          caption: 'المنتجات والمراجعة والتوفر',
          icon: Icons.inventory_2_outlined,
          table: 'products',
          filterField: 'provider_id',
          filterValue: id,
          action: 'provider_products',
        ),
        WorkspaceModule(
          title: 'عروض الأسعار',
          caption: 'العروض المقدمة ونتائجها',
          icon: Icons.sell_outlined,
          table: 'provider_pricing_responses',
          filterField: 'provider_id',
          filterValue: id,
        ),
        WorkspaceModule(
          title: 'أوامر التوريد',
          caption: 'التجهيز والاستلام والتسليم',
          icon: Icons.local_shipping_outlined,
          table: 'internal_fulfillment_orders',
          filterField: 'provider_id',
          filterValue: id,
          action: 'fulfillment',
        ),
        WorkspaceModule(
          title: 'السائقون',
          caption: 'الحسابات وحالة السائقين',
          icon: Icons.badge_outlined,
          table: 'provider_drivers',
          filterField: 'provider_id',
          filterValue: id,
          action: 'provider_drivers',
        ),
        WorkspaceModule(
          title: 'المالية',
          caption: 'الحركات والتسويات',
          icon: Icons.account_balance_wallet_outlined,
          table: 'financial_transactions',
          filterField: 'provider_id',
          filterValue: id,
        ),
        WorkspaceModule(
          title: 'الدعم',
          caption: 'التذاكر والردود',
          icon: Icons.support_agent_outlined,
          table: 'support_tickets',
        ),
      ];
    }
    if (contextData.role == 'driver') {
      return [
        WorkspaceModule(
          title: 'مهام التوصيل',
          caption: 'المواقع وحالة الاستلام والتسليم',
          icon: Icons.local_shipping_outlined,
          table: 'provider_delivery_assignments',
          filterField: 'assigned_driver_id',
          filterValue: id,
        ),
        WorkspaceModule(
          title: 'سجل التحديثات',
          caption: 'كل انتقالات التوصيل المسجلة',
          icon: Icons.history_rounded,
          table: 'provider_delivery_updates',
        ),
      ];
    }
    if (contextData.role == 'contractor') {
      return [
        WorkspaceModule(
          title: 'العروض المقدمة',
          caption: 'حالة عروض المشاريع',
          icon: Icons.request_quote_outlined,
          table: 'contractor_proposals',
          filterField: 'contractor_profile_id',
          filterValue: id,
        ),
        WorkspaceModule(
          title: 'المشاريع',
          caption: 'التنفيذ والمراحل',
          icon: Icons.construction_outlined,
          table: 'contractor_projects',
          filterField: 'contractor_profile_id',
          filterValue: id,
        ),
        WorkspaceModule(
          title: 'الخدمات',
          caption: 'التخصصات ومناطق العمل',
          icon: Icons.home_repair_service_outlined,
          table: 'contractor_services',
          filterField: 'profile_id',
          filterValue: id,
        ),
        WorkspaceModule(
          title: 'معرض الأعمال',
          caption: 'الأعمال السابقة',
          icon: Icons.collections_outlined,
          table: 'contractor_portfolio_items',
          filterField: 'profile_id',
          filterValue: id,
        ),
        WorkspaceModule(
          title: 'التقييمات',
          caption: 'تقييمات العملاء والردود',
          icon: Icons.star_outline_rounded,
          table: 'contractor_reviews',
          filterField: 'contractor_profile_id',
          filterValue: id,
        ),
        WorkspaceModule(
          title: 'المستندات',
          caption: 'التحقق وحالة الاعتماد',
          icon: Icons.verified_user_outlined,
          table: 'contractor_documents',
          filterField: 'contractor_profile_id',
          filterValue: id,
        ),
        WorkspaceModule(
          title: 'المالية',
          caption: 'المستحقات والتسويات',
          icon: Icons.account_balance_wallet_outlined,
          table: 'contractor_financial_transactions',
          filterField: 'contractor_profile_id',
          filterValue: id,
        ),
      ];
    }
    return [
      const WorkspaceModule(
        title: 'المستخدمون',
        caption: 'الحسابات والأدوار',
        icon: Icons.group_outlined,
        table: 'profiles',
      ),
      const WorkspaceModule(
        title: 'المزودون',
        caption: 'المنشآت المعتمدة',
        icon: Icons.storefront_outlined,
        table: 'providers',
      ),
      const WorkspaceModule(
        title: 'المقاولون',
        caption: 'الحسابات والمستندات',
        icon: Icons.engineering_outlined,
        table: 'contractor_profiles',
      ),
      const WorkspaceModule(
        title: 'مراجعة المنتجات',
        caption: 'المنتجات المنشورة والمعلقة',
        icon: Icons.fact_check_outlined,
        table: 'products',
        action: 'product_review',
      ),
      const WorkspaceModule(
        title: 'طلبات تعديل المنتجات',
        caption: 'مقارنة البيانات السابقة والجديدة واعتمادها أو رفضها',
        icon: Icons.difference_outlined,
        table: 'product_change_requests',
        action: 'product_change_review',
      ),
      const WorkspaceModule(
        title: 'طلبات العملاء',
        caption: 'طلبات التسعير ومراحلها',
        icon: Icons.receipt_long_outlined,
        table: 'quote_requests',
      ),
      const WorkspaceModule(
        title: 'أوامر التوريد',
        caption: 'الإسناد والتجهيز',
        icon: Icons.inventory_outlined,
        table: 'internal_fulfillment_orders',
      ),
      const WorkspaceModule(
        title: 'التوصيل',
        caption: 'السائقون وحالات التسليم',
        icon: Icons.local_shipping_outlined,
        table: 'provider_delivery_assignments',
      ),
      const WorkspaceModule(
        title: 'الدعم',
        caption: 'التذاكر والتصعيد',
        icon: Icons.support_agent_outlined,
        table: 'support_tickets',
      ),
      const WorkspaceModule(
        title: 'المالية والأرباح',
        caption: 'أرصدة المزودين وعمولة بُنية',
        icon: Icons.account_balance_outlined,
        table: 'financial_transactions',
        action: 'admin_finance',
      ),
      const WorkspaceModule(
        title: 'سجل العمليات',
        caption: 'التدقيق والإجراءات الحساسة',
        icon: Icons.history_rounded,
        table: 'audit_logs',
      ),
    ];
  }

  @override
  Widget build(BuildContext context) => ListView(
    padding: const EdgeInsets.all(16),
    children: [
      _PageHeading(
        title: context.tr('operationsAndServices'),
        caption: context.tr('operationsAndServicesCaption'),
      ),
      const SizedBox(height: 14),
      GridView.builder(
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
          crossAxisCount: 2,
          mainAxisSpacing: 10,
          crossAxisSpacing: 10,
          childAspectRatio: 1.12,
        ),
        itemCount: modules.length,
        itemBuilder: (_, index) {
          final module = modules[index];
          return InkWell(
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute(
                builder: (_) => module.action == 'admin_finance'
                    ? AdminFinanceScreen(repository: repository)
                    : ModuleRecordsScreen(
                        repository: repository,
                        module: module,
                      ),
              ),
            ),
            borderRadius: BorderRadius.circular(22),
            child: Container(
              padding: const EdgeInsets.all(15),
              decoration: _panel(),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  CircleAvatar(
                    backgroundColor: index.isEven
                        ? const Color(0xFFF0DDCF)
                        : BunyaColors.mint,
                    child: Icon(
                      module.icon,
                      color: index.isEven
                          ? BunyaColors.copperDark
                          : BunyaColors.forest,
                    ),
                  ),
                  const Spacer(),
                  Text(
                    context.localizedUiText(module.title),
                    style: const TextStyle(fontWeight: FontWeight.w900),
                  ),
                  Text(
                    context.localizedUiText(module.caption),
                    maxLines: 2,
                    style: const TextStyle(
                      color: BunyaColors.muted,
                      fontSize: 10,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
            ),
          );
        },
      ),
    ],
  );
}

class ModuleRecordsScreen extends StatefulWidget {
  const ModuleRecordsScreen({
    super.key,
    required this.repository,
    required this.module,
  });
  final WorkspaceRepository repository;
  final WorkspaceModule module;

  @override
  State<ModuleRecordsScreen> createState() => _ModuleRecordsScreenState();
}

class _ModuleRecordsScreenState extends State<ModuleRecordsScreen> {
  late Future<List<Map<String, dynamic>>> rows = widget.repository.loadModule(
    widget.module,
  );

  void reload() => setState(() {
    rows = widget.repository.loadModule(widget.module);
  });

  @override
  void initState() {
    super.initState();
    AppDataRefresh.revision.addListener(reload);
  }

  @override
  void dispose() {
    AppDataRefresh.revision.removeListener(reload);
    super.dispose();
  }

  Future<void> addProduct() async {
    final added = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _CreateProductSheet(
        repository: widget.repository,
        providerId: widget.module.filterValue!,
      ),
    );
    if (added == true && mounted) {
      reload();
    }
  }

  Future<void> requestProductChange(Map<String, dynamic> product) async {
    final changed = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _CreateProductSheet(
        repository: widget.repository,
        providerId: widget.module.filterValue!,
        existingProduct: product,
      ),
    );
    if (changed == true && mounted) reload();
  }

  Future<void> addDriver() async {
    final added = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _CreateDriverSheet(repository: widget.repository),
    );
    if (added == true && mounted) reload();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(context.localizedUiText(widget.module.title))),
    floatingActionButton: widget.module.action == 'provider_products'
        ? FloatingActionButton.extended(
            onPressed: addProduct,
            icon: const Icon(Icons.add_rounded),
            label: const Text('إضافة منتج'),
          )
        : widget.module.action == 'provider_drivers'
        ? FloatingActionButton.extended(
            onPressed: addDriver,
            icon: const Icon(Icons.person_add_alt_1_rounded),
            label: const Text('إضافة سائق'),
          )
        : null,
    body: _FutureList(
      title: widget.module.title,
      caption: widget.module.caption,
      future: rows,
      item: (row) {
        void openDetails() => showModalBottomSheet<void>(
          context: context,
          isScrollControlled: true,
          backgroundColor: Colors.transparent,
          builder: (_) => widget.module.table == 'products'
              ? _ProductRecordDetails(
                  row: row,
                  module: widget.module,
                  repository: widget.repository,
                )
              : widget.module.table == 'product_change_requests'
              ? _ProductChangeReviewSheet(
                  row: row,
                  repository: widget.repository,
                )
              : widget.module.table == 'quote_requests'
              ? _QuoteRequestDetails(row: row, repository: widget.repository)
              : _RecordDetails(
                  row: row,
                  module: widget.module,
                  repository: widget.repository,
                ),
        );
        final status = _status(
          '${row['status'] ?? row['review_status'] ?? row['approval_status'] ?? 'سجل'}',
        );
        final pendingChanges =
            ((row['product_change_requests'] as List?) ?? const []).any(
              (item) => (item as Map)['status'] == 'pending',
            );
        final canRequestChange =
            widget.module.action == 'provider_products' &&
            row['review_status'] == 'approved' &&
            row['is_published'] == true &&
            !pendingChanges;
        return widget.module.table == 'products'
            ? _ProductRecordCard(
                row: row,
                status: status,
                onTap: openDetails,
                onRequestChange: canRequestChange
                    ? () => requestProductChange(row)
                    : null,
                changePending: pendingChanges,
              )
            : _RecordCard(
                title: _recordTitle(row, widget.module),
                subtitle: _recordSubtitle(row, widget.module),
                status: status,
                icon: widget.module.icon,
                onTap: openDetails,
              );
      },
    ),
  );
}

class _RoleNotifications extends StatefulWidget {
  const _RoleNotifications({
    required this.repository,
    required this.workspace,
    required this.contextData,
  });
  final BunyaRepository repository;
  final WorkspaceRepository workspace;
  final RoleContext contextData;
  @override
  State<_RoleNotifications> createState() => _RoleNotificationsState();
}

class _RoleNotificationsState extends State<_RoleNotifications> {
  late Future<List<AppNotification>> rows = widget.repository
      .loadNotifications();

  void reload() => setState(() {
    rows = widget.repository.loadNotifications();
  });

  @override
  void initState() {
    super.initState();
    AppDataRefresh.revision.addListener(reload);
  }

  @override
  void dispose() {
    AppDataRefresh.revision.removeListener(reload);
    super.dispose();
  }

  Future<void> open(AppNotification item) async {
    try {
      if (!item.read) await widget.repository.markNotificationRead(item);
      if (!mounted) return;
      final match = RegExp(r'/merchant/quote-requests/([^/?#]+)')
          .firstMatch(item.actionUrl ?? '');
      final rfqId =
          match?.group(1) ??
          (item.entityType?.startsWith('provider.rfq_') == true
              ? item.entityId
              : null);
      if (widget.contextData.role == 'provider' && rfqId != null) {
        await Navigator.of(context).push(
          MaterialPageRoute(
            builder: (_) =>
                ProviderPriceScreen(repository: widget.workspace, id: rfqId),
          ),
        );
      } else {
        var openedTarget = false;
        if (widget.contextData.role == 'provider') {
          openedTarget = await _openProviderNotificationTarget(item);
          if (!mounted) return;
        }
        if (widget.contextData.role == 'admin') {
          openedTarget = await _openAdminNotificationTarget(item);
          if (!mounted) return;
        }
        if (!openedTarget) {
          await Navigator.of(context).push(
            MaterialPageRoute(builder: (_) => _NotificationDetails(item: item)),
          );
        }
      }
    } catch (error) {
      if (mounted) _notice(context, _clean(error));
    } finally {
      if (mounted) reload();
    }
  }

  Future<bool> _openProviderNotificationTarget(AppNotification item) async {
    if (item.entityType != 'product' || item.entityId == null) return false;

    final module = WorkspaceModule(
      title: 'المنتجات',
      caption: 'المنتجات والمراجعة والتوفر',
      icon: Icons.inventory_2_outlined,
      table: 'products',
      filterField: 'provider_id',
      filterValue: widget.contextData.entityId,
      action: 'provider_products',
    );
    final records = await widget.workspace.loadModule(
      module,
      recordId: item.entityId,
    );
    if (!mounted || records.isEmpty) return false;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _ProductRecordDetails(
        row: records.first,
        module: module,
        repository: widget.workspace,
      ),
    );
    return true;
  }

  Future<bool> _openAdminNotificationTarget(AppNotification item) async {
    final actionUrl = item.actionUrl ?? '';
    final changeMatch = RegExp(r'/admin/products/changes/([^/?#]+)')
        .firstMatch(actionUrl);
    final changeId =
        changeMatch?.group(1) ??
        (item.entityType == 'product_change_request' ? item.entityId : null);
    if (changeId != null) {
      const module = WorkspaceModule(
        title: 'طلبات تعديل المنتجات',
        caption: 'مقارنة البيانات السابقة والجديدة واعتمادها أو رفضها',
        icon: Icons.difference_outlined,
        table: 'product_change_requests',
        action: 'product_change_review',
      );
      final records = await widget.workspace.loadModule(
        module,
        recordId: changeId,
      );
      if (!mounted || records.isEmpty) return false;
      await showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        backgroundColor: Colors.transparent,
        builder: (_) => _ProductChangeReviewSheet(
          row: records.first,
          repository: widget.workspace,
        ),
      );
      return true;
    }
    final productMatch = RegExp(r'/admin/products/review/([^/?#]+)')
        .firstMatch(actionUrl);
    final productId =
        productMatch?.group(1) ??
        (item.entityType == 'product' ? item.entityId : null);
    if (productId != null) {
      const module = WorkspaceModule(
        title: 'مراجعة المنتجات',
        caption: 'المنتجات المنشورة والمعلقة',
        icon: Icons.fact_check_outlined,
        table: 'products',
        action: 'product_review',
      );
      final records = await widget.workspace.loadModule(
        module,
        recordId: productId,
      );
      if (!mounted || records.isEmpty) return false;
      await showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        backgroundColor: Colors.transparent,
        builder: (_) => _ProductRecordDetails(
          row: records.first,
          module: module,
          repository: widget.workspace,
        ),
      );
      return true;
    }

    final joinKind = item.entityType == 'provider_application'
        ? 'provider'
        : item.entityType == 'contractor_application'
        ? 'contractor'
        : actionUrl.contains('/join-requests/providers')
        ? 'provider'
        : actionUrl.contains('/join-requests/contractors')
        ? 'contractor'
        : null;
    if (joinKind != null && item.entityId != null) {
      final applications = await widget.workspace.adminApplications();
      final matching = applications.where(
        (row) => '${row['id']}' == item.entityId && row['_kind'] == joinKind,
      );
      if (!mounted || matching.isEmpty) return false;
      await showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        useSafeArea: true,
        builder: (_) => _AdminDecisionSheet(
          repository: widget.workspace,
          row: matching.first,
        ),
      );
      return true;
    }
    return false;
  }

  @override
  Widget build(BuildContext context) => FutureBuilder<List<AppNotification>>(
    future: rows,
    builder: (_, snapshot) => ListView(
      padding: const EdgeInsets.all(16),
      children: [
        _PageHeading(
          title: context.tr('notifications'),
          caption: context.tr('notificationsCaption'),
        ),
        const SizedBox(height: 12),
        if (!snapshot.hasData)
          const Center(child: CircularProgressIndicator())
        else if (snapshot.data!.isEmpty)
          _Empty(text: context.tr('noNotifications'))
        else
          ...snapshot.data!.map(
            (item) => _RecordCard(
              title: item.title,
              subtitle: _friendlyNotificationMessage(item.message),
              status: item.read ? context.tr('read') : context.tr('new'),
              onTap: () => open(item),
            ),
          ),
      ],
    ),
  );
}

class _NotificationDetails extends StatelessWidget {
  const _NotificationDetails({required this.item});
  final AppNotification item;
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(context.tr('notificationDetails'))),
    body: ListView(
      padding: const EdgeInsets.all(18),
      children: [
        _DetailHeader(title: item.title, caption: context.tr('bunyaAlert')),
        const SizedBox(height: 14),
        Container(
          padding: const EdgeInsets.all(18),
          decoration: _panel(),
          child: Text(
            _friendlyNotificationMessage(item.message),
            style: const TextStyle(fontWeight: FontWeight.w700, height: 1.8),
          ),
        ),
        const SizedBox(height: 12),
        Text(
          _date(item.createdAt),
          style: const TextStyle(
            color: BunyaColors.muted,
            fontWeight: FontWeight.w700,
          ),
        ),
      ],
    ),
  );
}

class _WorkspaceAccount extends StatelessWidget {
  const _WorkspaceAccount({
    required this.profile,
    required this.contextData,
    required this.onChangePassword,
    required this.onLogout,
  });
  final Profile profile;
  final RoleContext contextData;
  final VoidCallback onChangePassword;
  final Future<void> Function() onLogout;
  @override
  Widget build(BuildContext context) => ListView(
    padding: const EdgeInsets.all(16),
    children: [
      _DetailHeader(
        title: contextData.name,
        caption: _roleLabel(context, contextData.role),
      ),
      const SizedBox(height: 12),
      _Facts(
        values: {
          context.tr('name'): profile.name,
          context.tr('email'): profile.email,
          context.tr('mobile'): profile.mobile.isEmpty
              ? context.tr('notAdded')
              : profile.mobile,
          context.tr('role'): _roleLabel(context, profile.role),
        },
      ),
      const SizedBox(height: 16),
      OutlinedButton.icon(
        onPressed: onChangePassword,
        icon: const Icon(Icons.lock_reset_rounded),
        label: Text(context.tr('resetPassword')),
        style: OutlinedButton.styleFrom(
          foregroundColor: BunyaColors.forest,
          minimumSize: const Size.fromHeight(52),
        ),
      ),
      const SizedBox(height: 10),
      OutlinedButton.icon(
        onPressed: () async => onLogout(),
        icon: const Icon(Icons.logout_rounded),
        label: Text(context.tr('logout')),
        style: OutlinedButton.styleFrom(
          foregroundColor: BunyaColors.danger,
          minimumSize: const Size.fromHeight(52),
        ),
      ),
    ],
  );
}

class _FutureList extends StatelessWidget {
  const _FutureList({
    required this.title,
    required this.caption,
    required this.future,
    required this.item,
  });
  final String title, caption;
  final Future<List<Map<String, dynamic>>> future;
  final Widget Function(Map<String, dynamic>) item;
  @override
  Widget build(BuildContext context) =>
      FutureBuilder<List<Map<String, dynamic>>>(
        future: future,
        builder: (_, snapshot) => ListView(
          padding: const EdgeInsets.all(16),
          children: [
            _PageHeading(title: title, caption: caption),
            const SizedBox(height: 13),
            if (snapshot.connectionState == ConnectionState.waiting)
              const Center(
                child: Padding(
                  padding: EdgeInsets.all(35),
                  child: CircularProgressIndicator(),
                ),
              )
            else if (snapshot.hasError)
              _Empty(text: _clean(snapshot.error!))
            else if (snapshot.data!.isEmpty)
              _Empty(text: context.tr('noRecords'))
            else
              ...snapshot.data!.map(item),
          ],
        ),
      );
}

class _RecordCard extends StatelessWidget {
  const _RecordCard({
    required this.title,
    required this.subtitle,
    required this.status,
    this.icon,
    this.onTap,
  });
  final String title, subtitle, status;
  final IconData? icon;
  final VoidCallback? onTap;
  @override
  Widget build(BuildContext context) => Card(
    margin: const EdgeInsets.only(bottom: 10),
    elevation: 0,
    color: Colors.white,
    shape: RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(20),
      side: const BorderSide(color: BunyaColors.line),
    ),
    child: InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(20),
      child: Padding(
        padding: const EdgeInsets.all(15),
        child: Row(
          children: [
            if (icon != null) ...[
              Container(
                width: 46,
                height: 46,
                decoration: BoxDecoration(
                  color: BunyaColors.sand,
                  borderRadius: BorderRadius.circular(15),
                ),
                child: Icon(icon, size: 22, color: BunyaColors.copper),
              ),
              const SizedBox(width: 11),
            ],
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    context.localizedUiText(title),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontWeight: FontWeight.w900),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    context.localizedUiText(subtitle),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: BunyaColors.muted,
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            Column(
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 9,
                    vertical: 5,
                  ),
                  decoration: BoxDecoration(
                    color: BunyaColors.mint,
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Text(
                    context.localizedUiText(status),
                    style: const TextStyle(
                      color: BunyaColors.forest,
                      fontSize: 9,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ),
                if (onTap != null)
                  const Padding(
                    padding: EdgeInsets.only(top: 8),
                    child: Icon(
                      Icons.arrow_back_rounded,
                      size: 18,
                      color: BunyaColors.copper,
                    ),
                  ),
              ],
            ),
          ],
        ),
      ),
    ),
  );
}

class _ProductRecordCard extends StatelessWidget {
  const _ProductRecordCard({
    required this.row,
    required this.status,
    required this.onTap,
    this.onRequestChange,
    this.changePending = false,
  });
  final Map<String, dynamic> row;
  final String status;
  final VoidCallback onTap;
  final VoidCallback? onRequestChange;
  final bool changePending;

  @override
  Widget build(BuildContext context) {
    final imageUrl = '${row['_image_url'] ?? ''}'.trim();
    final description =
        '${row['short_description'] ?? row['description'] ?? 'لا يوجد وصف مختصر'}';
    return Card(
      margin: const EdgeInsets.only(bottom: 13),
      elevation: 0,
      clipBehavior: Clip.antiAlias,
      color: Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(22),
        side: const BorderSide(color: BunyaColors.line),
      ),
      child: Column(
        children: [
          InkWell(
            onTap: onTap,
            child: Row(
              children: [
                SizedBox(
                  width: 116,
                  height: onRequestChange != null || changePending ? 146 : 126,
                  child: imageUrl.isEmpty
                      ? const ColoredBox(
                          color: Color(0xFFF0E9E0),
                          child: Icon(
                            Icons.inventory_2_outlined,
                            size: 38,
                            color: BunyaColors.copper,
                          ),
                        )
                      : FastProductImage(
                          imageUrl: imageUrl,
                          fallbackUrl: '${row['_image_fallback_url'] ?? ''}',
                          cacheKey: '${row['_image_cache_key'] ?? imageUrl}',
                          memoryWidth: 320,
                        ),
                ),
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.all(13),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                _recordTitle(row),
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  fontSize: 15,
                                  fontWeight: FontWeight.w900,
                                ),
                              ),
                            ),
                            const Icon(
                              Icons.arrow_back_rounded,
                              size: 18,
                              color: BunyaColors.copper,
                            ),
                          ],
                        ),
                        const SizedBox(height: 5),
                        Text(
                          description,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: BunyaColors.muted,
                            fontSize: 11,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(height: 10),
                        Wrap(
                          spacing: 6,
                          runSpacing: 6,
                          children: [
                            _ProductChip(status),
                            _ProductChip('${row['base_unit'] ?? 'وحدة'}'),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
          if (onRequestChange != null || changePending)
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 0, 12, 10),
              child: SizedBox(
                width: double.infinity,
                child: OutlinedButton.icon(
                  onPressed: onRequestChange,
                  icon: Icon(
                    changePending
                        ? Icons.hourglass_top_rounded
                        : Icons.edit_note_rounded,
                  ),
                  label: Text(
                    changePending
                        ? 'طلب التعديل بانتظار الإدارة'
                        : 'طلب تعديل البيانات',
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _ProductChip extends StatelessWidget {
  const _ProductChip(this.text);
  final String text;
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
    decoration: BoxDecoration(
      color: BunyaColors.mint,
      borderRadius: BorderRadius.circular(20),
    ),
    child: Text(
      context.localizedUiText(text),
      style: const TextStyle(
        color: BunyaColors.forest,
        fontSize: 9,
        fontWeight: FontWeight.w900,
      ),
    ),
  );
}

class _PageHeading extends StatelessWidget {
  const _PageHeading({required this.title, required this.caption});
  final String title, caption;
  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(
        context.localizedUiText(title),
        style: Theme.of(context).textTheme.headlineSmall
            ?.copyWith(fontWeight: FontWeight.w900),
      ),
      Text(
        context.localizedUiText(caption),
        style: const TextStyle(
          color: BunyaColors.muted,
          fontWeight: FontWeight.w700,
        ),
      ),
    ],
  );
}

class _DetailHeader extends StatelessWidget {
  const _DetailHeader({
    required this.title,
    required this.caption,
    this.trailing,
  });
  final String title, caption;
  final Widget? trailing;
  @override
  Widget build(BuildContext context) => Container(
    width: double.infinity,
    padding: const EdgeInsets.all(20),
    decoration: BoxDecoration(
      gradient: const LinearGradient(
        colors: [BunyaColors.forest, Color(0xFF2B715D)],
      ),
      borderRadius: BorderRadius.circular(24),
    ),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                context.localizedUiText(caption),
                style: const TextStyle(
                  color: Colors.white70,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 5),
              Text(
                context.localizedUiText(title),
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 20,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ],
          ),
        ),
        if (trailing != null) ...[const SizedBox(width: 12), trailing!],
      ],
    ),
  );
}

class _Facts extends StatelessWidget {
  const _Facts({required this.values});
  final Map<String, String> values;
  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) {
      final halfWidth = (constraints.maxWidth - 8) / 2;
      return Wrap(
        spacing: 8,
        runSpacing: 8,
        children: values.entries.map((entry) {
          final value = context.localizedUiText(entry.value);
          final leftToRight = _isWorkspaceLeftToRightValue(value);
          return Container(
            width: value.contains('@') ? constraints.maxWidth : halfWidth,
            padding: const EdgeInsets.all(13),
            decoration: _panel(),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  context.localizedUiText(entry.key),
                  style: const TextStyle(
                    color: BunyaColors.muted,
                    fontSize: 10,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                Text(
                  value,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  textDirection: leftToRight ? TextDirection.ltr : null,
                  style: const TextStyle(fontWeight: FontWeight.w900),
                ),
              ],
            ),
          );
        }).toList(),
      );
    },
  );
}

bool _isWorkspaceLeftToRightValue(String value) =>
    value.contains('@') ||
    RegExp(r'^\+?[0-9][0-9\s().-]+$').hasMatch(value.trim());

class _QuoteRequestDetails extends StatelessWidget {
  const _QuoteRequestDetails({required this.row, required this.repository});
  final Map<String, dynamic> row;
  final WorkspaceRepository repository;

  @override
  Widget build(BuildContext context) {
    final items = ((row['quote_request_items'] as List?) ?? const [])
        .map((item) => Map<String, dynamic>.from(item as Map))
        .toList();
    final quoteRaw = row['bunya_customer_quotes'];
    final quote = quoteRaw is Map
        ? Map<String, dynamic>.from(quoteRaw)
        : quoteRaw is List && quoteRaw.isNotEmpty
        ? Map<String, dynamic>.from(quoteRaw.first as Map)
        : null;
    final project = '${row['project_name'] ?? ''}'.trim();
    final requestCode = '${row['request_code'] ?? 'طلب عرض سعر'}';
    final mapsUrl = '${row['google_maps_url'] ?? ''}'.trim();

    return SafeArea(
      top: false,
      child: Container(
        height: MediaQuery.sizeOf(context).height * .94,
        decoration: const BoxDecoration(
          color: BunyaColors.surface,
          borderRadius: BorderRadius.vertical(top: Radius.circular(30)),
        ),
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(18, 10, 18, 28),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  width: 44,
                  height: 5,
                  margin: const EdgeInsets.only(bottom: 14),
                  decoration: BoxDecoration(
                    color: BunyaColors.line,
                    borderRadius: BorderRadius.circular(20),
                  ),
                ),
              ),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    colors: [BunyaColors.copperDark, BunyaColors.copper],
                  ),
                  borderRadius: BorderRadius.circular(27),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Container(
                          width: 44,
                          height: 44,
                          decoration: BoxDecoration(
                            color: Colors.white.withValues(alpha: .15),
                            borderRadius: BorderRadius.circular(14),
                          ),
                          child: const Icon(
                            Icons.receipt_long_rounded,
                            color: Colors.white,
                          ),
                        ),
                        const Spacer(),
                        IconButton(
                          onPressed: () => Navigator.pop(context),
                          icon: const Icon(
                            Icons.close_rounded,
                            color: Colors.white,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 20),
                    Text(
                      requestCode,
                      style: const TextStyle(
                        color: Colors.white70,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      project.isEmpty ? 'طلب مواد بناء' : project,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 23,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 12),
                    Wrap(
                      spacing: 7,
                      runSpacing: 7,
                      children: [
                        _HeroBadge(
                          text: _status('${row['status'] ?? 'submitted'}'),
                          icon: Icons.track_changes_rounded,
                        ),
                        _HeroBadge(
                          text: _status(
                            '${row['payment_status'] ?? 'pending'}',
                          ),
                          icon: Icons.payments_outlined,
                        ),
                        _HeroBadge(
                          text: '${items.length} منتجات',
                          icon: Icons.inventory_2_outlined,
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 22),
              const _SectionTitle(
                icon: Icons.person_pin_circle_outlined,
                title: 'المستلم والتسليم',
              ),
              const SizedBox(height: 10),
              LayoutBuilder(
                builder: (context, constraints) {
                  final width = (constraints.maxWidth - 9) / 2;
                  return Wrap(
                    spacing: 9,
                    runSpacing: 9,
                    children: [
                      SizedBox(
                        width: width,
                        child: _RecordFact(
                          label: 'اسم المستلم',
                          value: '${row['recipient_name'] ?? 'غير محدد'}',
                          icon: Icons.person_outline_rounded,
                          wide: false,
                        ),
                      ),
                      SizedBox(
                        width: width,
                        child: _RecordFact(
                          label: 'رقم الجوال',
                          value: '${row['recipient_mobile'] ?? 'غير محدد'}',
                          icon: Icons.phone_rounded,
                          wide: false,
                        ),
                      ),
                      SizedBox(
                        width: width,
                        child: _RecordFact(
                          label: 'مسؤول الموقع',
                          value:
                              '${row['site_responsible_name'] ?? 'غير محدد'}',
                          icon: Icons.badge_outlined,
                          wide: false,
                        ),
                      ),
                      SizedBox(
                        width: width,
                        child: _RecordFact(
                          label: 'طريقة الاستلام',
                          value: _displayValue(
                            'delivery_mode',
                            row['delivery_mode'] ?? 'delivery',
                          ),
                          icon: Icons.local_shipping_outlined,
                          wide: false,
                        ),
                      ),
                      SizedBox(
                        width: width,
                        child: _RecordFact(
                          label: 'موعد الاستلام',
                          value: _date(row['desired_receipt_at']),
                          icon: Icons.event_available_outlined,
                          wide: false,
                        ),
                      ),
                      SizedBox(
                        width: width,
                        child: _RecordFact(
                          label: 'مهلة التسعير',
                          value: _date(row['quote_deadline']),
                          icon: Icons.timer_outlined,
                          wide: false,
                        ),
                      ),
                      SizedBox(
                        width: constraints.maxWidth,
                        child: _RecordFact(
                          label: 'وصف الموقع',
                          value: '${row['location_hint'] ?? 'غير محدد'}',
                          icon: Icons.pin_drop_outlined,
                          wide: true,
                        ),
                      ),
                      if (mapsUrl.isNotEmpty)
                        SizedBox(
                          width: constraints.maxWidth,
                          child: _RecordFact(
                            label: 'الموقع الجغرافي',
                            value: mapsUrl,
                            icon: Icons.map_outlined,
                            url: mapsUrl,
                            wide: true,
                          ),
                        ),
                      SizedBox(
                        width: width,
                        child: _RecordFact(
                          label: 'جوال مسؤول الموقع',
                          value:
                              '${row['site_responsible_mobile'] ?? 'غير محدد'}',
                          icon: Icons.phone_outlined,
                          wide: false,
                        ),
                      ),
                      SizedBox(
                        width: width,
                        child: _RecordFact(
                          label: 'المقاول',
                          value: '${row['contractor_name'] ?? 'لا يوجد'}',
                          icon: Icons.engineering_outlined,
                          wide: false,
                        ),
                      ),
                      SizedBox(
                        width: width,
                        child: _RecordFact(
                          label: 'مواعيد العمل',
                          value: '${row['working_hours'] ?? 'غير محددة'}',
                          icon: Icons.schedule_outlined,
                          wide: false,
                        ),
                      ),
                      SizedBox(
                        width: width,
                        child: _RecordFact(
                          label: 'سهولة الطريق',
                          value: '${row['road_access'] ?? 'غير محددة'}',
                          icon: Icons.route_outlined,
                          wide: false,
                        ),
                      ),
                      SizedBox(
                        width: constraints.maxWidth,
                        child: _RecordFact(
                          label: 'التحميل والتنزيل',
                          value:
                              '${row['loading_option'] ?? '—'} · ${row['unloading_option'] ?? '—'}',
                          icon: Icons.local_shipping_outlined,
                          wide: true,
                        ),
                      ),
                      SizedBox(
                        width: constraints.maxWidth,
                        child: _RecordFact(
                          label: 'تعليمات الوصول',
                          value: '${row['access_instructions'] ?? 'غير محددة'}',
                          icon: Icons.signpost_outlined,
                          wide: true,
                        ),
                      ),
                    ],
                  );
                },
              ),
              const SizedBox(height: 24),
              _SectionTitle(
                icon: Icons.inventory_2_outlined,
                title: 'المنتجات المطلوبة (${items.length})',
              ),
              const SizedBox(height: 10),
              if (items.isEmpty)
                const _Empty(text: 'لا توجد منتجات مضافة للطلب')
              else
                ...items.asMap().entries.map(
                  (entry) =>
                      _QuoteItemCard(index: entry.key + 1, item: entry.value),
                ),
              if ('${row['notes'] ?? ''}'.trim().isNotEmpty) ...[
                const SizedBox(height: 16),
                const _SectionTitle(
                  icon: Icons.notes_rounded,
                  title: 'ملاحظات العميل',
                ),
                const SizedBox(height: 10),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(17),
                  decoration: _panel(),
                  child: Text(
                    '${row['notes']}',
                    style: const TextStyle(
                      height: 1.7,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ],
              const SizedBox(height: 24),
              const _SectionTitle(
                icon: Icons.request_quote_outlined,
                title: 'عرض بُنية للعميل',
              ),
              const SizedBox(height: 10),
              if (quote == null)
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(17),
                  decoration: BoxDecoration(
                    color: const Color(0xFFFFF2DF),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: const Text(
                    'يجري جمع عروض المزودين وتجهيز أفضل عرض للعميل.',
                    style: TextStyle(
                      color: BunyaColors.copperDark,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                )
              else
                _CustomerQuoteSummary(quote: quote, repository: repository),
            ],
          ),
        ),
      ),
    );
  }
}

class _HeroBadge extends StatelessWidget {
  const _HeroBadge({required this.text, required this.icon});
  final String text;
  final IconData icon;
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
    decoration: BoxDecoration(
      color: Colors.white.withValues(alpha: .15),
      borderRadius: BorderRadius.circular(30),
    ),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 15, color: Colors.white),
        const SizedBox(width: 5),
        Text(
          context.localizedUiText(text),
          style: const TextStyle(
            color: Colors.white,
            fontSize: 10,
            fontWeight: FontWeight.w900,
          ),
        ),
      ],
    ),
  );
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle({required this.icon, required this.title});
  final IconData icon;
  final String title;
  @override
  Widget build(BuildContext context) => Row(
    children: [
      Container(
        width: 34,
        height: 34,
        decoration: BoxDecoration(
          color: BunyaColors.mint,
          borderRadius: BorderRadius.circular(11),
        ),
        child: Icon(icon, size: 19, color: BunyaColors.forest),
      ),
      const SizedBox(width: 9),
      Text(
        title,
        style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w900),
      ),
    ],
  );
}

class _QuoteItemCard extends StatelessWidget {
  const _QuoteItemCard({required this.index, required this.item});
  final int index;
  final Map<String, dynamic> item;
  @override
  Widget build(BuildContext context) => Container(
    width: double.infinity,
    margin: const EdgeInsets.only(bottom: 9),
    padding: const EdgeInsets.all(15),
    decoration: _panel(),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        CircleAvatar(
          radius: 20,
          backgroundColor: BunyaColors.sand,
          foregroundColor: BunyaColors.copper,
          child: Text(
            '$index',
            style: const TextStyle(fontWeight: FontWeight.w900),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                context.localizedSnapshot(
                  item['product_name_snapshot'] ?? 'منتج',
                  item['product_name_translations'],
                ),
                style: const TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 6),
              Text(
                '${item['quantity'] ?? '—'} ${context.localizedSnapshot(item['unit_name_snapshot'] ?? 'وحدة', item['unit_name_translations'])}${item['measurement_label_snapshot'] == null ? '' : ' · ${context.localizedSnapshot(item['measurement_label_snapshot'], item['measurement_label_translations'])}'}',
                style: const TextStyle(
                  color: BunyaColors.forest,
                  fontWeight: FontWeight.w800,
                ),
              ),
              if ('${item['variant_label_snapshot'] ?? ''}'
                  .trim()
                  .isNotEmpty) ...[
                const SizedBox(height: 4),
                Text(
                  '${item['variant_label_snapshot']}',
                  style: const TextStyle(
                    color: BunyaColors.copper,
                    fontSize: 11,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ],
              if ('${item['notes'] ?? ''}'.trim().isNotEmpty) ...[
                const SizedBox(height: 5),
                Text(
                  '${item['notes']}',
                  style: const TextStyle(
                    color: BunyaColors.muted,
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ],
          ),
        ),
      ],
    ),
  );
}

class _CustomerQuoteSummary extends StatelessWidget {
  const _CustomerQuoteSummary({required this.quote, required this.repository});
  final Map<String, dynamic> quote;
  final WorkspaceRepository repository;
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(17),
    decoration: BoxDecoration(
      color: BunyaColors.forest,
      borderRadius: BorderRadius.circular(24),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                '${quote['quote_code'] ?? 'عرض بُنية'}',
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 16,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ),
            _HeroBadge(
              text: _status('${quote['status'] ?? 'preparing'}'),
              icon: Icons.verified_outlined,
            ),
          ],
        ),
        const SizedBox(height: 16),
        _QuoteAmountRow(label: 'قيمة المنتجات', value: quote['subtotal']),
        _QuoteAmountRow(label: 'الضريبة', value: quote['vat_amount']),
        _QuoteAmountRow(label: 'التوصيل', value: quote['delivery_fee']),
        const Divider(color: Colors.white24, height: 24),
        _QuoteAmountRow(label: 'الإجمالي', value: quote['total'], strong: true),
        const SizedBox(height: 12),
        Text(
          'صالح حتى ${_date(quote['valid_until'])} · التسليم المتوقع ${_date(quote['expected_delivery_at'])}',
          style: const TextStyle(
            color: Colors.white70,
            fontSize: 10,
            fontWeight: FontWeight.w700,
          ),
        ),
        const SizedBox(height: 16),
        _QuotePaymentAction(quote: quote, repository: repository),
      ],
    ),
  );
}

class _QuotePaymentAction extends StatefulWidget {
  const _QuotePaymentAction({required this.quote, required this.repository});
  final Map<String, dynamic> quote;
  final WorkspaceRepository repository;

  @override
  State<_QuotePaymentAction> createState() => _QuotePaymentActionState();
}

class _QuotePaymentActionState extends State<_QuotePaymentAction>
    with WidgetsBindingObserver {
  bool busy = false;
  bool openedCheckout = false;
  String error = '';

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    if (kIsWeb &&
        Uri.base.queryParameters['payment'] == 'returned' &&
        Uri.base.queryParameters['quote'] == '${widget.quote['id'] ?? ''}') {
      unawaited(_reconcileReturnedPayment());
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && openedCheckout) {
      unawaited(_reconcileReturnedPayment(closeAfter: true));
    }
  }

  Future<void> _reconcileReturnedPayment({bool closeAfter = false}) async {
    await widget.repository.reconcileQuotePayment(
      '${widget.quote['id'] ?? ''}',
    );
    BunyaRepository.notifyDataChanged();
    if (closeAfter && mounted && Navigator.canPop(context)) {
      Navigator.pop(context);
    }
  }

  Future<void> pay() async {
    setState(() {
      busy = true;
      error = '';
    });
    try {
      final quoteId = '${widget.quote['id'] ?? ''}';
      final status = '${widget.quote['status'] ?? ''}';
      final url = await widget.repository.startQuotePayment(
        quoteId,
        acceptFirst: status == 'ready' || status == 'customer_review',
      );
      if (url == 'succeeded') {
        BunyaRepository.notifyDataChanged();
        if (mounted && Navigator.canPop(context)) Navigator.pop(context);
        return;
      }
      final opened = await launchUrl(
        Uri.parse(url),
        mode: LaunchMode.externalApplication,
      );
      if (!opened) throw Exception('payment_open_failed');
      openedCheckout = true;
    } catch (_) {
      if (mounted) {
        setState(() {
          error = context.tr('paymentStartFailed');
          busy = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final status = '${widget.quote['status'] ?? ''}';
    final ordersRaw = widget.quote['orders'];
    final order = ordersRaw is Map
        ? Map<String, dynamic>.from(ordersRaw)
        : ordersRaw is List && ordersRaw.isNotEmpty
        ? Map<String, dynamic>.from(ordersRaw.first as Map)
        : null;
    final paymentStatus = '${order?['payment_status'] ?? 'pending'}';
    if (paymentStatus == 'paid' || paymentStatus == 'succeeded') {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.all(12),
        color: const Color(0xFFDDF4E8),
        child: Row(
          children: [
            const Icon(Icons.verified_rounded, color: BunyaColors.forest),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                context.tr('paymentSucceeded'),
                style: const TextStyle(
                  color: BunyaColors.forest,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ),
          ],
        ),
      );
    }
    final canPay =
        order != null ||
        status == 'ready' ||
        status == 'customer_review' ||
        status == 'accepted';
    if (!canPay) return const SizedBox.shrink();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        FilledButton.icon(
          onPressed: busy ? null : pay,
          icon: const Icon(Icons.lock_outline_rounded),
          label: Text(
            busy
                ? context.tr('paymentOpening')
                : status == 'ready' || status == 'customer_review'
                ? context.tr('acceptAndPay')
                : context.tr('paySecurely'),
          ),
          style: FilledButton.styleFrom(
            backgroundColor: BunyaColors.copper,
            foregroundColor: Colors.white,
            minimumSize: const Size.fromHeight(50),
          ),
        ),
        if (error.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(
              error,
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: Colors.red,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
      ],
    );
  }
}

class _QuoteAmountRow extends StatelessWidget {
  const _QuoteAmountRow({
    required this.label,
    required this.value,
    this.strong = false,
  });
  final String label;
  final Object? value;
  final bool strong;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 3),
    child: Row(
      children: [
        Text(
          label,
          style: TextStyle(
            color: strong ? Colors.white : Colors.white70,
            fontWeight: strong ? FontWeight.w900 : FontWeight.w700,
          ),
        ),
        const Spacer(),
        Text(
          '${value ?? 0} ر.س',
          style: TextStyle(
            color: Colors.white,
            fontSize: strong ? 18 : 13,
            fontWeight: FontWeight.w900,
          ),
        ),
      ],
    ),
  );
}

class _CreateDriverSheet extends StatefulWidget {
  const _CreateDriverSheet({required this.repository});
  final WorkspaceRepository repository;

  @override
  State<_CreateDriverSheet> createState() => _CreateDriverSheetState();
}

class _CreateDriverSheetState extends State<_CreateDriverSheet> {
  final fullName = TextEditingController();
  final mobile = TextEditingController();
  final email = TextEditingController();
  final username = TextEditingController();
  final notes = TextEditingController();
  bool busy = false;
  Map<String, dynamic>? credentials;

  @override
  void dispose() {
    for (final controller in [fullName, mobile, email, username, notes]) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<void> submit() async {
    if (fullName.text.trim().length < 3 ||
        mobile.text.trim().isEmpty ||
        !email.text.contains('@') ||
        username.text.trim().length < 4) {
      _notice(context, 'أكمل اسم السائق والجوال والبريد واسم المستخدم.');
      return;
    }
    setState(() => busy = true);
    try {
      final result = await widget.repository.createProviderDriver(
        fullName: fullName.text,
        mobile: mobile.text,
        email: email.text,
        username: username.text,
        internalNotes: notes.text,
      );
      if (mounted) setState(() => credentials = result);
    } catch (error) {
      if (mounted) _notice(context, _clean(error));
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final viewInsets = MediaQuery.viewInsetsOf(context);
    return Container(
      constraints: BoxConstraints(
        maxHeight: MediaQuery.sizeOf(context).height * .92,
      ),
      padding: EdgeInsets.fromLTRB(18, 18, 18, 18 + viewInsets.bottom),
      decoration: const BoxDecoration(
        color: BunyaColors.surface,
        borderRadius: BorderRadius.vertical(top: Radius.circular(26)),
      ),
      child: credentials == null
          ? ListView(
              shrinkWrap: true,
              children: [
                const Text(
                  'إنشاء حساب سائق',
                  style: TextStyle(fontSize: 22, fontWeight: FontWeight.w900),
                ),
                const SizedBox(height: 4),
                const Text(
                  'سيستطيع السائق تسجيل الدخول برقم جواله وكلمة المرور المؤقتة، ثم يجب عليه تغييرها.',
                  style: TextStyle(
                    color: BunyaColors.muted,
                    height: 1.6,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 14),
                TextField(
                  controller: fullName,
                  textInputAction: TextInputAction.next,
                  decoration: const InputDecoration(labelText: 'الاسم الكامل'),
                ),
                const SizedBox(height: 9),
                TextField(
                  controller: mobile,
                  keyboardType: TextInputType.phone,
                  textDirection: TextDirection.ltr,
                  textInputAction: TextInputAction.next,
                  decoration: const InputDecoration(
                    labelText: 'رقم الجوال السعودي',
                    hintText: '05xxxxxxxx',
                  ),
                ),
                const SizedBox(height: 9),
                TextField(
                  controller: email,
                  keyboardType: TextInputType.emailAddress,
                  textDirection: TextDirection.ltr,
                  textInputAction: TextInputAction.next,
                  decoration: const InputDecoration(
                    labelText: 'البريد الإلكتروني',
                  ),
                ),
                const SizedBox(height: 9),
                TextField(
                  controller: username,
                  textDirection: TextDirection.ltr,
                  textInputAction: TextInputAction.next,
                  decoration: const InputDecoration(labelText: 'اسم المستخدم'),
                ),
                const SizedBox(height: 9),
                TextField(
                  controller: notes,
                  maxLines: 3,
                  decoration: const InputDecoration(
                    labelText: 'ملاحظات داخلية اختيارية',
                  ),
                ),
                const SizedBox(height: 14),
                FilledButton.icon(
                  onPressed: busy ? null : submit,
                  icon: const Icon(Icons.person_add_alt_1_rounded),
                  label: Text(
                    busy ? 'جارٍ إنشاء الحساب…' : 'إنشاء حساب السائق',
                  ),
                ),
              ],
            )
          : ListView(
              shrinkWrap: true,
              children: [
                const Icon(
                  Icons.verified_rounded,
                  color: Color(0xFF15734B),
                  size: 48,
                ),
                const SizedBox(height: 10),
                const Text(
                  'تم إنشاء حساب السائق',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 22, fontWeight: FontWeight.w900),
                ),
                const SizedBox(height: 5),
                const Text(
                  'انسخ البيانات الآن؛ كلمة المرور المؤقتة تظهر مرة واحدة فقط.',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: BunyaColors.muted,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 16),
                _Facts(
                  values: {
                    'رقم الجوال للدخول': '${credentials!['mobile']}',
                    'البريد': '${credentials!['email']}',
                    'اسم المستخدم': '${credentials!['username']}',
                    'كلمة المرور المؤقتة':
                        '${credentials!['temporaryPassword']}',
                  },
                ),
                const SizedBox(height: 14),
                FilledButton(
                  onPressed: () => Navigator.pop(context, true),
                  child: const Text('تم حفظ البيانات'),
                ),
              ],
            ),
    );
  }
}

class _CreateProductSheet extends StatefulWidget {
  const _CreateProductSheet({
    required this.repository,
    required this.providerId,
    this.existingProduct,
  });
  final WorkspaceRepository repository;
  final String providerId;
  final Map<String, dynamic>? existingProduct;

  @override
  State<_CreateProductSheet> createState() => _CreateProductSheetState();
}

class _CreateProductSheetState extends State<_CreateProductSheet> {
  final name = TextEditingController();
  final description = TextEditingController();
  final customCategory = TextEditingController();
  final minimum = TextEditingController();
  final stock = TextEditingController();
  final leadTime = TextEditingController();
  final deliveryWindow = TextEditingController();
  final deliveryNotes = TextEditingController();
  final sku = TextEditingController();
  final gtin = TextEditingController();
  final manufacturer = TextEditingController();
  final origin = TextEditingController();
  final material = TextEditingController();
  final grade = TextEditingController();
  final measurement = TextEditingController();
  final variantValue = TextEditingController();
  final weight = TextEditingController();
  final color = TextEditingController();
  final packaging = TextEditingController();
  final standard = TextEditingController();
  final intendedUse = TextEditingController();
  final safety = TextEditingController();
  final storage = TextEditingController();
  final rentalDuration = TextEditingController();
  final warrantyDuration = TextEditingController();
  final warrantyDetails = TextEditingController();
  final requestNote = TextEditingController();
  final availabilityCity = TextEditingController();
  final deliveryRegion = TextEditingController();
  final deliveryMaximumDuration = TextEditingController();
  final deliveryDurationUnit = TextEditingController();
  final deliveryPricePerKm = TextEditingController();
  final deliveryMaximumDistanceKm = TextEditingController();
  final deliveryConfigNotes = TextEditingController();
  late final Future<List<Map<String, dynamic>>> categories = widget.repository
      .productCategories();
  String? categoryId, categoryTone;
  String unit = 'حبة';
  String availability = 'available';
  String offerType = 'sale', rentalUnit = 'day', weightUnit = 'كجم';
  String variantType = 'المقاس';
  bool hasWarranty = false, busy = false;
  bool deliveryAvailable = false;
  String formError = '';
  final List<String> measurements = [];
  final List<Map<String, String>> variants = [];
  final List<Map<String, String>> availabilityRegions = [];
  final List<String> deliveryRegions = [];
  final Set<String> retainedImageIds = {};
  XFile? image;
  Uint8List? imageBytes;

  @override
  void initState() {
    super.initState();
    final product = widget.existingProduct;
    if (product == null) {
      leadTime.text = 'خلال 24 ساعة';
      deliveryWindow.text = 'يتم تحديدها بعد اعتماد الطلب';
      deliveryNotes.text =
          'يتم تنسيق موعد وموقع التسليم مع العميل بعد اعتماد الطلب.';
      return;
    }
    String value(String key) => '${product[key] ?? ''}'.trim();
    String specification(String label) {
      final prefix = '$label:';
      for (final raw
          in (product['product_specifications'] as List?) ?? const []) {
        final content = '${(raw as Map)['value'] ?? ''}';
        if (content.startsWith(prefix)) {
          return content.substring(prefix.length).trim();
        }
      }
      return '';
    }

    name.text = value('name');
    description.text = value('full_description').isNotEmpty
        ? value('full_description')
        : value('description');
    minimum.text = value('minimum_order');
    stock.text = value('stock_quantity');
    leadTime.text = value('lead_time_label');
    deliveryWindow.text = value('delivery_window');
    deliveryNotes.text = value('delivery_notes');
    sku.text = value('sku');
    customCategory.text = value('custom_category');
    categoryId = customCategory.text.isNotEmpty
        ? 'other'
        : value('category_id').isEmpty
        ? null
        : value('category_id');
    final category = product['product_categories'];
    if (category is Map) categoryTone = '${category['slug'] ?? 'tools'}';
    unit = value('base_unit').isEmpty ? unit : value('base_unit');
    availability = value('availability_status').isEmpty
        ? availability
        : value('availability_status');
    offerType = value('offer_type').isEmpty ? offerType : value('offer_type');
    rentalUnit = value('rental_duration_unit').isEmpty
        ? rentalUnit
        : value('rental_duration_unit');
    rentalDuration.text = value('rental_duration_value');
    gtin.text = specification('GTIN / الباركود');
    manufacturer.text = specification('المصنّع / العلامة');
    origin.text = specification('بلد المنشأ');
    material.text = specification('المادة / التركيبة');
    grade.text = specification('الدرجة / الفئة');
    weight.text = specification('الوزن');
    color.text = specification('اللون / التشطيب');
    packaging.text = specification('التعبئة');
    standard.text = specification('المواصفة أو شهادة المطابقة');
    intendedUse.text = specification('الاستخدام المخصص');
    safety.text = specification('السلامة والمناولة');
    storage.text = specification('شروط التخزين');
    measurements.addAll(
      ((product['product_measurements'] as List?) ?? const [])
          .map((item) => '${(item as Map)['label'] ?? ''}'.trim())
          .where((item) => item.isNotEmpty),
    );
    for (final raw in (product['product_variants'] as List?) ?? const []) {
      final item = Map<String, dynamic>.from(raw as Map);
      final attributes = item['attributes'];
      if (attributes is Map && attributes.isNotEmpty) {
        final entry = attributes.entries.first;
        variants.add({'type': '${entry.key}', 'value': '${entry.value}'});
      } else {
        final parts = '${item['name'] ?? ''}'.split(':');
        if (parts.length > 1) {
          variants.add({
            'type': parts.first.trim(),
            'value': parts.skip(1).join(':').trim(),
          });
        }
      }
    }
    final warranty = product['product_warranties'];
    if (warranty is Map) {
      hasWarranty = true;
      warrantyDuration.text = '${warranty['duration'] ?? ''}';
      warrantyDetails.text = '${warranty['details'] ?? ''}';
    }
    availabilityRegions.addAll(
      ((product['product_availability_regions'] as List?) ?? const []).map(
        (item) => {
          'city': '${(item as Map)['city'] ?? ''}',
          'scope': '${item['scope'] ?? 'المدينة'}',
        },
      ),
    );
    deliveryRegions.addAll(
      ((product['product_delivery_regions'] as List?) ?? const [])
          .map((item) => '${(item as Map)['region_name'] ?? ''}'.trim())
          .where((item) => item.isNotEmpty),
    );
    final delivery = product['product_delivery_configs'];
    if (delivery is Map) {
      deliveryAvailable = delivery['is_available'] == true;
      deliveryMaximumDuration.text = '${delivery['maximum_duration'] ?? ''}';
      deliveryDurationUnit.text = '${delivery['duration_unit'] ?? ''}';
      deliveryPricePerKm.text = '${delivery['price_per_km'] ?? ''}';
      deliveryMaximumDistanceKm.text =
          '${delivery['maximum_distance_km'] ?? ''}';
      deliveryConfigNotes.text = '${delivery['notes'] ?? ''}';
    }
    retainedImageIds.addAll(
      ((product['product_images'] as List?) ?? const [])
          .map((item) => '${(item as Map)['id'] ?? ''}')
          .where((item) => item.isNotEmpty),
    );
  }

  @override
  void dispose() {
    for (final controller in [
      name,
      description,
      customCategory,
      minimum,
      stock,
      leadTime,
      deliveryWindow,
      deliveryNotes,
      sku,
      gtin,
      manufacturer,
      origin,
      material,
      grade,
      measurement,
      variantValue,
      weight,
      color,
      packaging,
      standard,
      intendedUse,
      safety,
      storage,
      rentalDuration,
      warrantyDuration,
      warrantyDetails,
      requestNote,
      availabilityCity,
      deliveryRegion,
      deliveryMaximumDuration,
      deliveryDurationUnit,
      deliveryPricePerKm,
      deliveryMaximumDistanceKm,
      deliveryConfigNotes,
    ]) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<void> pickImage() async {
    final selected = await ImagePicker().pickImage(
      source: ImageSource.gallery,
      imageQuality: 72,
      maxWidth: 1280,
    );
    if (selected == null) return;
    final bytes = await selected.readAsBytes();
    if (bytes.length > 5 * 1024 * 1024) {
      if (mounted) _notice(context, 'الصورة أكبر من 5MB');
      return;
    }
    if (mounted) {
      setState(() {
        image = selected;
        imageBytes = bytes;
      });
    }
  }

  double? number(String value) {
    final clean = value.trim().replaceAll(',', '.');
    return clean.isEmpty ? null : double.tryParse(clean);
  }

  void addMeasurement() {
    final value = measurement.text.trim();
    if (value.isEmpty || measurements.contains(value)) return;
    setState(() {
      measurements.add(value);
      measurement.clear();
    });
  }

  void addVariant() {
    final value = variantValue.text.trim();
    if (value.isEmpty ||
        variants.any(
          (item) => item['type'] == variantType && item['value'] == value,
        )) {
      return;
    }
    setState(() {
      variants.add({'type': variantType, 'value': value});
      variantValue.clear();
    });
  }

  void fail(String message) {
    if (mounted) setState(() => formError = message);
  }

  Future<void> submit() async {
    final editing = widget.existingProduct != null;
    final minimumOrder = number(minimum.text);
    final stockQuantity = number(stock.text);
    final rentalValue = number(rentalDuration.text);
    if ((!editing && imageBytes == null) ||
        (editing && imageBytes == null && retainedImageIds.isEmpty) ||
        categoryId == null ||
        (categoryId == 'other' && customCategory.text.trim().length < 2)) {
      return fail('اختر صورة واحدة على الأقل وتصنيف المنتج');
    }
    if (name.text.trim().length < 2 || description.text.trim().length < 10) {
      return fail('أكمل اسم المنتج ووصفه بصورة صحيحة');
    }
    if (leadTime.text.trim().isEmpty ||
        deliveryWindow.text.trim().isEmpty ||
        deliveryNotes.text.trim().isEmpty) {
      return fail('أكمل مدة التجهيز والتوصيل وتعليماته');
    }
    if (availability == 'limited' &&
        (stockQuantity == null || stockQuantity <= 0)) {
      return fail('حدد كمية المخزون المتوفرة');
    }
    if (offerType == 'rental' && (rentalValue == null || rentalValue <= 0)) {
      return fail('حدد مدة التأجير الأساسية');
    }
    if (hasWarranty && warrantyDuration.text.trim().isEmpty) {
      return fail('حدد مدة الضمان أو ألغِ خيار الضمان');
    }
    if (deliveryAvailable &&
        (number(deliveryMaximumDuration.text) == null ||
            deliveryMaximumDuration.text.trim().isEmpty ||
            deliveryDurationUnit.text.trim().isEmpty)) {
      return fail('حدد المدة القصوى للتوصيل ووحدة المدة');
    }
    final specifications = <String>[];
    void addSpecification(String label, String value) {
      if (value.trim().isNotEmpty) {
        specifications.add('$label: ${value.trim()}');
      }
    }

    addSpecification('GTIN / الباركود', gtin.text);
    addSpecification('المصنّع / العلامة', manufacturer.text);
    addSpecification('بلد المنشأ', origin.text);
    addSpecification('المادة / التركيبة', material.text);
    addSpecification('الدرجة / الفئة', grade.text);
    addSpecification(
      'الوزن',
      weight.text.trim().isEmpty ? '' : '${weight.text.trim()} $weightUnit',
    );
    addSpecification('اللون / التشطيب', color.text);
    addSpecification('التعبئة', packaging.text);
    addSpecification('المواصفة أو شهادة المطابقة', standard.text);
    addSpecification('الاستخدام المخصص', intendedUse.text);
    addSpecification('السلامة والمناولة', safety.text);
    addSpecification('شروط التخزين', storage.text);
    final allMeasurements = <String>{
      ...measurements,
      if (measurement.text.trim().isNotEmpty) measurement.text.trim(),
    }.toList();
    final allVariants = <Map<String, String>>[
      ...variants,
      if (variantValue.text.trim().isNotEmpty)
        {'type': variantType, 'value': variantValue.text.trim()},
    ];
    final allAvailabilityRegions = <Map<String, String>>[
      ...availabilityRegions,
      if (availabilityCity.text.trim().isNotEmpty)
        {'city': availabilityCity.text.trim(), 'scope': 'المدينة'},
    ];
    final allDeliveryRegions = <String>{
      ...deliveryRegions,
      if (deliveryRegion.text.trim().isNotEmpty) deliveryRegion.text.trim(),
    }.toList();
    setState(() {
      formError = '';
      busy = true;
    });
    try {
      final extension = image?.name.toLowerCase() ?? '';
      final mime = image == null
          ? null
          : image!.mimeType ??
                (extension.endsWith('.png')
                    ? 'image/png'
                    : extension.endsWith('.webp')
                    ? 'image/webp'
                    : 'image/jpeg');
      if (editing) {
        await widget.repository.requestProductChange(
          product: widget.existingProduct!,
          name: name.text.trim(),
          categoryId: categoryId!,
          customCategory: categoryId == 'other'
              ? customCategory.text.trim()
              : null,
          baseUnit: unit,
          description: description.text.trim(),
          sku: sku.text.trim().isEmpty ? null : sku.text.trim(),
          minimumOrder: minimumOrder,
          stockQuantity: stockQuantity,
          availabilityStatus: availability,
          leadTime: leadTime.text.trim(),
          deliveryWindow: deliveryWindow.text.trim(),
          deliveryNotes: deliveryNotes.text.trim(),
          offerType: offerType,
          rentalDuration: rentalValue,
          rentalDurationUnit: offerType == 'rental' ? rentalUnit : null,
          measurements: allMeasurements,
          variants: allVariants,
          specifications: specifications,
          warrantyDuration: hasWarranty ? warrantyDuration.text.trim() : null,
          warrantyDetails: hasWarranty ? warrantyDetails.text.trim() : null,
          retainedImageIds: retainedImageIds.toList(),
          availabilityRegions: allAvailabilityRegions,
          deliveryRegions: allDeliveryRegions,
          deliveryAvailable: deliveryAvailable,
          deliveryMaximumDuration: number(deliveryMaximumDuration.text),
          deliveryDurationUnit: deliveryDurationUnit.text.trim().isEmpty
              ? null
              : deliveryDurationUnit.text.trim(),
          deliveryPricePerKm: number(deliveryPricePerKm.text),
          deliveryMaximumDistanceKm: number(deliveryMaximumDistanceKm.text),
          deliveryConfigNotes: deliveryConfigNotes.text.trim().isEmpty
              ? null
              : deliveryConfigNotes.text.trim(),
          requestNote: requestNote.text.trim().isEmpty
              ? null
              : requestNote.text.trim(),
          imageBytes: imageBytes,
          imageName: image?.name,
          imageMime: mime,
        );
      } else {
        await widget.repository.createProviderProduct(
          providerId: widget.providerId,
          name: name.text.trim(),
          categoryId: categoryId!,
          categoryTone: categoryTone ?? 'tools',
          baseUnit: unit,
          description: description.text.trim(),
          sku: sku.text.trim().isEmpty ? null : sku.text.trim(),
          minimumOrder: minimumOrder,
          stockQuantity: stockQuantity,
          availabilityStatus: availability,
          leadTime: leadTime.text.trim(),
          deliveryWindow: deliveryWindow.text.trim(),
          deliveryNotes: deliveryNotes.text.trim(),
          offerType: offerType,
          rentalDuration: rentalValue,
          rentalDurationUnit: offerType == 'rental' ? rentalUnit : null,
          measurements: allMeasurements,
          variants: allVariants,
          specifications: specifications,
          warrantyDuration: hasWarranty ? warrantyDuration.text.trim() : null,
          warrantyDetails: hasWarranty ? warrantyDetails.text.trim() : null,
          imageBytes: imageBytes!,
          imageName: image!.name,
          imageMime: mime!,
        );
      }
      if (!mounted) return;
      _notice(
        context,
        editing
            ? 'تم إرسال طلب تعديل المنتج للإدارة للمراجعة'
            : 'تم إرسال المنتج للإدارة للمراجعة',
      );
      Navigator.pop(context, true);
    } catch (error) {
      fail(_clean(error));
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => SafeArea(
    top: false,
    child: Container(
      height: MediaQuery.sizeOf(context).height * .95,
      decoration: const BoxDecoration(
        color: BunyaColors.surface,
        borderRadius: BorderRadius.vertical(top: Radius.circular(30)),
      ),
      child: ListView(
        padding: EdgeInsets.fromLTRB(
          18,
          12,
          18,
          MediaQuery.viewInsetsOf(context).bottom + 28,
        ),
        children: [
          Row(
            children: [
              Container(
                width: 48,
                height: 48,
                decoration: BoxDecoration(
                  color: BunyaColors.mint,
                  borderRadius: BorderRadius.circular(16),
                ),
                child: const Icon(
                  Icons.add_business_rounded,
                  color: BunyaColors.forest,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      widget.existingProduct == null
                          ? 'إضافة منتج جديد'
                          : 'طلب تعديل بيانات المنتج',
                      style: const TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    Text(
                      widget.existingProduct == null
                          ? 'أدخل بيانات البيع وسيصل المنتج للإدارة للمراجعة.'
                          : 'عدّل أي بيان؛ ستشاهد الإدارة القيمة السابقة والجديدة قبل الاعتماد.',
                      style: const TextStyle(
                        color: BunyaColors.muted,
                        fontSize: 10,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
              ),
              IconButton.filledTonal(
                onPressed: busy ? null : () => Navigator.pop(context),
                icon: const Icon(Icons.close_rounded),
              ),
            ],
          ),
          const SizedBox(height: 18),
          if (widget.existingProduct != null) ...[
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: const Color(0xFFFFF7ED),
                border: Border.all(color: const Color(0xFFE2C8A8)),
                borderRadius: BorderRadius.circular(18),
              ),
              child: const Text(
                'لن تتغير بطاقة المنتج المنشورة الآن. تُطبّق البيانات الجديدة فقط بعد اعتماد الإدارة.',
                style: TextStyle(fontWeight: FontWeight.w800, height: 1.5),
              ),
            ),
            const SizedBox(height: 12),
            ...(((widget.existingProduct!['product_images'] as List?) ??
                    const [])
                .map((raw) {
                  final item = Map<String, dynamic>.from(raw as Map);
                  final id = '${item['id'] ?? ''}';
                  return CheckboxListTile(
                    value: retainedImageIds.contains(id),
                    onChanged: busy
                        ? null
                        : (value) => setState(() {
                            if (value == true) {
                              retainedImageIds.add(id);
                            } else {
                              retainedImageIds.remove(id);
                            }
                          }),
                    title: Text(
                      '${item['file_name'] ?? item['label'] ?? 'صورة المنتج'}',
                    ),
                    subtitle: const Text('أبقِ الصورة ضمن النسخة المقترحة'),
                    secondary: const Icon(Icons.image_outlined),
                    contentPadding: EdgeInsets.zero,
                  );
                })),
          ],
          InkWell(
            onTap: busy ? null : pickImage,
            borderRadius: BorderRadius.circular(24),
            child: Container(
              height: 190,
              clipBehavior: Clip.antiAlias,
              decoration: BoxDecoration(
                color: BunyaColors.sand,
                borderRadius: BorderRadius.circular(24),
                border: Border.all(color: BunyaColors.line),
              ),
              child: imageBytes == null
                  ? Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        const Icon(
                          Icons.add_photo_alternate_outlined,
                          size: 46,
                          color: BunyaColors.copper,
                        ),
                        SizedBox(height: 8),
                        Text(
                          widget.existingProduct == null
                              ? 'اختر صورة واضحة للمنتج'
                              : 'إضافة صورة جديدة إلى النسخة المقترحة',
                          style: const TextStyle(fontWeight: FontWeight.w900),
                        ),
                        const Text(
                          'JPG أو PNG أو WebP — بحد أقصى 5MB',
                          style: TextStyle(
                            color: BunyaColors.muted,
                            fontSize: 10,
                          ),
                        ),
                      ],
                    )
                  : Image.memory(
                      imageBytes!,
                      fit: BoxFit.cover,
                      cacheWidth: 900,
                      gaplessPlayback: true,
                    ),
            ),
          ),
          const SizedBox(height: 14),
          TextField(
            controller: name,
            decoration: const InputDecoration(
              labelText: 'اسم المنتج',
              prefixIcon: Icon(Icons.inventory_2_outlined),
            ),
          ),
          const SizedBox(height: 10),
          FutureBuilder<List<Map<String, dynamic>>>(
            future: categories,
            builder: (_, snapshot) => DropdownButtonFormField<String>(
              initialValue: categoryId == 'other'
                  ? 'other'
                  : (snapshot.data ?? const []).any(
                      (item) => '${item['id']}' == categoryId,
                    )
                  ? categoryId
                  : null,
              decoration: const InputDecoration(
                labelText: 'التصنيف',
                prefixIcon: Icon(Icons.category_outlined),
              ),
              items: [
                ...(snapshot.data ?? const []).map(
                  (item) => DropdownMenuItem<String>(
                    value: '${item['id']}',
                    child: Text('${item['name']}'),
                  ),
                ),
                const DropdownMenuItem<String>(
                  value: 'other',
                  child: Text('تصنيف آخر'),
                ),
              ],
              onChanged: (value) {
                Map<String, dynamic>? selected;
                for (final item in snapshot.data ?? const []) {
                  if ('${item['id']}' == value) selected = item;
                }
                setState(() {
                  categoryId = value;
                  categoryTone = '${selected?['slug'] ?? 'tools'}';
                });
              },
            ),
          ),
          if (categoryId == 'other') ...[
            const SizedBox(height: 10),
            TextField(
              controller: customCategory,
              decoration: const InputDecoration(
                labelText: 'اسم التصنيف الآخر',
                prefixIcon: Icon(Icons.edit_outlined),
              ),
            ),
          ],
          const SizedBox(height: 10),
          DropdownButtonFormField<String>(
            initialValue: unit,
            decoration: const InputDecoration(
              labelText: 'الوحدة الأساسية',
              prefixIcon: Icon(Icons.straighten_rounded),
            ),
            items:
                <String>{
                      unit,
                      'حبة',
                      'كيس',
                      'طن',
                      'متر',
                      'متر مربع',
                      'متر مكعب',
                      'لفة',
                      'كرتون',
                    }
                    .map(
                      (value) =>
                          DropdownMenuItem(value: value, child: Text(value)),
                    )
                    .toList(),
            onChanged: (value) => setState(() => unit = value ?? unit),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: description,
            maxLines: 4,
            decoration: const InputDecoration(
              labelText: 'وصف المنتج ومواصفاته',
              alignLabelWithHint: true,
            ),
          ),
          const _ProductFormHeading(
            icon: Icons.qr_code_2_rounded,
            title: 'هوية المنتج',
            caption: 'بيانات اختيارية تسهّل المطابقة والشراء المهني',
          ),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: sku,
                  textDirection: TextDirection.ltr,
                  decoration: const InputDecoration(
                    labelText: 'رمز المنتج SKU — اختياري',
                  ),
                ),
              ),
              const SizedBox(width: 9),
              Expanded(
                child: TextField(
                  controller: gtin,
                  keyboardType: TextInputType.number,
                  textDirection: TextDirection.ltr,
                  decoration: const InputDecoration(
                    labelText: 'GTIN / الباركود — اختياري',
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: manufacturer,
                  decoration: const InputDecoration(
                    labelText: 'المصنّع أو العلامة — اختياري',
                  ),
                ),
              ),
              const SizedBox(width: 9),
              Expanded(
                child: TextField(
                  controller: origin,
                  decoration: const InputDecoration(
                    labelText: 'بلد المنشأ — اختياري',
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: material,
                  decoration: const InputDecoration(
                    labelText: 'المادة / التركيبة — اختياري',
                  ),
                ),
              ),
              const SizedBox(width: 9),
              Expanded(
                child: TextField(
                  controller: grade,
                  decoration: const InputDecoration(
                    labelText: 'الدرجة / الفئة — اختياري',
                  ),
                ),
              ),
            ],
          ),
          const _ProductFormHeading(
            icon: Icons.aspect_ratio_rounded,
            title: 'الخصائص الفيزيائية',
            caption: 'أضف كل المقاسات المتوفرة؛ أول مقاس يصبح الافتراضي',
          ),
          TextField(
            controller: measurement,
            onSubmitted: (_) => addMeasurement(),
            decoration: InputDecoration(
              labelText: 'المقاسات / الأبعاد — اختياري',
              hintText: 'مثال: 20 × 20 × 40 سم',
              prefixIcon: const Icon(Icons.straighten_rounded),
              suffixIcon: IconButton.filledTonal(
                onPressed: addMeasurement,
                tooltip: 'إضافة القياس',
                icon: const Icon(Icons.add_rounded),
              ),
            ),
          ),
          if (measurements.isNotEmpty) ...[
            const SizedBox(height: 8),
            Column(
              children: [
                for (var index = 0; index < measurements.length; index++)
                  Container(
                    margin: const EdgeInsets.only(bottom: 6),
                    padding: const EdgeInsetsDirectional.only(start: 12),
                    decoration: BoxDecoration(
                      color: BunyaColors.sand,
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(color: BunyaColors.line),
                    ),
                    child: Row(
                      children: [
                        Expanded(
                          child: Text(
                            '${index == 0 ? 'القياس الافتراضي · ' : ''}${measurements[index]}',
                            style: const TextStyle(fontWeight: FontWeight.w800),
                          ),
                        ),
                        IconButton(
                          onPressed: () =>
                              setState(() => measurements.removeAt(index)),
                          tooltip: 'حذف القياس',
                          icon: const Icon(Icons.close_rounded, size: 19),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
          ],
          const _ProductFormHeading(
            icon: Icons.account_tree_outlined,
            title: 'الفئات وخيارات المنتج',
            caption: 'اختر النوع وأضف كل قيمة متوفرة بشكل مستقل',
          ),
          DropdownButtonFormField<String>(
            initialValue: variantType,
            decoration: const InputDecoration(labelText: 'نوع الخيار'),
            items:
                const [
                      'المقاس',
                      'الضغط',
                      'الكثافة',
                      'السماكة',
                      'الدرجة',
                      'اللون',
                      'الموديل',
                      'أخرى',
                    ]
                    .map(
                      (value) =>
                          DropdownMenuItem(value: value, child: Text(value)),
                    )
                    .toList(),
            onChanged: (value) =>
                setState(() => variantType = value ?? variantType),
          ),
          const SizedBox(height: 8),
          TextField(
            controller: variantValue,
            onSubmitted: (_) => addVariant(),
            decoration: InputDecoration(
              labelText: 'قيمة الخيار — اختياري',
              hintText: 'مثال: 16 أو 5 سم',
              suffixIcon: IconButton.filledTonal(
                onPressed: addVariant,
                tooltip: 'إضافة الخيار',
                icon: const Icon(Icons.add_rounded),
              ),
            ),
          ),
          if (variants.isNotEmpty) ...[
            const SizedBox(height: 8),
            Column(
              children: [
                for (var index = 0; index < variants.length; index++)
                  Container(
                    margin: const EdgeInsets.only(bottom: 6),
                    padding: const EdgeInsetsDirectional.only(start: 12),
                    decoration: BoxDecoration(
                      color: BunyaColors.sand,
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(color: BunyaColors.line),
                    ),
                    child: Row(
                      children: [
                        Expanded(
                          child: Text(
                            '${variants[index]['type']}: ${variants[index]['value']}',
                            style: const TextStyle(fontWeight: FontWeight.w800),
                          ),
                        ),
                        IconButton(
                          onPressed: () =>
                              setState(() => variants.removeAt(index)),
                          tooltip: 'حذف الخيار',
                          icon: const Icon(Icons.close_rounded, size: 19),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
          ],
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                flex: 2,
                child: TextField(
                  controller: weight,
                  keyboardType: const TextInputType.numberWithOptions(
                    decimal: true,
                  ),
                  decoration: const InputDecoration(
                    labelText: 'الوزن — اختياري',
                  ),
                ),
              ),
              const SizedBox(width: 9),
              Expanded(
                child: DropdownButtonFormField<String>(
                  initialValue: weightUnit,
                  decoration: const InputDecoration(labelText: 'وحدة الوزن'),
                  items: const ['جم', 'كجم', 'طن']
                      .map(
                        (value) =>
                            DropdownMenuItem(value: value, child: Text(value)),
                      )
                      .toList(),
                  onChanged: (value) =>
                      setState(() => weightUnit = value ?? weightUnit),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: color,
                  decoration: const InputDecoration(
                    labelText: 'اللون / التشطيب — اختياري',
                  ),
                ),
              ),
              const SizedBox(width: 9),
              Expanded(
                child: TextField(
                  controller: packaging,
                  decoration: const InputDecoration(
                    labelText: 'التعبئة — اختياري',
                    hintText: 'مثال: 50 حبة/طبليه',
                  ),
                ),
              ),
            ],
          ),
          const _ProductFormHeading(
            icon: Icons.sell_outlined,
            title: 'نوع العرض والتسعير',
            caption: 'حدد هل المنتج للبيع أو للتأجير',
          ),
          SizedBox(
            width: double.infinity,
            child: SegmentedButton<String>(
              segments: const [
                ButtonSegment(
                  value: 'sale',
                  label: Text('بيع'),
                  icon: Icon(Icons.shopping_bag_outlined),
                ),
                ButtonSegment(
                  value: 'rental',
                  label: Text('تأجير'),
                  icon: Icon(Icons.event_repeat_rounded),
                ),
              ],
              selected: {offerType},
              onSelectionChanged: (value) =>
                  setState(() => offerType = value.first),
              showSelectedIcon: false,
            ),
          ),
          if (offerType == 'rental') ...[
            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(
                  flex: 2,
                  child: TextField(
                    controller: rentalDuration,
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                    decoration: const InputDecoration(
                      labelText: 'مدة التأجير الأساسية',
                    ),
                  ),
                ),
                const SizedBox(width: 9),
                Expanded(
                  child: DropdownButtonFormField<String>(
                    initialValue: rentalUnit,
                    decoration: const InputDecoration(labelText: 'المدة'),
                    items:
                        const {
                              'day': 'يوم',
                              'week': 'أسبوع',
                              'month': 'شهر',
                              'year': 'سنة',
                            }.entries
                            .map(
                              (item) => DropdownMenuItem(
                                value: item.key,
                                child: Text(item.value),
                              ),
                            )
                            .toList(),
                    onChanged: (value) =>
                        setState(() => rentalUnit = value ?? rentalUnit),
                  ),
                ),
              ],
            ),
          ],
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: minimum,
                  keyboardType: const TextInputType.numberWithOptions(
                    decimal: true,
                  ),
                  decoration: const InputDecoration(
                    labelText: 'أقل كمية للطلب',
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          DropdownButtonFormField<String>(
            initialValue: availability,
            decoration: const InputDecoration(labelText: 'حالة التوفر'),
            items:
                const {
                      'available': 'متوفر',
                      'limited': 'كمية محدودة',
                      'on_request': 'حسب الطلب',
                      'unavailable': 'غير متوفر حاليًا',
                    }.entries
                    .map(
                      (item) => DropdownMenuItem(
                        value: item.key,
                        child: Text(item.value),
                      ),
                    )
                    .toList(),
            onChanged: (value) =>
                setState(() => availability = value ?? availability),
          ),
          if (availability == 'limited') ...[
            const SizedBox(height: 10),
            TextField(
              controller: stock,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              decoration: const InputDecoration(
                labelText: 'كمية المخزون المتاحة',
              ),
            ),
          ],
          const _ProductFormHeading(
            icon: Icons.workspace_premium_outlined,
            title: 'المطابقة والاستخدام الآمن',
            caption: 'أدخل المرجع الصحيح بحسب فئة المنتج عند توفره',
          ),
          TextField(
            controller: standard,
            decoration: const InputDecoration(
              labelText: 'المواصفة أو شهادة المطابقة — اختياري',
              hintText: 'مثال: SASO / GSO / SBC / ASTM / ISO / EN',
              prefixIcon: Icon(Icons.verified_outlined),
            ),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: intendedUse,
            decoration: const InputDecoration(
              labelText: 'الاستخدام المخصص — اختياري',
              hintText: 'مثال: جدران داخلية غير حاملة',
            ),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: safety,
            maxLines: 2,
            decoration: const InputDecoration(
              labelText: 'السلامة والمناولة — اختياري',
              hintText: 'معدات الوقاية أو تحذيرات التركيب والنقل',
              alignLabelWithHint: true,
            ),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: storage,
            decoration: const InputDecoration(
              labelText: 'شروط التخزين — اختياري',
              hintText: 'مثال: مكان جاف بعيدًا عن الرطوبة',
            ),
          ),
          const _ProductFormHeading(
            icon: Icons.shield_outlined,
            title: 'الضمان',
            caption: 'اختياري ويظهر للعميل والإدارة بوضوح',
          ),
          SwitchListTile.adaptive(
            value: hasWarranty,
            onChanged: (value) => setState(() => hasWarranty = value),
            title: const Text(
              'يتوفر ضمان للمنتج',
              style: TextStyle(fontWeight: FontWeight.w800),
            ),
            contentPadding: EdgeInsets.zero,
          ),
          if (hasWarranty) ...[
            const SizedBox(height: 8),
            TextField(
              controller: warrantyDuration,
              decoration: const InputDecoration(
                labelText: 'مدة الضمان',
                hintText: 'مثال: سنتان من تاريخ الاستلام',
              ),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: warrantyDetails,
              maxLines: 2,
              decoration: const InputDecoration(
                labelText: 'شروط وتغطية الضمان — اختياري',
                alignLabelWithHint: true,
              ),
            ),
          ],
          const _ProductFormHeading(
            icon: Icons.local_shipping_outlined,
            title: 'التجهيز والتوصيل',
            caption: 'بيانات مطلوبة قبل إرسال المنتج للمراجعة',
          ),
          const SizedBox(height: 10),
          TextField(
            controller: leadTime,
            decoration: const InputDecoration(
              labelText: 'مدة التجهيز',
              hintText: 'مثال: خلال 24 ساعة',
              prefixIcon: Icon(Icons.schedule_outlined),
            ),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: deliveryWindow,
            decoration: const InputDecoration(
              labelText: 'مدة التوصيل',
              hintText: 'مثال: من يومين إلى 3 أيام',
              prefixIcon: Icon(Icons.local_shipping_outlined),
            ),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: deliveryNotes,
            maxLines: 3,
            decoration: const InputDecoration(
              labelText: 'شروط وتعليمات التوصيل',
              alignLabelWithHint: true,
            ),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: availabilityCity,
            onSubmitted: (_) {
              final city = availabilityCity.text.trim();
              if (city.isEmpty ||
                  availabilityRegions.any((item) => item['city'] == city)) {
                return;
              }
              setState(() {
                availabilityRegions.add({'city': city, 'scope': 'المدينة'});
                availabilityCity.clear();
              });
            },
            decoration: InputDecoration(
              labelText: 'مدينة توفر المنتج',
              hintText: 'اكتب المدينة ثم اضغط إضافة',
              suffixIcon: IconButton(
                onPressed: () {
                  final city = availabilityCity.text.trim();
                  if (city.isEmpty ||
                      availabilityRegions.any((item) => item['city'] == city)) {
                    return;
                  }
                  setState(() {
                    availabilityRegions.add({'city': city, 'scope': 'المدينة'});
                    availabilityCity.clear();
                  });
                },
                icon: const Icon(Icons.add_location_alt_outlined),
              ),
            ),
          ),
          if (availabilityRegions.isNotEmpty) ...[
            const SizedBox(height: 8),
            Wrap(
              spacing: 6,
              children: [
                for (final item in availabilityRegions)
                  InputChip(
                    label: Text(item['city'] ?? ''),
                    onDeleted: () =>
                        setState(() => availabilityRegions.remove(item)),
                  ),
              ],
            ),
          ],
          const SizedBox(height: 10),
          TextField(
            controller: deliveryRegion,
            onSubmitted: (_) {
              final region = deliveryRegion.text.trim();
              if (region.isEmpty || deliveryRegions.contains(region)) return;
              setState(() {
                deliveryRegions.add(region);
                deliveryRegion.clear();
              });
            },
            decoration: InputDecoration(
              labelText: 'منطقة التوصيل',
              hintText: 'اكتب المنطقة ثم اضغط إضافة',
              suffixIcon: IconButton(
                onPressed: () {
                  final region = deliveryRegion.text.trim();
                  if (region.isEmpty || deliveryRegions.contains(region)) {
                    return;
                  }
                  setState(() {
                    deliveryRegions.add(region);
                    deliveryRegion.clear();
                  });
                },
                icon: const Icon(Icons.add_road_outlined),
              ),
            ),
          ),
          if (deliveryRegions.isNotEmpty) ...[
            const SizedBox(height: 8),
            Wrap(
              spacing: 6,
              children: [
                for (final region in deliveryRegions)
                  InputChip(
                    label: Text(region),
                    onDeleted: () =>
                        setState(() => deliveryRegions.remove(region)),
                  ),
              ],
            ),
          ],
          SwitchListTile.adaptive(
            value: deliveryAvailable,
            onChanged: (value) => setState(() => deliveryAvailable = value),
            title: const Text(
              'خدمة توصيل خاصة بهذا المنتج متاحة',
              style: TextStyle(fontWeight: FontWeight.w800),
            ),
            contentPadding: EdgeInsets.zero,
          ),
          if (deliveryAvailable) ...[
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: deliveryMaximumDuration,
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                    decoration: const InputDecoration(
                      labelText: 'المدة القصوى للتوصيل',
                    ),
                  ),
                ),
                const SizedBox(width: 9),
                Expanded(
                  child: TextField(
                    controller: deliveryDurationUnit,
                    decoration: const InputDecoration(labelText: 'وحدة المدة'),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: deliveryPricePerKm,
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                    decoration: const InputDecoration(
                      labelText: 'السعر لكل كم',
                    ),
                  ),
                ),
                const SizedBox(width: 9),
                Expanded(
                  child: TextField(
                    controller: deliveryMaximumDistanceKm,
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                    decoration: const InputDecoration(
                      labelText: 'أقصى مسافة كم',
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            TextField(
              controller: deliveryConfigNotes,
              maxLines: 2,
              decoration: const InputDecoration(
                labelText: 'ملاحظات خدمة التوصيل',
              ),
            ),
          ],
          const SizedBox(height: 8),
          const Text(
            'يُحدَّد السعر والضريبة عند تقديم عرض السعر على طلب العميل.',
            style: TextStyle(color: BunyaColors.muted, height: 1.8),
          ),
          if (widget.existingProduct != null) ...[
            const SizedBox(height: 10),
            TextField(
              controller: requestNote,
              maxLines: 3,
              maxLength: 1000,
              decoration: const InputDecoration(
                labelText: 'سبب التعديل أو ملاحظة للإدارة',
                alignLabelWithHint: true,
              ),
            ),
          ],
          if (formError.isNotEmpty) ...[
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: const Color(0xFFFFE9E5),
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: const Color(0xFFF0B8AA)),
              ),
              child: Text(
                formError,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: Color(0xFF9F321E),
                  fontWeight: FontWeight.w900,
                ),
              ),
            ),
          ],
          const SizedBox(height: 12),
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
            label: Text(
              widget.existingProduct == null
                  ? 'إرسال المنتج للمراجعة'
                  : 'إرسال طلب التعديل للإدارة',
            ),
          ),
        ],
      ),
    ),
  );
}

class _ProductFormHeading extends StatelessWidget {
  const _ProductFormHeading({
    required this.icon,
    required this.title,
    required this.caption,
  });
  final IconData icon;
  final String title, caption;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(2, 24, 2, 10),
    child: Row(
      children: [
        Container(
          width: 38,
          height: 38,
          decoration: BoxDecoration(
            color: BunyaColors.mint,
            borderRadius: BorderRadius.circular(13),
          ),
          child: Icon(icon, size: 19, color: BunyaColors.forest),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: const TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w900,
                ),
              ),
              Text(
                caption,
                style: const TextStyle(
                  color: BunyaColors.muted,
                  fontSize: 9,
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

class _ProductChangeReviewSheet extends StatefulWidget {
  const _ProductChangeReviewSheet({
    required this.row,
    required this.repository,
  });
  final Map<String, dynamic> row;
  final WorkspaceRepository repository;

  @override
  State<_ProductChangeReviewSheet> createState() =>
      _ProductChangeReviewSheetState();
}

class _ProductChangeReviewSheetState extends State<_ProductChangeReviewSheet> {
  final note = TextEditingController();
  bool busy = false;

  static const sectionLabels = <String, String>{
    'core': 'البيانات الأساسية والتوفر',
    'images': 'صور المنتج',
    'measurements': 'القياسات',
    'variants': 'الخيارات والفئات',
    'specifications': 'المواصفات الفنية',
    'warranty': 'الضمان',
    'availability_regions': 'مناطق التوفر',
    'delivery_config': 'إعدادات التوصيل',
    'delivery_regions': 'مناطق التوصيل',
  };
  static const fieldLabels = <String, String>{
    'category_id': 'التصنيف',
    'custom_category': 'التصنيف المخصص',
    'sku': 'رمز SKU',
    'name': 'اسم المنتج',
    'base_unit': 'وحدة البيع',
    'short_description': 'الوصف المختصر',
    'description': 'الوصف',
    'full_description': 'الوصف الكامل',
    'availability_status': 'حالة التوفر',
    'lead_time_label': 'مدة التجهيز',
    'delivery_window': 'مدة التوصيل',
    'delivery_notes': 'تعليمات التوصيل',
    'offer_type': 'نوع العرض',
    'unit_price': 'سعر الوحدة',
    'minimum_order': 'الحد الأدنى للطلب',
    'stock_quantity': 'كمية المخزون',
    'vat_inclusive': 'السعر شامل الضريبة',
    'rental_duration_value': 'مدة التأجير',
    'rental_duration_unit': 'وحدة مدة التأجير',
    'is_available': 'خدمة التوصيل متاحة',
    'maximum_duration': 'المدة القصوى',
    'duration_unit': 'وحدة المدة',
    'price_per_km': 'سعر الكيلومتر',
    'maximum_distance_km': 'أقصى مسافة',
    'notes': 'ملاحظات',
  };

  @override
  void dispose() {
    note.dispose();
    super.dispose();
  }

  String valueText(dynamic value) {
    if (value == null || value == '') return 'غير مسجل';
    if (value is bool) return value ? 'نعم' : 'لا';
    if (value is num) return value.toString();
    if (value is List) {
      if (value.isEmpty) return 'لا توجد بيانات';
      return [
        for (var index = 0; index < value.length; index++)
          '${index + 1}. ${valueText(value[index])}',
      ].join('\n');
    }
    if (value is Map) {
      final entries = value.entries
          .where((entry) => entry.value != null && entry.value != '')
          .map(
            (entry) =>
                '${fieldLabels['${entry.key}'] ?? entry.key}: ${valueText(entry.value)}',
          )
          .toList();
      return entries.isEmpty ? 'لا توجد بيانات' : entries.join('\n');
    }
    const labels = {
      'sale': 'بيع',
      'rental': 'تأجير',
      'available': 'متوفر',
      'limited': 'كمية محدودة',
      'on_request': 'حسب الطلب',
      'unavailable': 'غير متوفر',
    };
    return labels['$value'] ?? '$value';
  }

  List<Map<String, dynamic>> comparisonRows(Map<String, dynamic> change) {
    if (change['field'] != 'core') return [change];
    final before = Map<String, dynamic>.from(
      (change['before'] as Map?) ?? const {},
    );
    final after = Map<String, dynamic>.from(
      (change['after'] as Map?) ?? const {},
    );
    final keys = <String>{...before.keys, ...after.keys};
    return [
      for (final key in keys)
        if (jsonEncode(before[key]) != jsonEncode(after[key]))
          {'field': key, 'before': before[key], 'after': after[key]},
    ];
  }

  Future<void> decide(String decision) async {
    if (note.text.trim().length < 5) {
      return _notice(
        context,
        'اكتب ملاحظة واضحة من 5 أحرف على الأقل؛ ستصل إلى المزود',
      );
    }
    setState(() => busy = true);
    try {
      await widget.repository.reviewProductChange(
        '${widget.row['id']}',
        decision,
        note.text.trim(),
      );
      if (!mounted) return;
      _notice(
        context,
        decision == 'approved'
            ? 'تم اعتماد التعديلات وتحديث المنتج'
            : 'تم رفض التعديلات وبقي المنتج دون تغيير',
      );
      Navigator.pop(context);
    } catch (error) {
      if (mounted) _notice(context, _clean(error));
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final product = widget.row['products'] is Map
        ? Map<String, dynamic>.from(widget.row['products'] as Map)
        : <String, dynamic>{};
    final provider = widget.row['providers'] is Map
        ? Map<String, dynamic>.from(widget.row['providers'] as Map)
        : <String, dynamic>{};
    final changes = ((widget.row['changes'] as List?) ?? const [])
        .map((item) => Map<String, dynamic>.from(item as Map))
        .toList();
    final pending = widget.row['status'] == 'pending';
    return SafeArea(
      top: false,
      child: Container(
        height: MediaQuery.sizeOf(context).height * .95,
        decoration: const BoxDecoration(
          color: BunyaColors.surface,
          borderRadius: BorderRadius.vertical(top: Radius.circular(30)),
        ),
        child: ListView(
          padding: EdgeInsets.fromLTRB(
            16,
            12,
            16,
            MediaQuery.viewInsetsOf(context).bottom + 24,
          ),
          children: [
            Row(
              children: [
                Container(
                  width: 48,
                  height: 48,
                  decoration: BoxDecoration(
                    color: BunyaColors.mint,
                    borderRadius: BorderRadius.circular(16),
                  ),
                  child: const Icon(
                    Icons.difference_outlined,
                    color: BunyaColors.forest,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '${product['name'] ?? 'طلب تعديل منتج'}',
                        style: const TextStyle(
                          fontSize: 20,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      Text(
                        '${provider['company_name'] ?? 'منشأة مزودة'}',
                        style: const TextStyle(
                          color: BunyaColors.muted,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ],
                  ),
                ),
                IconButton.filledTonal(
                  onPressed: busy ? null : () => Navigator.pop(context),
                  icon: const Icon(Icons.close_rounded),
                ),
              ],
            ),
            if ('${widget.row['request_note'] ?? ''}'.trim().isNotEmpty) ...[
              const SizedBox(height: 14),
              Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: const Color(0xFFFFF6EA),
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: const Color(0xFFE4CCAE)),
                ),
                child: Text(
                  'ملاحظة المزود\n${widget.row['request_note']}',
                  style: const TextStyle(
                    fontWeight: FontWeight.w800,
                    height: 1.6,
                  ),
                ),
              ),
            ],
            for (final change in changes) ...[
              const SizedBox(height: 14),
              Text(
                sectionLabels['${change['field']}'] ?? '${change['field']}',
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 7),
              for (final row in comparisonRows(change))
                Container(
                  margin: const EdgeInsets.only(bottom: 9),
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(17),
                    border: Border.all(color: BunyaColors.line),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        change['field'] == 'core'
                            ? fieldLabels['${row['field']}'] ??
                                  '${row['field']}'
                            : 'التغيير الكامل',
                        style: const TextStyle(fontWeight: FontWeight.w900),
                      ),
                      const SizedBox(height: 9),
                      _ProductChangeValue(
                        label: 'قبل التعديل',
                        value: valueText(row['before']),
                        after: false,
                      ),
                      const SizedBox(height: 7),
                      _ProductChangeValue(
                        label: 'بعد التعديل',
                        value: valueText(row['after']),
                        after: true,
                      ),
                    ],
                  ),
                ),
            ],
            if (pending) ...[
              const SizedBox(height: 12),
              TextField(
                controller: note,
                maxLines: 3,
                maxLength: 1000,
                decoration: const InputDecoration(
                  labelText: 'ملاحظة القرار للمزود',
                  alignLabelWithHint: true,
                ),
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: busy ? null : () => decide('rejected'),
                      icon: const Icon(Icons.close_rounded),
                      label: const Text('رفض التعديلات'),
                    ),
                  ),
                  const SizedBox(width: 9),
                  Expanded(
                    child: FilledButton.icon(
                      onPressed: busy ? null : () => decide('approved'),
                      icon: const Icon(Icons.check_rounded),
                      label: Text(busy ? 'جارٍ الحفظ…' : 'اعتماد التعديلات'),
                    ),
                  ),
                ],
              ),
            ] else ...[
              const SizedBox(height: 12),
              Text(
                widget.row['status'] == 'approved'
                    ? 'تم اعتماد هذه التعديلات.'
                    : 'تم رفض هذه التعديلات.',
                style: const TextStyle(fontWeight: FontWeight.w900),
              ),
              Text('${widget.row['review_reason'] ?? ''}'),
            ],
          ],
        ),
      ),
    );
  }
}

class _ProductChangeValue extends StatelessWidget {
  const _ProductChangeValue({
    required this.label,
    required this.value,
    required this.after,
  });
  final String label, value;
  final bool after;

  @override
  Widget build(BuildContext context) => Container(
    width: double.infinity,
    padding: const EdgeInsets.all(11),
    decoration: BoxDecoration(
      color: after ? const Color(0xFFEAF6EE) : const Color(0xFFF3F0EC),
      borderRadius: BorderRadius.circular(13),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: const TextStyle(
            color: BunyaColors.muted,
            fontSize: 10,
            fontWeight: FontWeight.w900,
          ),
        ),
        const SizedBox(height: 3),
        Text(
          value,
          style: const TextStyle(fontWeight: FontWeight.w700, height: 1.5),
        ),
      ],
    ),
  );
}

class _ProductRecordDetails extends StatefulWidget {
  const _ProductRecordDetails({
    required this.row,
    required this.module,
    required this.repository,
  });
  final Map<String, dynamic> row;
  final WorkspaceModule module;
  final WorkspaceRepository repository;

  @override
  State<_ProductRecordDetails> createState() => _ProductRecordDetailsState();
}

class _ProductRecordDetailsState extends State<_ProductRecordDetails> {
  final note = TextEditingController();
  bool busy = false;
  bool categoryBusy = false;
  String? categoryId;
  late final Future<List<Map<String, dynamic>>> categories;

  @override
  void initState() {
    super.initState();
    categoryId = '${widget.row['category_id'] ?? ''}'.trim();
    if (categoryId!.isEmpty) categoryId = null;
    categories = widget.repository.productCategories();
  }

  @override
  void dispose() {
    note.dispose();
    super.dispose();
  }

  Future<void> decide(String decision) async {
    if (decision != 'approved' && note.text.trim().length < 5) {
      return _notice(context, 'اكتب ملاحظة واضحة للقرار');
    }
    setState(() => busy = true);
    try {
      await widget.repository.reviewProduct(
        '${widget.row['id']}',
        decision,
        note.text.trim().isEmpty ? 'تمت المراجعة من تطبيق بُنية' : note.text,
      );
      if (!mounted) return;
      _notice(context, 'تم حفظ قرار المنتج');
      Navigator.pop(context);
    } catch (error) {
      if (mounted) _notice(context, _clean(error));
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> saveCategory(List<Map<String, dynamic>> values) async {
    final selectedId = categoryId;
    if (selectedId == null || categoryBusy) return;
    setState(() => categoryBusy = true);
    try {
      await widget.repository.updateProductCategory(
        '${widget.row['id']}',
        selectedId,
      );
      final selected = values.firstWhere(
        (item) => '${item['id']}' == selectedId,
      );
      widget.row['category_id'] = selectedId;
      widget.row['custom_category'] = null;
      widget.row['product_categories'] = {
        'id': selectedId,
        'name': selected['name'],
      };
      if (mounted) {
        _notice(context, 'تم تحديث تصنيف المنتج');
        setState(() {});
      }
    } catch (error) {
      if (mounted) _notice(context, _clean(error));
    } finally {
      if (mounted) setState(() => categoryBusy = false);
    }
  }

  Future<void> requestChange() async {
    final providerId =
        widget.module.filterValue ?? '${widget.row['provider_id'] ?? ''}';
    if (providerId.isEmpty) return;
    final changed = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _CreateProductSheet(
        repository: widget.repository,
        providerId: providerId,
        existingProduct: widget.row,
      ),
    );
    if (changed == true && mounted) Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) {
    final row = widget.row;
    final imageUrl = '${row['_image_url'] ?? ''}'.trim();
    final categoryRaw = row['product_categories'];
    final category = '${row['custom_category'] ?? ''}'.trim().isNotEmpty
        ? '${row['custom_category']}'
        : categoryRaw is Map
        ? '${categoryRaw['name'] ?? 'غير مصنف'}'
        : 'غير مصنف';
    final status = _status('${row['review_status'] ?? 'سجل'}');
    final description =
        '${row['full_description'] ?? row['description'] ?? row['short_description'] ?? ''}'
            .trim();
    final provider = row['providers'] is Map
        ? Map<String, dynamic>.from(row['providers'] as Map)
        : null;
    final units = ((row['product_units'] as List?) ?? const [])
        .map((item) => '${(item as Map)['name'] ?? ''}'.trim())
        .where((value) => value.isNotEmpty)
        .toList();
    final measurements = ((row['product_measurements'] as List?) ?? const [])
        .map((item) => '${(item as Map)['label'] ?? ''}'.trim())
        .where((value) => value.isNotEmpty)
        .toList();
    final variants = ((row['product_variants'] as List?) ?? const [])
        .map((item) => '${(item as Map)['name'] ?? ''}'.trim())
        .where((value) => value.isNotEmpty)
        .toList();
    final specifications =
        ((row['product_specifications'] as List?) ?? const [])
            .map((item) => '${(item as Map)['value'] ?? ''}'.trim())
            .where((value) => value.isNotEmpty)
            .toList();
    final availabilityRegions =
        ((row['product_availability_regions'] as List?) ?? const [])
            .map((item) => '${(item as Map)['city'] ?? ''}'.trim())
            .where((value) => value.isNotEmpty)
            .toList();
    final deliveryRegions =
        ((row['product_delivery_regions'] as List?) ?? const [])
            .map((item) => '${(item as Map)['region_name'] ?? ''}'.trim())
            .where((value) => value.isNotEmpty)
            .toList();
    final warranty = row['product_warranties'] is Map
        ? Map<String, dynamic>.from(row['product_warranties'] as Map)
        : null;
    final delivery = row['product_delivery_configs'] is Map
        ? Map<String, dynamic>.from(row['product_delivery_configs'] as Map)
        : null;
    final history = ((row['product_review_history'] as List?) ?? const [])
        .map((item) => Map<String, dynamic>.from(item as Map))
        .toList();
    final canReview =
        widget.module.action == 'product_review' &&
        row['review_status'] == 'pending_review';
    final pendingChanges =
        ((row['product_change_requests'] as List?) ?? const []).any(
          (item) => (item as Map)['status'] == 'pending',
        );
    final canRequestChange =
        widget.module.action == 'provider_products' &&
        row['review_status'] == 'approved' &&
        row['is_published'] == true &&
        !pendingChanges;

    return SafeArea(
      top: false,
      child: Container(
        height: MediaQuery.sizeOf(context).height * .92,
        decoration: const BoxDecoration(
          color: BunyaColors.surface,
          borderRadius: BorderRadius.vertical(top: Radius.circular(30)),
        ),
        child: SingleChildScrollView(
          padding: EdgeInsets.only(
            bottom: MediaQuery.viewInsetsOf(context).bottom + 24,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Stack(
                children: [
                  ClipRRect(
                    borderRadius: const BorderRadius.vertical(
                      top: Radius.circular(30),
                    ),
                    child: SizedBox(
                      height: 285,
                      width: double.infinity,
                      child: imageUrl.isEmpty
                          ? const ColoredBox(
                              color: Color(0xFFEDE4D8),
                              child: Icon(
                                Icons.inventory_2_outlined,
                                size: 72,
                                color: BunyaColors.copper,
                              ),
                            )
                          : FastProductImage(
                              imageUrl: imageUrl,
                              fallbackUrl:
                                  '${row['_image_fallback_url'] ?? ''}',
                              cacheKey:
                                  '${row['_image_cache_key'] ?? imageUrl}',
                            ),
                    ),
                  ),
                  PositionedDirectional(
                    top: 14,
                    end: 14,
                    child: IconButton.filled(
                      onPressed: () => Navigator.pop(context),
                      style: IconButton.styleFrom(
                        backgroundColor: Colors.white.withValues(alpha: .92),
                        foregroundColor: BunyaColors.ink,
                      ),
                      icon: const Icon(Icons.close_rounded),
                    ),
                  ),
                  PositionedDirectional(
                    bottom: 14,
                    start: 16,
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 7,
                      ),
                      decoration: BoxDecoration(
                        color: BunyaColors.forest,
                        borderRadius: BorderRadius.circular(30),
                      ),
                      child: Text(
                        status,
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 11,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 20, 20, 0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      _recordTitle(row),
                      style: const TextStyle(
                        fontSize: 24,
                        fontWeight: FontWeight.w900,
                        height: 1.25,
                      ),
                    ),
                    const SizedBox(height: 5),
                    Text(
                      '${row['short_description'] ?? category}',
                      style: const TextStyle(
                        color: BunyaColors.muted,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 18),
                    if (canRequestChange || pendingChanges) ...[
                      SizedBox(
                        width: double.infinity,
                        child: OutlinedButton.icon(
                          onPressed: canRequestChange ? requestChange : null,
                          icon: Icon(
                            pendingChanges
                                ? Icons.hourglass_top_rounded
                                : Icons.edit_note_rounded,
                          ),
                          label: Text(
                            pendingChanges
                                ? 'طلب التعديل بانتظار الإدارة'
                                : 'طلب تعديل بيانات المنتج',
                          ),
                        ),
                      ),
                      const SizedBox(height: 14),
                    ],
                    if (canReview) ...[
                      FutureBuilder<List<Map<String, dynamic>>>(
                        future: categories,
                        builder: (context, snapshot) {
                          final values = snapshot.data ?? const [];
                          final unchanged =
                              categoryId ==
                              '${widget.row['category_id'] ?? ''}';
                          return Container(
                            padding: const EdgeInsets.all(15),
                            decoration: BoxDecoration(
                              color: const Color(0xFFFFF8EE),
                              border: Border.all(
                                color: const Color(0xFFE4CCAE),
                              ),
                              borderRadius: BorderRadius.circular(20),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Text(
                                  'تصنيف المنتج',
                                  style: TextStyle(fontWeight: FontWeight.w900),
                                ),
                                const SizedBox(height: 4),
                                const Text(
                                  'صحح التصنيف قبل الاعتماد ليصل طلب التسعير إلى المزودين المطابقين.',
                                  style: TextStyle(
                                    color: BunyaColors.muted,
                                    fontSize: 12,
                                    height: 1.5,
                                  ),
                                ),
                                const SizedBox(height: 10),
                                DropdownButtonFormField<String>(
                                  key: ValueKey(
                                    '${categoryId ?? 'none'}-${values.length}',
                                  ),
                                  initialValue:
                                      values.any(
                                        (item) => '${item['id']}' == categoryId,
                                      )
                                      ? categoryId
                                      : null,
                                  items: values
                                      .map(
                                        (item) => DropdownMenuItem<String>(
                                          value: '${item['id']}',
                                          child: Text('${item['name']}'),
                                        ),
                                      )
                                      .toList(),
                                  onChanged: categoryBusy
                                      ? null
                                      : (value) =>
                                            setState(() => categoryId = value),
                                  decoration: const InputDecoration(
                                    labelText: 'التصنيف المعتمد',
                                  ),
                                ),
                                const SizedBox(height: 9),
                                FilledButton.icon(
                                  onPressed:
                                      categoryBusy ||
                                          categoryId == null ||
                                          values.isEmpty ||
                                          unchanged
                                      ? null
                                      : () => saveCategory(values),
                                  icon: const Icon(Icons.save_outlined),
                                  label: Text(
                                    categoryBusy
                                        ? 'جارٍ الحفظ…'
                                        : 'حفظ التصنيف',
                                  ),
                                ),
                              ],
                            ),
                          );
                        },
                      ),
                      const SizedBox(height: 12),
                    ],
                    Row(
                      children: [
                        Expanded(
                          child: _ProductFact(
                            icon: Icons.straighten_rounded,
                            label: 'الوحدة',
                            value: '${row['base_unit'] ?? 'غير محددة'}',
                          ),
                        ),
                        const SizedBox(width: 9),
                        Expanded(
                          child: _ProductFact(
                            icon: Icons.category_outlined,
                            label: 'التصنيف',
                            value: category,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 9),
                    Row(
                      children: [
                        Expanded(
                          child: _ProductFact(
                            icon: row['offer_type'] == 'rental'
                                ? Icons.event_repeat_rounded
                                : Icons.shopping_bag_outlined,
                            label: 'نوع العرض',
                            value: row['offer_type'] == 'rental'
                                ? 'تأجير — ${row['rental_duration_value'] ?? '—'} ${_rentalUnit('${row['rental_duration_unit'] ?? ''}')}'
                                : 'بيع',
                          ),
                        ),
                        const SizedBox(width: 9),
                        Expanded(
                          child: _ProductFact(
                            icon: Icons.qr_code_2_rounded,
                            label: 'رمز المنتج SKU',
                            value: '${row['sku'] ?? 'غير مضاف'}',
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 9),
                    Row(
                      children: [
                        Expanded(
                          child: _ProductFact(
                            icon: Icons.inventory_outlined,
                            label: 'التوفر',
                            value:
                                '${row['availability_summary'] ?? 'حسب التوفر'}',
                          ),
                        ),
                        const SizedBox(width: 9),
                        Expanded(
                          child: _ProductFact(
                            icon: Icons.local_shipping_outlined,
                            label: 'التوصيل',
                            value:
                                '${row['delivery_window'] ?? 'يحدد بعد الطلب'}',
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 9),
                    Row(
                      children: [
                        Expanded(
                          child: _ProductFact(
                            icon: Icons.payments_outlined,
                            label: 'التسعير',
                            value: 'يُحدَّد عند تقديم عرض السعر',
                          ),
                        ),
                        const SizedBox(width: 9),
                        Expanded(
                          child: _ProductFact(
                            icon: Icons.shopping_basket_outlined,
                            label: 'الحد الأدنى للطلب',
                            value: row['minimum_order'] == null
                                ? 'غير محدد'
                                : '${row['minimum_order']} ${row['base_unit']}',
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 9),
                    Row(
                      children: [
                        Expanded(
                          child: _ProductFact(
                            icon: Icons.warehouse_outlined,
                            label: 'المخزون',
                            value: row['stock_quantity'] == null
                                ? 'حسب التوفر'
                                : '${row['stock_quantity']} ${row['base_unit']}',
                          ),
                        ),
                        const SizedBox(width: 9),
                        Expanded(
                          child: _ProductFact(
                            icon: Icons.receipt_long_outlined,
                            label: 'الضريبة',
                            value: 'تُحدَّد ضمن عرض السعر',
                          ),
                        ),
                      ],
                    ),
                    if (provider != null) ...[
                      const SizedBox(height: 22),
                      const _SectionTitle(
                        icon: Icons.storefront_rounded,
                        title: 'بيانات المزود',
                      ),
                      const SizedBox(height: 9),
                      _Facts(
                        values: {
                          'المنشأة': '${provider['company_name'] ?? '—'}',
                          'المسؤول': '${provider['contact_name'] ?? '—'}',
                          'الجوال': '${provider['mobile'] ?? '—'}',
                          'البريد': '${provider['email'] ?? '—'}',
                        },
                      ),
                    ],
                    if (description.isNotEmpty) ...[
                      const SizedBox(height: 22),
                      const Text(
                        'عن المنتج',
                        style: TextStyle(
                          fontSize: 17,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      const SizedBox(height: 7),
                      Text(
                        description,
                        style: const TextStyle(
                          color: BunyaColors.muted,
                          height: 1.8,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                    if (units.isNotEmpty || measurements.isNotEmpty) ...[
                      const SizedBox(height: 22),
                      const _SectionTitle(
                        icon: Icons.straighten_rounded,
                        title: 'الوحدات والقياسات',
                      ),
                      const SizedBox(height: 9),
                      _JoinTags(
                        values: [...units, ...measurements],
                        empty: 'لا توجد وحدات أو قياسات إضافية',
                      ),
                    ],
                    if (variants.isNotEmpty) ...[
                      const SizedBox(height: 22),
                      const _SectionTitle(
                        icon: Icons.account_tree_outlined,
                        title: 'فئات وخيارات المنتج',
                      ),
                      const SizedBox(height: 9),
                      _JoinTags(
                        values: variants,
                        empty: 'لا توجد خيارات إضافية',
                      ),
                    ],
                    if (specifications.isNotEmpty) ...[
                      const SizedBox(height: 22),
                      const _SectionTitle(
                        icon: Icons.tune_rounded,
                        title: 'المواصفات المسجلة',
                      ),
                      const SizedBox(height: 9),
                      _JoinTags(
                        values: specifications,
                        empty: 'لا توجد مواصفات إضافية',
                      ),
                    ],
                    const SizedBox(height: 22),
                    const _SectionTitle(
                      icon: Icons.local_shipping_rounded,
                      title: 'التجهيز والتوصيل',
                    ),
                    const SizedBox(height: 9),
                    _Facts(
                      values: {
                        'مدة التجهيز': '${row['lead_time_label'] ?? '—'}',
                        'مدة التوصيل': '${row['delivery_window'] ?? '—'}',
                        'تعليمات التوصيل': '${row['delivery_notes'] ?? '—'}',
                        if (delivery != null)
                          'مسافة التوصيل القصوى':
                              delivery['maximum_distance_km'] == null
                              ? 'غير محددة'
                              : '${delivery['maximum_distance_km']} كم',
                      },
                    ),
                    if (availabilityRegions.isNotEmpty ||
                        deliveryRegions.isNotEmpty) ...[
                      const SizedBox(height: 10),
                      _JoinTags(
                        values: {
                          ...availabilityRegions,
                          ...deliveryRegions,
                        }.toList(),
                        empty: 'لا توجد مناطق محددة',
                      ),
                    ],
                    if (warranty != null) ...[
                      const SizedBox(height: 22),
                      const _SectionTitle(
                        icon: Icons.verified_user_outlined,
                        title: 'الضمان',
                      ),
                      const SizedBox(height: 9),
                      _Facts(
                        values: {
                          'نوع الضمان': '${warranty['label'] ?? '—'}',
                          'المدة': '${warranty['duration'] ?? '—'}',
                          'التفاصيل': '${warranty['details'] ?? '—'}',
                        },
                      ),
                    ],
                    if (history.isNotEmpty) ...[
                      const SizedBox(height: 22),
                      const _SectionTitle(
                        icon: Icons.history_rounded,
                        title: 'سجل مراجعة المنتج',
                      ),
                      const SizedBox(height: 9),
                      ...history
                          .take(5)
                          .map(
                            (item) => _JoinReviewCard(
                              outcome:
                                  '${item['to_status'] ?? 'pending_review'}',
                              reason: '${item['notes'] ?? ''}',
                              date: item['changed_at'],
                            ),
                          ),
                    ],
                    if (canReview) ...[
                      const SizedBox(height: 24),
                      Container(
                        padding: const EdgeInsets.all(16),
                        decoration: BoxDecoration(
                          color: BunyaColors.sand,
                          borderRadius: BorderRadius.circular(22),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text(
                              'قرار المراجعة',
                              style: TextStyle(
                                fontSize: 16,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                            const SizedBox(height: 10),
                            TextField(
                              controller: note,
                              maxLines: 3,
                              decoration: const InputDecoration(
                                hintText: 'ملاحظة القرار عند طلب تعديل أو رفض',
                              ),
                            ),
                            const SizedBox(height: 10),
                            FilledButton.icon(
                              onPressed: busy ? null : () => decide('approved'),
                              icon: const Icon(Icons.check_rounded),
                              label: const Text('اعتماد المنتج'),
                            ),
                            const SizedBox(height: 7),
                            OutlinedButton.icon(
                              onPressed: busy
                                  ? null
                                  : () => decide('needs_changes'),
                              icon: const Icon(Icons.edit_note_rounded),
                              label: const Text('إعادته للتعديل'),
                              style: OutlinedButton.styleFrom(
                                minimumSize: const Size.fromHeight(50),
                              ),
                            ),
                            TextButton.icon(
                              onPressed: busy ? null : () => decide('rejected'),
                              icon: const Icon(Icons.close_rounded),
                              label: const Text('رفض المنتج'),
                              style: TextButton.styleFrom(
                                foregroundColor: BunyaColors.danger,
                                minimumSize: const Size.fromHeight(48),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ProductFact extends StatelessWidget {
  const _ProductFact({
    required this.icon,
    required this.label,
    required this.value,
  });
  final IconData icon;
  final String label, value;
  @override
  Widget build(BuildContext context) => Container(
    constraints: const BoxConstraints(minHeight: 90),
    padding: const EdgeInsets.all(13),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(19),
      border: Border.all(color: BunyaColors.line),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Icon(icon, size: 17, color: BunyaColors.copper),
            const SizedBox(width: 6),
            Text(
              label,
              style: const TextStyle(
                color: BunyaColors.muted,
                fontSize: 10,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
        const SizedBox(height: 6),
        Text(
          value,
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(fontWeight: FontWeight.w900),
        ),
      ],
    ),
  );
}

class _RecordDetails extends StatefulWidget {
  const _RecordDetails({
    required this.row,
    required this.module,
    required this.repository,
  });
  final Map<String, dynamic> row;
  final WorkspaceModule module;
  final WorkspaceRepository repository;

  @override
  State<_RecordDetails> createState() => _RecordDetailsState();
}

class _RecordDetailsState extends State<_RecordDetails> {
  final note = TextEditingController();
  final deliveryCode = TextEditingController();
  late Future<Map<String, dynamic>?> delivery;
  late Future<List<Map<String, dynamic>>> drivers;
  String? selectedDriverId;
  bool busy = false;

  @override
  void initState() {
    super.initState();
    delivery = widget.module.action == 'fulfillment'
        ? widget.repository.providerDeliveryForFulfillment(
            '${widget.row['id']}',
          )
        : Future.value(null);
    drivers = widget.module.action == 'fulfillment'
        ? widget.repository.providerDrivers()
        : Future.value(const []);
  }

  @override
  void dispose() {
    note.dispose();
    deliveryCode.dispose();
    super.dispose();
  }

  Future<void> confirmProviderDelivery(String assignmentId) async {
    final code = deliveryCode.text.replaceAll(RegExp(r'\D'), '');
    if (code.length < 4) {
      _notice(context, 'أدخل رمز التسليم الذي وصل للعميل.');
      return;
    }
    setState(() => busy = true);
    try {
      final accepted = await widget.repository.confirmDelivery(
        assignmentId,
        code,
      );
      if (!mounted) return;
      _notice(
        context,
        accepted
            ? 'تم إثبات التسليم وإغلاق الطلب وإرسال الإشعارات.'
            : 'الرمز غير صحيح أو منتهي أو تم قفل المحاولات.',
      );
      if (accepted) {
        deliveryCode.clear();
        setState(() {
          delivery = widget.repository.providerDeliveryForFulfillment(
            '${widget.row['id']}',
          );
        });
      }
    } catch (error) {
      if (mounted) _notice(context, _clean(error));
    }
    if (mounted) setState(() => busy = false);
  }

  void reloadDeliveryResources() {
    setState(() {
      delivery = widget.repository.providerDeliveryForFulfillment(
        '${widget.row['id']}',
      );
      drivers = widget.repository.providerDrivers();
    });
  }

  Future<void> assignDriver() async {
    final driverId = selectedDriverId;
    if (driverId == null || driverId.isEmpty) {
      _notice(context, 'اختر سائقًا نشطًا أولًا.');
      return;
    }
    setState(() => busy = true);
    try {
      final message = await widget.repository.assignDeliveryDriver(
        '${widget.row['id']}',
        driverId,
      );
      if (!mounted) return;
      selectedDriverId = null;
      _notice(context, message);
      reloadDeliveryResources();
    } catch (error) {
      if (mounted) _notice(context, _clean(error));
    }
    if (mounted) setState(() => busy = false);
  }

  Future<void> addDriverFromOrder() async {
    final added = await showModalBottomSheet<bool>(
      context: context,
      useRootNavigator: true,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _CreateDriverSheet(repository: widget.repository),
    );
    if (added == true && mounted) {
      reloadDeliveryResources();
      _notice(
        context,
        'أُضيف السائق. بعد أول دخول وتغيير كلمة المرور سيصبح متاحًا للإسناد.',
      );
    }
  }

  Future<void> fulfillmentAction() async {
    final current = '${widget.row['status']}';
    final next = current == 'assigned'
        ? 'preparing'
        : current == 'preparing'
        ? 'ready'
        : null;
    if (next == null) return;
    setState(() => busy = true);
    try {
      await widget.repository.transitionFulfillment(
        '${widget.row['id']}',
        next,
        note.text.trim(),
      );
      if (mounted) {
        _notice(
          context,
          next == 'preparing' ? 'بدأ تجهيز الطلب' : 'الطلب جاهز للتسليم',
        );
        Navigator.pop(context);
      }
    } catch (error) {
      if (mounted) _notice(context, _clean(error));
    }
    if (mounted) setState(() => busy = false);
  }

  @override
  Widget build(BuildContext context) {
    final row = widget.row;
    final entries = row.entries
        .where(
          (item) =>
              _fieldLabels.containsKey(item.key) &&
              item.value != null &&
              '${item.value}'.trim().isNotEmpty &&
              item.value is! Map &&
              item.value is! List,
        )
        .toList();
    final currentStatus = _status(
      '${row['status'] ?? row['review_status'] ?? row['approval_status'] ?? 'سجل'}',
    );
    return SafeArea(
      top: false,
      child: Container(
        height: MediaQuery.sizeOf(context).height * .92,
        decoration: const BoxDecoration(
          color: BunyaColors.surface,
          borderRadius: BorderRadius.vertical(top: Radius.circular(30)),
        ),
        child: SingleChildScrollView(
          padding: EdgeInsets.fromLTRB(
            18,
            10,
            18,
            MediaQuery.viewInsetsOf(context).bottom + 24,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  width: 44,
                  height: 5,
                  margin: const EdgeInsets.only(bottom: 14),
                  decoration: BoxDecoration(
                    color: BunyaColors.line,
                    borderRadius: BorderRadius.circular(20),
                  ),
                ),
              ),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    colors: [BunyaColors.forest, Color(0xFF26745F)],
                  ),
                  borderRadius: BorderRadius.circular(26),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Container(
                          width: 44,
                          height: 44,
                          decoration: BoxDecoration(
                            color: Colors.white.withValues(alpha: .14),
                            borderRadius: BorderRadius.circular(14),
                          ),
                          child: Icon(widget.module.icon, color: Colors.white),
                        ),
                        const Spacer(),
                        IconButton(
                          onPressed: () => Navigator.pop(context),
                          icon: const Icon(
                            Icons.close_rounded,
                            color: Colors.white,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 18),
                    Text(
                      widget.module.title,
                      style: const TextStyle(
                        color: Colors.white70,
                        fontSize: 11,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      _recordTitle(row, widget.module),
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 22,
                        fontWeight: FontWeight.w900,
                        height: 1.25,
                      ),
                    ),
                    const SizedBox(height: 10),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 11,
                        vertical: 6,
                      ),
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: .14),
                        borderRadius: BorderRadius.circular(30),
                      ),
                      child: Text(
                        currentStatus,
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 10,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 20),
              const Text(
                'التفاصيل',
                style: TextStyle(fontSize: 17, fontWeight: FontWeight.w900),
              ),
              const SizedBox(height: 10),
              if (entries.isEmpty)
                const _Empty(text: 'لا توجد تفاصيل إضافية لهذا السجل')
              else
                LayoutBuilder(
                  builder: (context, constraints) => Wrap(
                    spacing: 9,
                    runSpacing: 9,
                    children: entries.map((entry) {
                      final wide = _wideFields.contains(entry.key);
                      return SizedBox(
                        width: wide
                            ? constraints.maxWidth
                            : (constraints.maxWidth - 9) / 2,
                        child: _RecordFact(
                          label: _fieldLabels[entry.key]!,
                          value: _displayValue(entry.key, entry.value),
                          icon: _fieldIcon(entry.key),
                          url: _urlFields.contains(entry.key)
                              ? '${entry.value}'
                              : null,
                          wide: wide,
                        ),
                      );
                    }).toList(),
                  ),
                ),
              if (widget.module.action == 'fulfillment') ...[
                const SizedBox(height: 18),
                FutureBuilder<Map<String, dynamic>?>(
                  future: delivery,
                  builder: (context, snapshot) {
                    if (snapshot.connectionState == ConnectionState.waiting) {
                      return const Center(child: CircularProgressIndicator());
                    }
                    final assignment = snapshot.data;
                    if (assignment == null) return const SizedBox.shrink();
                    final driver = assignment['provider_drivers'] is Map
                        ? Map<String, dynamic>.from(
                            assignment['provider_drivers'] as Map,
                          )
                        : const <String, dynamic>{};
                    final deliveryStatus = '${assignment['status']}';
                    final fulfillmentStatus = '${widget.row['status']}';
                    final hasAssignedDriver =
                        '${assignment['assigned_driver_id'] ?? ''}'.isNotEmpty;
                    final canAssignDriver =
                        const {
                          'ready',
                          'out_for_delivery',
                        }.contains(fulfillmentStatus) &&
                        !const {
                          'delivered',
                          'failed_delivery',
                        }.contains(deliveryStatus) &&
                        (!hasAssignedDriver || deliveryStatus == 'assigned');
                    return Container(
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: const Color(0xFFFFF8EF),
                        borderRadius: BorderRadius.circular(22),
                        border: Border.all(color: const Color(0xFFE6C9B1)),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Row(
                            children: [
                              const Icon(
                                Icons.local_shipping_outlined,
                                color: BunyaColors.copper,
                              ),
                              const SizedBox(width: 8),
                              const Expanded(
                                child: Text(
                                  'التوصيل ورمز العميل',
                                  style: TextStyle(
                                    fontSize: 16,
                                    fontWeight: FontWeight.w900,
                                  ),
                                ),
                              ),
                              _MiniStatus(text: _status(deliveryStatus)),
                            ],
                          ),
                          const SizedBox(height: 12),
                          _Facts(
                            values: {
                              'السائق المسند':
                                  '${driver['full_name'] ?? 'لم يُسند سائق'}',
                              'رقم السائق': '${driver['mobile'] ?? '—'}',
                              'موعد التوصيل': _date(assignment['expected_at']),
                            },
                          ),
                          if (canAssignDriver) ...[
                            const SizedBox(height: 14),
                            Container(
                              padding: const EdgeInsets.all(14),
                              decoration: BoxDecoration(
                                color: Colors.white,
                                borderRadius: BorderRadius.circular(18),
                                border: Border.all(color: BunyaColors.line),
                              ),
                              child: FutureBuilder<List<Map<String, dynamic>>>(
                                future: drivers,
                                builder: (context, driverSnapshot) {
                                  if (driverSnapshot.connectionState ==
                                      ConnectionState.waiting) {
                                    return const Center(
                                      child: CircularProgressIndicator(),
                                    );
                                  }
                                  final allDrivers =
                                      driverSnapshot.data ?? const [];
                                  final activeDrivers = allDrivers
                                      .where(
                                        (item) => item['status'] == 'active',
                                      )
                                      .toList();
                                  final pendingDrivers = allDrivers
                                      .where(
                                        (item) =>
                                            item['status'] ==
                                            'must_change_password',
                                      )
                                      .length;
                                  return Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.stretch,
                                    children: [
                                      Text(
                                        hasAssignedDriver
                                            ? 'تغيير السائق قبل بدء الرحلة'
                                            : 'إسناد الطلب إلى سائق',
                                        style: const TextStyle(
                                          fontSize: 15,
                                          fontWeight: FontWeight.w900,
                                        ),
                                      ),
                                      const SizedBox(height: 4),
                                      Text(
                                        hasAssignedDriver
                                            ? 'يمكن تغيير السائق ما دامت الرحلة لم تبدأ.'
                                            : 'بعد الإسناد يظهر الطلب في حساب السائق وتصل تفاصيل المهمة للعميل والسائق.',
                                        style: const TextStyle(
                                          color: BunyaColors.muted,
                                          height: 1.55,
                                          fontSize: 11,
                                          fontWeight: FontWeight.w700,
                                        ),
                                      ),
                                      const SizedBox(height: 10),
                                      if (activeDrivers.isNotEmpty) ...[
                                        DropdownButtonFormField<String>(
                                          key: ValueKey(
                                            selectedDriverId ?? 'no-driver',
                                          ),
                                          initialValue: selectedDriverId,
                                          decoration: const InputDecoration(
                                            labelText: 'السائق النشط',
                                            prefixIcon: Icon(
                                              Icons.badge_outlined,
                                            ),
                                          ),
                                          items: activeDrivers
                                              .map(
                                                (item) => DropdownMenuItem(
                                                  value: '${item['id']}',
                                                  child: Text(
                                                    '${item['full_name']} · ${item['mobile']}',
                                                    overflow:
                                                        TextOverflow.ellipsis,
                                                  ),
                                                ),
                                              )
                                              .toList(),
                                          onChanged: busy
                                              ? null
                                              : (value) => setState(
                                                  () =>
                                                      selectedDriverId = value,
                                                ),
                                        ),
                                        const SizedBox(height: 9),
                                        FilledButton.icon(
                                          onPressed:
                                              busy || selectedDriverId == null
                                              ? null
                                              : assignDriver,
                                          icon: const Icon(
                                            Icons.assignment_ind_outlined,
                                          ),
                                          label: Text(
                                            busy
                                                ? 'جارٍ الإسناد…'
                                                : 'إسناد الطلب للسائق',
                                          ),
                                        ),
                                      ] else
                                        Container(
                                          padding: const EdgeInsets.all(11),
                                          decoration: BoxDecoration(
                                            color: BunyaColors.sand,
                                            borderRadius: BorderRadius.circular(
                                              14,
                                            ),
                                          ),
                                          child: Text(
                                            pendingDrivers > 0
                                                ? 'يوجد $pendingDrivers سائق بانتظار أول دخول وتغيير كلمة المرور. بعدها يصبح متاحًا للإسناد.'
                                                : 'لا يوجد سائق نشط في المنشأة حتى الآن.',
                                            style: const TextStyle(
                                              color: BunyaColors.muted,
                                              height: 1.6,
                                              fontWeight: FontWeight.w700,
                                            ),
                                          ),
                                        ),
                                      const SizedBox(height: 5),
                                      TextButton.icon(
                                        onPressed: busy
                                            ? null
                                            : addDriverFromOrder,
                                        icon: const Icon(
                                          Icons.person_add_alt_1_rounded,
                                        ),
                                        label: const Text(
                                          'إضافة سائق جديد من التطبيق',
                                        ),
                                      ),
                                    ],
                                  );
                                },
                              ),
                            ),
                          ],
                          if (deliveryStatus == 'arrived') ...[
                            const SizedBox(height: 12),
                            const Text(
                              'أدخل الرمز الذي وصل للعميل بعد استلامه كامل البضاعة.',
                              style: TextStyle(
                                color: BunyaColors.muted,
                                height: 1.6,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                            const SizedBox(height: 8),
                            TextField(
                              controller: deliveryCode,
                              keyboardType: TextInputType.number,
                              textDirection: TextDirection.ltr,
                              maxLength: 12,
                              autofillHints: const [AutofillHints.oneTimeCode],
                              decoration: const InputDecoration(
                                counterText: '',
                                labelText: 'رمز التسليم',
                              ),
                            ),
                            const SizedBox(height: 9),
                            FilledButton.icon(
                              onPressed: busy
                                  ? null
                                  : () => confirmProviderDelivery(
                                      '${assignment['id']}',
                                    ),
                              icon: const Icon(Icons.verified_user_outlined),
                              label: Text(
                                busy
                                    ? 'جارٍ التحقق…'
                                    : 'تأكيد التسليم وإغلاق الطلب',
                              ),
                            ),
                          ],
                        ],
                      ),
                    );
                  },
                ),
              ],
              if (widget.module.action == 'fulfillment' &&
                  const {'assigned', 'preparing'}.contains(row['status'])) ...[
                const SizedBox(height: 22),
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: BunyaColors.sand,
                    borderRadius: BorderRadius.circular(22),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'إجراء التوريد',
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      const SizedBox(height: 10),
                      TextField(
                        controller: note,
                        decoration: const InputDecoration(
                          hintText: 'ملاحظة التشغيل (اختياري)',
                        ),
                      ),
                      const SizedBox(height: 10),
                      FilledButton.icon(
                        onPressed: busy ? null : fulfillmentAction,
                        icon: Icon(
                          row['status'] == 'assigned'
                              ? Icons.play_arrow_rounded
                              : Icons.inventory_rounded,
                        ),
                        label: Text(
                          row['status'] == 'assigned'
                              ? 'بدء تجهيز الطلب'
                              : 'تأكيد جاهزية الطلب',
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _RecordFact extends StatelessWidget {
  const _RecordFact({
    required this.label,
    required this.value,
    required this.icon,
    required this.wide,
    this.url,
  });
  final String label, value;
  final IconData icon;
  final bool wide;
  final String? url;

  @override
  Widget build(BuildContext context) => Material(
    color: Colors.white,
    borderRadius: BorderRadius.circular(20),
    child: InkWell(
      onTap: url == null
          ? null
          : () => launchUrl(
              Uri.parse(url!),
              mode: LaunchMode.externalApplication,
            ),
      borderRadius: BorderRadius.circular(20),
      child: Container(
        constraints: BoxConstraints(minHeight: wide ? 84 : 98),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: BunyaColors.line),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(icon, size: 17, color: BunyaColors.copper),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    label,
                    style: const TextStyle(
                      color: BunyaColors.muted,
                      fontSize: 10,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                if (url != null)
                  const Icon(
                    Icons.open_in_new_rounded,
                    size: 16,
                    color: BunyaColors.forest,
                  ),
              ],
            ),
            const SizedBox(height: 7),
            Text(
              url == null ? value : 'فتح في الخرائط',
              maxLines: wide ? 5 : 2,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                color: url == null ? BunyaColors.ink : BunyaColors.forest,
                fontWeight: FontWeight.w900,
                height: 1.5,
              ),
            ),
          ],
        ),
      ),
    ),
  );
}

class _Empty extends StatelessWidget {
  const _Empty({required this.text});
  final String text;
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(25),
    decoration: _panel(),
    child: Column(
      children: [
        const Icon(Icons.inbox_outlined, size: 42, color: BunyaColors.copper),
        const SizedBox(height: 8),
        Text(
          text,
          textAlign: TextAlign.center,
          style: const TextStyle(
            color: BunyaColors.muted,
            fontWeight: FontWeight.w700,
          ),
        ),
      ],
    ),
  );
}

BoxDecoration _panel() => BoxDecoration(
  color: Colors.white,
  borderRadius: BorderRadius.circular(20),
  border: Border.all(color: BunyaColors.line),
);
void _notice(BuildContext context, String text) =>
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
String _clean(Object error) => error.toString().replaceFirst('Exception: ', '');
String _friendlyNotificationMessage(String value) {
  final cleaned = value
      .replaceAll(
        RegExp(
          r'\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b',
        ),
        '',
      )
      .replaceAll(RegExp(r'https?://\S+'), '')
      .replaceAll(RegExp(r'\s+'), ' ')
      .trim();
  return cleaned.isEmpty ? 'افتح الإشعار للاطلاع على التفاصيل.' : cleaned;
}

String _date(Object? value) => value == null
    ? '—'
    : (DateTime.tryParse('$value')?.toLocal().toString().substring(0, 16) ??
          '$value');
String _rentalUnit(String value) =>
    const {
      'day': 'يوم',
      'week': 'أسبوع',
      'month': 'شهر',
      'year': 'سنة',
    }[value] ??
    value;
String _status(String value) =>
    const {
      'pending': 'قيد المراجعة',
      'needs_changes': 'يحتاج تعديل',
      'approved': 'معتمد',
      'rejected': 'مرفوض',
      'pending_review': 'تحت المراجعة',
      'assigned': 'مسند',
      'preparing': 'قيد التجهيز',
      'ready': 'جاهز',
      'delivered': 'تم التسليم',
      'under_review': 'قيد المراجعة',
      'new': 'جديد',
      'proposed': 'تم تقديم عرض',
      'draft': 'مسودة',
      'submitted': 'تم الإرسال',
      'active': 'نشط',
      'inactive': 'غير نشط',
      'available': 'متاح',
      'unavailable': 'غير متاح',
      'confirmed': 'مؤكد',
      'accepted': 'مقبول',
      'declined': 'مرفوض',
      'in_progress': 'قيد التنفيذ',
      'completed': 'مكتمل',
      'cancelled': 'ملغي',
      'expired': 'منتهي',
      'open': 'مفتوح',
      'resolved': 'تم الحل',
      'closed': 'مغلق',
      'paid': 'مدفوع',
      'unpaid': 'غير مدفوع',
      'verified': 'موثّق',
      'suspended': 'موقوف',
      'won': 'فائز',
      'lost': 'غير فائز',
      'verifying': 'جاري التحقق',
      'quoting': 'جاري التسعير',
      'preparing_quote': 'تجهيز العرض',
      'ready_for_customer': 'جاهز للعميل',
      'evaluating': 'قيد التقييم',
      'selected': 'تم الاختيار',
      'sent': 'تم الإرسال',
      'failed': 'تعذر الإرسال',
      'provisioned': 'تم إنشاء الحساب',
    }[value] ??
    value;
String _roleLabel(BuildContext context, String role) => context.tr(
  const {
        'admin': 'adminPortal',
        'provider': 'providerPortal',
        'contractor': 'contractorPortal',
        'driver': 'driverPortal',
      }[role] ??
      'bunyaAccount',
);

String _welcome(BuildContext context, String role) => context.tr(
  const {
        'admin': 'adminWelcome',
        'provider': 'providerWelcome',
        'contractor': 'contractorWelcome',
        'driver': 'driverWelcome',
      }[role] ??
      'bunyaAccount',
);

String _roleCaption(BuildContext context, String role) => context.tr(
  const {
        'admin': 'adminWelcomeCaption',
        'provider': 'providerWelcomeCaption',
        'contractor': 'contractorWelcomeCaption',
        'driver': 'driverWelcomeCaption',
      }[role] ??
      'operationsAndServicesCaption',
);

String _metricLabel(BuildContext context, String label) => context.tr(
  const {
        'المنتجات': 'products',
        'طلبات التسعير': 'pricingRequests',
        'أوامر التوريد': 'supplyOrders',
        'الفرص': 'opportunities',
        'العروض': 'offers',
        'المشاريع': 'projects',
        'المهام النشطة': 'activeTasks',
        'وصلت للموقع': 'arrivedAtSite',
        'تم تسليمها': 'deliveredCount',
        'طلبات المزودين': 'providerApplications',
        'طلبات المقاولين': 'contractorApplications',
        'مراجعة المنتجات': 'productReviews',
      }[label] ??
      label,
);
String _recordTitle(Map<String, dynamic> row, [WorkspaceModule? module]) {
  if (module?.table == 'audit_logs') {
    return _displayValue('action', row['action'] ?? 'إجراء جديد');
  }
  return '${row['name'] ?? row['title'] ?? row['company_name'] ?? row['commercial_name'] ?? row['display_name'] ?? row['contact_name'] ?? row['project_name'] ?? row['subject'] ?? row['request_code'] ?? row['fulfillment_code'] ?? row['order_code'] ?? row['ticket_code'] ?? row['proposal_code'] ?? row['response_code'] ?? row['transaction_code'] ?? row['email'] ?? row['mobile'] ?? 'تفاصيل ${module?.title ?? 'السجل'}'}';
}

String _recordSubtitle(Map<String, dynamic> row, [WorkspaceModule? module]) {
  if (module?.table == 'profiles') {
    return '${_roleName('${row['role'] ?? 'مستخدم'}')} · ${row['mobile'] ?? 'لا يوجد جوال'}';
  }
  if (module?.table == 'audit_logs') {
    return '${_entityName('${row['entity_table'] ?? ''}')} · ${_date(row['created_at'])}';
  }
  final description =
      row['short_description'] ??
      row['description'] ??
      row['subject'] ??
      row['email'] ??
      row['mobile'] ??
      row['city'] ??
      row['delivery_region'];
  final status =
      row['status'] ?? row['review_status'] ?? row['approval_status'];
  if (description != null && status != null) {
    return '$description · ${_status('$status')}';
  }
  return '${description ?? (status == null ? _date(row['created_at']) : _status('$status'))}';
}

const _fieldLabels = <String, String>{
  'name': 'الاسم',
  'title': 'العنوان',
  'display_name': 'اسم المستخدم',
  'company_name': 'اسم المنشأة',
  'commercial_name': 'الاسم التجاري',
  'contact_name': 'اسم المسؤول',
  'email': 'البريد الإلكتروني',
  'mobile': 'رقم الجوال',
  'role': 'نوع الحساب',
  'status': 'الحالة',
  'review_status': 'حالة المراجعة',
  'approval_status': 'حالة الاعتماد',
  'availability': 'حالة التوفر',
  'is_active': 'الحساب نشط',
  'subscription_active': 'الاشتراك نشط',
  'is_published': 'ظاهر للعملاء',
  'is_verified': 'تم التحقق',
  'created_at': 'تاريخ الإنشاء',
  'updated_at': 'آخر تحديث',
  'last_active_at': 'آخر نشاط',
  'approved_at': 'تاريخ الاعتماد',
  'submitted_at': 'تاريخ الإرسال',
  'assigned_at': 'تاريخ الإسناد',
  'completed_at': 'تاريخ الإكمال',
  'required_at': 'موعد الاستلام المطلوب',
  'desired_receipt_at': 'موعد الاستلام المطلوب',
  'response_deadline_at': 'آخر موعد للرد',
  'quote_deadline': 'مهلة التسعير',
  'price_expires_at': 'صلاحية السعر',
  'city': 'المدينة',
  'region': 'المنطقة',
  'delivery_region': 'منطقة التوصيل',
  'location_hint': 'وصف الموقع',
  'address': 'العنوان',
  'google_maps_url': 'الموقع الجغرافي',
  'maps_url': 'الموقع الجغرافي',
  'request_code': 'رقم الطلب',
  'fulfillment_code': 'رقم أمر التوريد',
  'order_code': 'رقم الطلب',
  'ticket_code': 'رقم التذكرة',
  'proposal_code': 'رقم العرض',
  'response_code': 'رقم عرض السعر',
  'transaction_code': 'رقم العملية',
  'project_name': 'اسم المشروع',
  'project_type': 'نوع المشروع',
  'subject': 'الموضوع',
  'category': 'التصنيف',
  'document_type': 'نوع المستند',
  'service_type': 'نوع الخدمة',
  'priority': 'الأولوية',
  'description': 'الوصف',
  'short_description': 'وصف مختصر',
  'full_description': 'التفاصيل',
  'scope': 'نطاق العمل',
  'notes': 'الملاحظات',
  'internal_notes': 'ملاحظات التشغيل',
  'message': 'الرسالة',
  'resolution_notes': 'ملاحظات الحل',
  'base_unit': 'الوحدة الأساسية',
  'unit_snapshot': 'الوحدة',
  'measurement_snapshot': 'القياس',
  'quantity': 'الكمية',
  'available_quantity': 'الكمية المتوفرة',
  'availability_summary': 'ملخص التوفر',
  'delivery_window': 'مدة التوصيل',
  'delivery_mode': 'طريقة الاستلام',
  'unit_price': 'سعر الوحدة',
  'delivery_fee': 'تكلفة التوصيل',
  'amount': 'المبلغ',
  'total': 'الإجمالي',
  'subtotal': 'قيمة المنتجات',
  'vat_amount': 'الضريبة',
  'discount_amount': 'الخصم',
  'estimated_budget_min': 'الميزانية من',
  'estimated_budget_max': 'الميزانية إلى',
  'payment_status': 'حالة الدفع',
  'payment_method': 'طريقة الدفع',
  'rating': 'التقييم',
  'duration': 'مدة التنفيذ',
  'preparation_duration_hours': 'مدة التجهيز',
  'delivery_duration_hours': 'مدة التوصيل',
  'vehicle_type': 'نوع المركبة',
  'plate_number': 'رقم اللوحة',
  'license_number': 'رقم الرخصة',
  'entity_table': 'القسم المتأثر',
  'action': 'نوع الإجراء',
};

const _wideFields = <String>{
  'description',
  'short_description',
  'full_description',
  'scope',
  'notes',
  'internal_notes',
  'message',
  'resolution_notes',
  'location_hint',
  'address',
  'google_maps_url',
  'maps_url',
};

const _urlFields = <String>{'google_maps_url', 'maps_url'};

String _displayValue(String key, Object? raw) {
  if (raw == null || '$raw'.trim().isEmpty) return 'غير محدد';
  if (raw is bool) return raw ? 'نعم' : 'لا';
  final value = '$raw';
  if (key.endsWith('_at') ||
      key == 'desired_receipt_at' ||
      key == 'quote_deadline') {
    return _date(raw);
  }
  if ({
    'status',
    'review_status',
    'approval_status',
    'availability',
    'payment_status',
  }.contains(key)) {
    return _status(value);
  }
  if (key == 'role') return _roleName(value);
  if (key == 'entity_table') return _entityName(value);
  if (key == 'action') return _actionName(value);
  if (key == 'delivery_mode') {
    return value == 'pickup' ? 'استلام من المزود' : 'توصيل للموقع';
  }
  if (key == 'priority') {
    return const {'low': 'منخفضة', 'normal': 'عادية', 'high': 'عالية'}[value] ??
        value;
  }
  if ({
    'unit_price',
    'delivery_fee',
    'amount',
    'total',
    'subtotal',
    'vat_amount',
    'discount_amount',
    'estimated_budget_min',
    'estimated_budget_max',
  }.contains(key)) {
    return '$value ر.س';
  }
  if (key == 'rating') return '$value من 5';
  if (key.endsWith('_duration_hours')) return '$value ساعة';
  return value;
}

String _roleName(String value) =>
    const {
      'admin': 'إدارة',
      'customer': 'عميل',
      'provider': 'مزود',
      'contractor': 'مقاول',
      'driver': 'سائق',
    }[value] ??
    value;

String _entityName(String value) =>
    const {
      'profiles': 'المستخدمون',
      'providers': 'المزودون',
      'contractor_profiles': 'المقاولون',
      'products': 'المنتجات',
      'quote_requests': 'طلبات التسعير',
      'orders': 'الطلبات',
      'internal_fulfillment_orders': 'أوامر التوريد',
      'support_tickets': 'الدعم',
      'financial_transactions': 'المالية',
    }[value] ??
    'عمليات المنصة';

String _actionName(String value) =>
    const {
      'insert': 'إضافة سجل جديد',
      'update': 'تحديث البيانات',
      'delete': 'حذف سجل',
      'approve': 'اعتماد',
      'reject': 'رفض',
      'assigned': 'إسناد الطلب',
      'notification_retry_requested': 'إعادة إرسال إشعار',
    }[value] ??
    'إجراء تشغيلي';

IconData _fieldIcon(String key) {
  if (key.contains('email')) return Icons.alternate_email_rounded;
  if (key.contains('mobile')) return Icons.phone_rounded;
  if (key.contains('status') || key == 'availability') {
    return Icons.verified_outlined;
  }
  if (key.contains('date') || key.endsWith('_at')) {
    return Icons.event_outlined;
  }
  if (key.contains('price') ||
      key.contains('amount') ||
      key.contains('fee') ||
      key == 'total') {
    return Icons.payments_outlined;
  }
  if (_urlFields.contains(key)) return Icons.map_outlined;
  if (key.contains('city') || key.contains('region')) {
    return Icons.location_on_outlined;
  }
  if (key.contains('quantity') || key.contains('unit')) {
    return Icons.inventory_2_outlined;
  }
  if (key == 'action') return Icons.bolt_rounded;
  return Icons.info_outline_rounded;
}
