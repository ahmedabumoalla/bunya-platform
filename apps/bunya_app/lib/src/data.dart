import 'package:supabase_flutter/supabase_flutter.dart';

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

class AppNotification {
  const AppNotification({
    required this.id,
    required this.source,
    required this.title,
    required this.message,
    required this.createdAt,
    required this.read,
  });
  final String id, source, title, message;
  final DateTime createdAt;
  final bool read;
}

class Profile {
  const Profile({
    required this.name,
    required this.email,
    required this.mobile,
    required this.role,
  });
  final String name, email, mobile, role;
}

class BunyaRepository {
  BunyaRepository([SupabaseClient? value])
    : client = value ?? Supabase.instance.client;
  final SupabaseClient client;
  User? get user => client.auth.currentUser;

  Future<CatalogData> loadCatalog() async {
    final categoryRows = await client
        .from('product_categories')
        .select('id,name,sort_order')
        .eq('is_active', true)
        .order('sort_order');
    final rows = await client
        .from('products')
        .select(
          'id,name,base_unit,short_description,description,availability_summary,delivery_window,is_new,custom_category,product_categories(name),product_images(image_url,storage_path,is_primary,sort_order)',
        )
        .eq('is_published', true)
        .eq('review_status', 'approved')
        .order('created_at', ascending: false)
        .limit(80);
    final products = await Future.wait(
      (rows as List).map((raw) async {
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
        String? imageUrl;
        if (images.isNotEmpty) {
          imageUrl = images.first['image_url'] as String?;
          final path = images.first['storage_path'] as String?;
          if ((imageUrl == null || imageUrl.isEmpty) &&
              path != null &&
              path.isNotEmpty) {
            try {
              imageUrl = await client.storage
                  .from('provider-product-images')
                  .createSignedUrl(path, 3600);
            } catch (_) {}
          }
        }
        return Product(
          id: '${row['id']}',
          name: '${row['name'] ?? 'منتج'}',
          category: category,
          unit: '${row['base_unit'] ?? 'وحدة'}',
          description:
              '${row['description'] ?? row['short_description'] ?? ''}',
          availability: '${row['availability_summary'] ?? 'حسب التوفر'}',
          deliveryWindow: '${row['delivery_window'] ?? 'يحدد بعد الطلب'}',
          imageUrl: imageUrl,
          isNew: row['is_new'] == true,
        );
      }),
    );
    return CatalogData(
      (categoryRows as List).map((row) => '${(row as Map)['name']}').toList(),
      products,
    );
  }

  Future<void> signIn(String email, String password) async =>
      client.auth.signInWithPassword(email: email.trim(), password: password);
  Future<void> signOut() => client.auth.signOut();

  Future<Profile?> loadProfile() async {
    if (user == null) return null;
    final row = await client
        .from('profiles')
        .select('full_name,email,mobile,role')
        .eq('id', user!.id)
        .maybeSingle();
    if (row == null) return null;
    return Profile(
      name: '${row['full_name'] ?? 'مستخدم بُنية'}',
      email: '${row['email'] ?? user!.email ?? ''}',
      mobile: '${row['mobile'] ?? ''}',
      role: '${row['role'] ?? 'customer'}',
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

  Future<List<AppNotification>> loadNotifications() async {
    if (user == null) return const [];
    final rows = await client
        .from('notifications')
        .select('id,title,message,created_at,read_at')
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
          .select('id,title,message,created_at,read_at')
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
            .select('id,title,message,created_at,read_at')
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
