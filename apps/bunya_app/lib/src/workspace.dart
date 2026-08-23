import 'dart:convert';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:url_launcher/url_launcher.dart';

import 'data.dart';
import 'theme.dart';

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

  Future<List<Map<String, dynamic>>> loadModule(WorkspaceModule module) async {
    final isProducts = module.table == 'products';
    final isQuoteRequests = module.table == 'quote_requests';
    final selection = isProducts
        ? '*,product_categories(name),product_images(image_url,storage_path,is_primary,sort_order)'
        : isQuoteRequests
        ? '*,quote_request_items(product_name_snapshot,measurement_label_snapshot,unit_name_snapshot,quantity,notes),bunya_customer_quotes(quote_code,subtotal,vat_amount,delivery_fee,total,valid_until,expected_delivery_at,status,processing_stage)'
        : '*';
    dynamic query = client.from(module.table).select(selection);
    if (module.filterField != null && module.filterValue != null) {
      query = query.eq(module.filterField!, module.filterValue!);
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
    final signedUrls = <String, String>{};
    if (paths.isNotEmpty) {
      try {
        final signed = await client.storage
            .from('provider-product-images')
            .createSignedUrls(paths.toList(), 21600);
        for (final item in signed) {
          signedUrls[item.path] = item.signedUrl;
        }
      } catch (_) {}
    }
    for (final row in records) {
      final image = row['_primary_image'];
      if (image is! Map) continue;
      final path = '${image['storage_path'] ?? ''}'.trim();
      final directUrl = '${image['image_url'] ?? ''}'.trim();
      row['_image_url'] = directUrl.isNotEmpty ? directUrl : signedUrls[path];
      row['_image_cache_key'] = path.isNotEmpty ? path : directUrl;
    }
    return records;
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
  }

  Future<List<Map<String, dynamic>>> providerRfqs(String providerId) async {
    final rows = await client
        .from('internal_sourcing_request_targets')
        .select(
          'sourcing_request_item_id,targeted_at,response_deadline_at,internal_sourcing_request_items(id,quantity,unit_snapshot,measurement_snapshot,delivery_region,required_at,quote_request_items(product_name_snapshot,notes),internal_sourcing_requests(internal_code),provider_pricing_responses(id,status,unit_price))',
        )
        .eq('provider_id', providerId)
        .order('response_deadline_at');
    return (rows as List)
        .map((row) => Map<String, dynamic>.from(row as Map))
        .toList();
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
  }) async {
    await client.rpc(
      'submit_provider_pricing_response',
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
              .add(const Duration(hours: 24))
              .toUtc()
              .toIso8601String(),
          'notes': notes,
        },
      },
    );
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
    return '${body['status'] ?? 'تم التنفيذ'}';
  }
}

class RoleWorkspace extends StatefulWidget {
  const RoleWorkspace({
    super.key,
    required this.profile,
    required this.repository,
    required this.onLogout,
  });
  final Profile profile;
  final BunyaRepository repository;
  final Future<void> Function() onLogout;

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
  Widget build(BuildContext context) => FutureBuilder<RoleContext>(
    future: identity,
    builder: (_, snapshot) {
      if (!snapshot.hasData) {
        return const Scaffold(body: Center(child: CircularProgressIndicator()));
      }
      final role = snapshot.data!;
      final pages = [
        _RoleHome(repository: workspace, contextData: role),
        if (role.role == 'admin')
          _AdminApplications(repository: workspace)
        else if (role.role == 'provider')
          _ProviderRfqs(repository: workspace, providerId: role.entityId!)
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
          onLogout: widget.onLogout,
        ),
      ];
      return Scaffold(
        appBar: AppBar(
          title: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(role.name, style: const TextStyle(fontSize: 17)),
              Text(
                _roleLabel(role.role),
                style: const TextStyle(
                  color: BunyaColors.muted,
                  fontSize: 10,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
          actions: [
            Container(
              width: 42,
              height: 42,
              margin: const EdgeInsetsDirectional.only(end: 12),
              padding: const EdgeInsets.all(7),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(14),
              ),
              child: Image.asset('assets/brand/app-icon.png'),
            ),
          ],
        ),
        body: IndexedStack(index: index, children: pages),
        bottomNavigationBar: NavigationBar(
          selectedIndex: index,
          onDestinationSelected: (value) => setState(() => index = value),
          destinations: [
            const NavigationDestination(
              icon: Icon(Icons.dashboard_outlined),
              selectedIcon: Icon(Icons.dashboard_rounded),
              label: 'الرئيسية',
            ),
            NavigationDestination(
              icon: Icon(
                role.role == 'admin'
                    ? Icons.fact_check_outlined
                    : role.role == 'provider'
                    ? Icons.request_quote_outlined
                    : Icons.work_outline_rounded,
              ),
              label: role.role == 'admin'
                  ? 'الاعتمادات'
                  : role.role == 'provider'
                  ? 'التسعير'
                  : 'الفرص',
            ),
            const NavigationDestination(
              icon: Icon(Icons.apps_rounded),
              label: 'الخدمات',
            ),
            const NavigationDestination(
              icon: Icon(Icons.notifications_none_rounded),
              label: 'الإشعارات',
            ),
            const NavigationDestination(
              icon: Icon(Icons.person_outline_rounded),
              label: 'الحساب',
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
              const Icon(Icons.auto_awesome_rounded, color: Colors.white),
              const SizedBox(height: 28),
              Text(
                _welcome(widget.contextData.role),
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 22,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 5),
              Text(
                _roleCaption(widget.contextData.role),
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
                              entry.key,
                              textAlign: TextAlign.center,
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
          child: const Row(
            children: [
              CircleAvatar(
                backgroundColor: BunyaColors.mint,
                child: Icon(Icons.sync_rounded, color: BunyaColors.forest),
              ),
              SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'بيانات حية ومتصلة',
                      style: TextStyle(fontWeight: FontWeight.w900),
                    ),
                    Text(
                      'كل استلام وإجراء يُحفظ في Supabase وتتبعه منظومة الإشعارات نفسها.',
                      style: TextStyle(
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
  void reload() =>
      setState(() => rows = widget.repository.providerRfqs(widget.providerId));

  @override
  Widget build(BuildContext context) => _FutureList(
    title: 'طلبات التسعير',
    caption: 'افتح الطلب وراجع الكمية والموقع ثم أرسل عرضك.',
    future: rows,
    item: (row) {
      final item = row['internal_sourcing_request_items'] as Map? ?? const {};
      final product = item['quote_request_items'] as Map? ?? const {};
      final responses = item['provider_pricing_responses'];
      final answered = responses is List && responses.isNotEmpty;
      return _RecordCard(
        title: '${product['product_name_snapshot'] ?? 'منتج مطلوب'}',
        subtitle:
            '${item['quantity'] ?? '—'} ${item['unit_snapshot'] ?? ''} · ${item['delivery_region'] ?? '—'}',
        status: answered ? 'تم تقديم السعر' : 'بانتظار ردك',
        onTap: answered
            ? null
            : () async {
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
      );
    },
  );
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
  late final Future<Map<String, dynamic>> target = widget.repository
      .providerRfq(widget.id);
  bool busy = false;
  @override
  void dispose() {
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
        if (!snapshot.hasData)
          return const Center(child: CircularProgressIndicator());
        final row = snapshot.data!;
        final quantity = (row['quantity'] as num? ?? 0).toDouble();
        final existing = row['existing_response'] is Map
            ? Map<String, dynamic>.from(row['existing_response'] as Map)
            : null;
        final unitPrice = (existing?['unit_price'] as num? ?? 0).toDouble();
        final deliveryFee = (existing?['delivery_fee'] as num? ?? 0).toDouble();
        final subtotal = unitPrice * quantity;
        final vat = existing?['vat_inclusive'] == true ? 0.0 : subtotal * .15;
        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            _DetailHeader(
              title: '${row['product_name'] ?? 'منتج مطلوب'}',
              caption: '${row['request_code'] ?? row['internal_code'] ?? ''}',
            ),
            const SizedBox(height: 12),
            _Facts(
              values: {
                'الكمية': '$quantity ${row['unit_snapshot'] ?? ''}',
                'المنطقة': '${row['delivery_region'] ?? '—'}',
                'أقل سعر حالي': row['current_lowest_landed_cost'] == null
                    ? 'لا يوجد عرض'
                    : '${row['current_lowest_landed_cost']} ر.س',
                'الموقع': '${row['location_hint'] ?? '—'}',
              },
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
                        'تم تقديم عرضك ${existing['response_code'] ?? ''} وهو محفوظ للقراءة فقط.',
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
              const SizedBox(height: 16),
              FilledButton.icon(
                onPressed: busy
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
                      scope.text.trim().length < 10)
                    return _notice(
                      context,
                      'أكمل قيمة العرض والمدة ونطاق العمل',
                    );
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

  void reload() => setState(() => rows = widget.repository.adminApplications());

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
        reason.text.trim().length < 5)
      return _notice(context, 'اكتب سبب القرار بوضوح');
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

class _RoleModules extends StatelessWidget {
  const _RoleModules({required this.repository, required this.contextData});
  final WorkspaceRepository repository;
  final RoleContext contextData;

  List<WorkspaceModule> get modules {
    final id = contextData.entityId;
    if (contextData.role == 'provider')
      return [
        WorkspaceModule(
          title: 'المنتجات',
          caption: 'المنتجات والمراجعة والتوفر',
          icon: Icons.inventory_2_outlined,
          table: 'products',
          filterField: 'provider_id',
          filterValue: id,
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
    if (contextData.role == 'contractor')
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
        title: 'المالية',
        caption: 'الحركات والتسويات',
        icon: Icons.account_balance_outlined,
        table: 'financial_transactions',
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
      const _PageHeading(
        title: 'الخدمات والعمليات',
        caption: 'كل وحدات الدور في تطبيق واحد.',
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
                builder: (_) =>
                    ModuleRecordsScreen(repository: repository, module: module),
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
                    module.title,
                    style: const TextStyle(fontWeight: FontWeight.w900),
                  ),
                  Text(
                    module.caption,
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

class ModuleRecordsScreen extends StatelessWidget {
  const ModuleRecordsScreen({
    super.key,
    required this.repository,
    required this.module,
  });
  final WorkspaceRepository repository;
  final WorkspaceModule module;
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(module.title)),
    body: _FutureList(
      title: module.title,
      caption: module.caption,
      future: repository.loadModule(module),
      item: (row) {
        void openDetails() => showModalBottomSheet<void>(
          context: context,
          isScrollControlled: true,
          backgroundColor: Colors.transparent,
          builder: (_) => module.table == 'products'
              ? _ProductRecordDetails(
                  row: row,
                  module: module,
                  repository: repository,
                )
              : module.table == 'quote_requests'
              ? _QuoteRequestDetails(row: row)
              : _RecordDetails(
                  row: row,
                  module: module,
                  repository: repository,
                ),
        );
        final status = _status(
          '${row['status'] ?? row['review_status'] ?? row['approval_status'] ?? 'سجل'}',
        );
        return module.table == 'products'
            ? _ProductRecordCard(row: row, status: status, onTap: openDetails)
            : _RecordCard(
                title: _recordTitle(row, module),
                subtitle: _recordSubtitle(row, module),
                status: status,
                icon: module.icon,
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

  Future<void> open(AppNotification item) async {
    await widget.repository.markNotificationRead(item);
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
      await Navigator.of(context).push(
        MaterialPageRoute(builder: (_) => _NotificationDetails(item: item)),
      );
    }
    if (mounted) {
      setState(() => rows = widget.repository.loadNotifications());
    }
  }

  @override
  Widget build(BuildContext context) => FutureBuilder<List<AppNotification>>(
    future: rows,
    builder: (_, snapshot) => ListView(
      padding: const EdgeInsets.all(16),
      children: [
        const _PageHeading(
          title: 'الإشعارات',
          caption: 'التسعير والاستلام والتنفيذ والقرارات.',
        ),
        const SizedBox(height: 12),
        if (!snapshot.hasData)
          const Center(child: CircularProgressIndicator())
        else if (snapshot.data!.isEmpty)
          const _Empty(text: 'لا توجد إشعارات حاليًا')
        else
          ...snapshot.data!.map(
            (item) => _RecordCard(
              title: item.title,
              subtitle: _friendlyNotificationMessage(item.message),
              status: item.read ? 'مقروء' : 'جديد',
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
    appBar: AppBar(title: const Text('تفاصيل الإشعار')),
    body: ListView(
      padding: const EdgeInsets.all(18),
      children: [
        _DetailHeader(title: item.title, caption: 'تنبيه من منصة بُنية'),
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
    required this.onLogout,
  });
  final Profile profile;
  final RoleContext contextData;
  final Future<void> Function() onLogout;
  @override
  Widget build(BuildContext context) => ListView(
    padding: const EdgeInsets.all(16),
    children: [
      _DetailHeader(
        title: contextData.name,
        caption: _roleLabel(contextData.role),
      ),
      const SizedBox(height: 12),
      _Facts(
        values: {
          'الاسم': profile.name,
          'البريد': profile.email,
          'الجوال': profile.mobile.isEmpty ? 'غير مضاف' : profile.mobile,
          'الدور': _roleLabel(profile.role),
        },
      ),
      const SizedBox(height: 16),
      OutlinedButton.icon(
        onPressed: () async => onLogout(),
        icon: const Icon(Icons.logout_rounded),
        label: const Text('تسجيل الخروج'),
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
              const _Empty(text: 'لا توجد سجلات حاليًا')
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
                    title,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontWeight: FontWeight.w900),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    subtitle,
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
                    status,
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
  });
  final Map<String, dynamic> row;
  final String status;
  final VoidCallback onTap;

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
      child: InkWell(
        onTap: onTap,
        child: Row(
          children: [
            SizedBox(
              width: 116,
              height: 126,
              child: imageUrl.isEmpty
                  ? const ColoredBox(
                      color: Color(0xFFF0E9E0),
                      child: Icon(
                        Icons.inventory_2_outlined,
                        size: 38,
                        color: BunyaColors.copper,
                      ),
                    )
                  : CachedNetworkImage(
                      imageUrl: imageUrl,
                      cacheKey: '${row['_image_cache_key'] ?? imageUrl}',
                      fit: BoxFit.cover,
                      memCacheWidth: 420,
                      maxWidthDiskCache: 700,
                      fadeInDuration: const Duration(milliseconds: 100),
                      placeholder: (_, _) => const ColoredBox(
                        color: Color(0xFFF0E9E0),
                        child: Center(
                          child: CircularProgressIndicator(strokeWidth: 2),
                        ),
                      ),
                      errorWidget: (_, _, _) => const ColoredBox(
                        color: Color(0xFFF0E9E0),
                        child: Icon(
                          Icons.broken_image_outlined,
                          color: BunyaColors.copper,
                        ),
                      ),
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
      text,
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
        title,
        style: Theme.of(context).textTheme.headlineSmall
            ?.copyWith(fontWeight: FontWeight.w900),
      ),
      Text(
        caption,
        style: const TextStyle(
          color: BunyaColors.muted,
          fontWeight: FontWeight.w700,
        ),
      ),
    ],
  );
}

class _DetailHeader extends StatelessWidget {
  const _DetailHeader({required this.title, required this.caption});
  final String title, caption;
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
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          caption,
          style: const TextStyle(
            color: Colors.white70,
            fontWeight: FontWeight.w700,
          ),
        ),
        const SizedBox(height: 5),
        Text(
          title,
          style: const TextStyle(
            color: Colors.white,
            fontSize: 20,
            fontWeight: FontWeight.w900,
          ),
        ),
      ],
    ),
  );
}

class _Facts extends StatelessWidget {
  const _Facts({required this.values});
  final Map<String, String> values;
  @override
  Widget build(BuildContext context) => Wrap(
    spacing: 8,
    runSpacing: 8,
    children: values.entries
        .map(
          (entry) => Container(
            width: (MediaQuery.sizeOf(context).width - 40) / 2,
            padding: const EdgeInsets.all(13),
            decoration: _panel(),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  entry.key,
                  style: const TextStyle(
                    color: BunyaColors.muted,
                    fontSize: 10,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                Text(
                  entry.value,
                  style: const TextStyle(fontWeight: FontWeight.w900),
                ),
              ],
            ),
          ),
        )
        .toList(),
  );
}

class _QuoteRequestDetails extends StatelessWidget {
  const _QuoteRequestDetails({required this.row});
  final Map<String, dynamic> row;

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
                          label: 'المدينة',
                          value: '${row['city'] ?? 'غير محددة'}',
                          icon: Icons.location_city_outlined,
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
                _CustomerQuoteSummary(quote: quote),
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
          text,
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
                '${item['product_name_snapshot'] ?? 'منتج'}',
                style: const TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 6),
              Text(
                '${item['quantity'] ?? '—'} ${item['unit_name_snapshot'] ?? 'وحدة'}${item['measurement_label_snapshot'] == null ? '' : ' · ${item['measurement_label_snapshot']}'}',
                style: const TextStyle(
                  color: BunyaColors.forest,
                  fontWeight: FontWeight.w800,
                ),
              ),
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
  const _CustomerQuoteSummary({required this.quote});
  final Map<String, dynamic> quote;
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
      ],
    ),
  );
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
    final canReview =
        widget.module.action == 'product_review' &&
        row['review_status'] == 'pending_review';

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
                          : CachedNetworkImage(
                              imageUrl: imageUrl,
                              cacheKey:
                                  '${row['_image_cache_key'] ?? imageUrl}',
                              fit: BoxFit.cover,
                              memCacheWidth: 900,
                              maxWidthDiskCache: 1200,
                              placeholder: (_, _) => const ColoredBox(
                                color: Color(0xFFEDE4D8),
                                child: Center(
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                  ),
                                ),
                              ),
                              errorWidget: (_, _, _) => const ColoredBox(
                                color: Color(0xFFEDE4D8),
                                child: Icon(
                                  Icons.broken_image_outlined,
                                  size: 58,
                                  color: BunyaColors.copper,
                                ),
                              ),
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
  bool busy = false;

  @override
  void dispose() {
    note.dispose();
    super.dispose();
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
String _roleLabel(String role) =>
    const {
      'admin': 'لوحة الإدارة',
      'provider': 'لوحة المزود',
      'contractor': 'لوحة المقاول',
    }[role] ??
    'حساب بُنية';
String _welcome(String role) => role == 'admin'
    ? 'المنصة تحت سيطرتك'
    : role == 'provider'
    ? 'حوّل الطلبات إلى مبيعات'
    : 'فرصك ومشاريعك في مكان واحد';
String _roleCaption(String role) => role == 'admin'
    ? 'راقب، اعتمد، وتابع التشغيل من التطبيق.'
    : role == 'provider'
    ? 'استلم طلب التسعير ونفّذ التوريد والتوصيل.'
    : 'استلم الفرص وقدّم العروض وتابع التنفيذ.';
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
