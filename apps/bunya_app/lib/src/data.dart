import 'dart:convert';
import 'dart:math';

import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';

import 'product_image_urls.dart';

const _appUrl = String.fromEnvironment(
  'APP_URL',
  defaultValue: 'https://www.buniahksa.com',
);

class Product {
  const Product({
    required this.id,
    required this.name,
    required this.category,
    required this.unit,
    required this.description,
    required this.availability,
    required this.deliveryWindow,
    required this.imageUrl,
    required this.imageCacheKey,
    required this.isNew,
  });
  final String id,
      name,
      category,
      unit,
      description,
      availability,
      deliveryWindow;
  final String? imageUrl;
  final String? imageCacheKey;
  final bool isNew;
}

class CatalogData {
  const CatalogData(this.categories, this.products);
  final List<String> categories;
  final List<Product> products;
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
    required this.code,
    required this.status,
    required this.subtotal,
    required this.vat,
    required this.delivery,
    required this.total,
    required this.validUntil,
    required this.expectedDelivery,
  });
  final String code, status;
  final double subtotal, vat, delivery, total;
  final DateTime validUntil, expectedDelivery;
}

class QuoteDetail {
  const QuoteDetail({
    required this.summary,
    required this.location,
    required this.mapsUrl,
    required this.deliveryMode,
    required this.notes,
    required this.deadline,
    required this.recipientName,
    required this.recipientMobile,
    required this.items,
    required this.offer,
  });
  final QuoteSummary summary;
  final String location,
      mapsUrl,
      deliveryMode,
      notes,
      recipientName,
      recipientMobile;
  final DateTime deadline;
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

class BunyaRepository {
  BunyaRepository([SupabaseClient? value])
    : client = value ?? Supabase.instance.client;
  final SupabaseClient client;
  static CatalogData? _catalogCache;
  static DateTime? _catalogCachedAt;
  static Future<CatalogData>? _catalogRequest;
  User? get user => client.auth.currentUser;

  Future<CatalogData> loadCatalog({bool forceRefresh = false}) {
    final cachedAt = _catalogCachedAt;
    if (!forceRefresh &&
        _catalogCache != null &&
        cachedAt != null &&
        DateTime.now().difference(cachedAt) < const Duration(minutes: 5)) {
      return Future.value(_catalogCache);
    }
    if (_catalogRequest != null) return _catalogRequest!;
    final request = _fetchCatalog();
    _catalogRequest = request;
    return request.whenComplete(() => _catalogRequest = null);
  }

  Future<CatalogData> _fetchCatalog() async {
    final results = await Future.wait([
      client
          .from('product_categories')
          .select('id,name,sort_order')
          .eq('is_active', true)
          .order('sort_order'),
      client
          .from('products')
          .select(
            'id,name,base_unit,short_description,description,availability_summary,delivery_window,is_new,custom_category,product_categories(name),product_images(image_url,storage_path,is_primary,sort_order)',
          )
          .eq('is_published', true)
          .eq('review_status', 'approved')
          .order('created_at', ascending: false)
          .limit(80),
    ]);
    final categoryRows = results[0] as List;
    final rows = results[1] as List;
    final prepared = rows.map((raw) {
      final row = Map<String, dynamic>.from(raw as Map);
      final categoryRaw = row['product_categories'];
      final custom = '${row['custom_category'] ?? ''}'.trim();
      final category = custom.isNotEmpty
          ? custom
          : categoryRaw is Map
          ? '${categoryRaw['name'] ?? 'غير مصنف'}'
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
      final image = images.isEmpty ? null : images.first;
      return (row: row, category: category, image: image);
    }).toList();
    final paths = prepared
        .map((item) => '${item.image?['storage_path'] ?? ''}'.trim())
        .where((path) => path.isNotEmpty)
        .toSet()
        .toList();
    final signedUrls = await ProductImageUrls.thumbnails(client, paths);
    final products = prepared.map((item) {
      final row = item.row;
      final path = '${item.image?['storage_path'] ?? ''}'.trim();
      final directUrl = '${item.image?['image_url'] ?? ''}'.trim();
      final thumbnailUrl = (signedUrls[path] ?? '').trim();
      final imageUrl = thumbnailUrl.isNotEmpty ? thumbnailUrl : directUrl;
      return Product(
        id: '${row['id']}',
        name: '${row['name'] ?? 'منتج'}',
        category: item.category,
        unit: '${row['base_unit'] ?? 'وحدة'}',
        description: '${row['description'] ?? row['short_description'] ?? ''}',
        availability: '${row['availability_summary'] ?? 'حسب التوفر'}',
        deliveryWindow: '${row['delivery_window'] ?? 'يحدد بعد الطلب'}',
        imageUrl: imageUrl,
        imageCacheKey: path.isNotEmpty
            ? path
            : (directUrl.isEmpty ? null : directUrl),
        isNew: row['is_new'] == true,
      );
    }).toList();
    final catalog = CatalogData(
      categoryRows.map((row) => '${(row as Map)['name']}').toList(),
      products,
    );
    _catalogCache = catalog;
    _catalogCachedAt = DateTime.now();
    return catalog;
  }

  Future<void> signIn(String email, String password) async =>
      client.auth.signInWithPassword(email: email.trim(), password: password);
  Future<void> signOut() => client.auth.signOut();

  Future<Profile?> loadProfile() async {
    if (user == null) return null;
    final row = await client
        .from('profiles')
        .select('full_name,email,mobile,role,must_change_password')
        .eq('id', user!.id)
        .maybeSingle();
    if (row == null) return null;
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
    }
  }

  Future<JoinSubmission> submitJoinApplication({
    required String kind,
    required Map<String, String> fields,
    required List<String> regions,
    List<String> categories = const [],
    List<String> specialties = const [],
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
    final streamed = await request.send();
    final response = await http.Response.fromStream(streamed);
    final body = jsonDecode(response.body) as Map<String, dynamic>;
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception('${body['message'] ?? 'تعذر إرسال طلب الانضمام'}');
    }
    return JoinSubmission(
      id: '${body['applicationId']}',
      status: '${body['status']}',
    );
  }

  Future<List<QuoteSummary>> loadQuotes() async {
    if (user == null) return const [];
    final rows = await client
        .from('quote_requests')
        .select('id,request_code,status,city,created_at,desired_receipt_at')
        .eq('requester_id', user!.id)
        .order('created_at', ascending: false)
        .limit(50);
    return (rows as List).map((raw) {
      final row = raw as Map;
      return QuoteSummary(
        id: '${row['id']}',
        code: '${row['request_code']}',
        status: '${row['status']}',
        city: '${row['city']}',
        createdAt: DateTime.tryParse('${row['created_at']}') ?? DateTime.now(),
        requiredAt:
            DateTime.tryParse('${row['desired_receipt_at']}') ?? DateTime.now(),
      );
    }).toList();
  }

  Future<QuoteDetail> loadQuoteDetail(QuoteSummary summary) async {
    final request = await client
        .from('quote_requests')
        .select(
          'location_hint,google_maps_url,delivery_mode,notes,quote_deadline,recipient_name,recipient_mobile',
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
          'quote_code,status,subtotal,vat_amount,delivery_fee,total,valid_until,expected_delivery_at',
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
      recipientName: '${request['recipient_name'] ?? ''}',
      recipientMobile: '${request['recipient_mobile'] ?? ''}',
      items: items,
      offer: offer,
    );
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
    required Product product,
    required double quantity,
    required String city,
    required DateTime requiredAt,
    required String notes,
    required bool delivery,
  }) async {
    if (user == null) throw const AuthException('Authentication required');
    final result = await client.rpc(
      'submit_customer_rfq',
      params: {
        'p_request': {
          'city': city.trim(),
          'location_hint': city.trim(),
          'desired_receipt_at': requiredAt.toUtc().toIso8601String(),
          'delivery_mode': delivery ? 'delivery' : 'pickup',
          'notes': notes.trim(),
        },
        'p_items': [
          {
            'product_id': product.id,
            'quantity': quantity,
            'unit': product.unit,
            'notes': notes.trim(),
          },
        ],
        'p_idempotency_key':
            'mobile-${user!.id}-${DateTime.now().microsecondsSinceEpoch}',
      },
    );
    return '$result';
  }
}
