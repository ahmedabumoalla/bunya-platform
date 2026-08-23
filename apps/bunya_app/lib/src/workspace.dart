import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';

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
    dynamic query = client.from(module.table).select('*');
    if (module.filterField != null && module.filterValue != null) {
      query = query.eq(module.filterField!, module.filterValue!);
    }
    final rows = await query.limit(80);
    return (rows as List)
        .map((row) => Map<String, dynamic>.from(row as Map))
        .toList()
        .reversed
        .toList();
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
    final result = await client.rpc(
      'get_provider_rfq_context',
      params: {'p_sourcing_item_id': id},
    );
    return Map<String, dynamic>.from(result as Map);
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
        _RoleNotifications(repository: widget.repository),
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
    appBar: AppBar(title: const Text('تقديم عرض السعر')),
    body: FutureBuilder<Map<String, dynamic>>(
      future: target,
      builder: (_, snapshot) {
        if (!snapshot.hasData)
          return const Center(child: CircularProgressIndicator());
        final row = snapshot.data!;
        final quantity = (row['quantity'] as num? ?? 0).toDouble();
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
            TextField(
              controller: price,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(labelText: 'سعر الوحدة (ر.س)'),
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
                      if ((double.tryParse(price.text) ?? 0) <= 0)
                        return _notice(context, 'أدخل سعرًا صحيحًا');
                      setState(() => busy = true);
                      try {
                        await widget.repository.submitProviderPrice(
                          id: widget.id,
                          price: double.parse(price.text),
                          quantity: quantity,
                          deliveryFee: double.tryParse(delivery.text) ?? 0,
                          preparationHours: int.tryParse(preparation.text) ?? 0,
                          deliveryHours: int.tryParse(deliveryHours.text) ?? 0,
                          notes: notes.text,
                        );
                        if (context.mounted) {
                          _notice(context, 'تم استلام عرض السعر');
                          Navigator.pop(context);
                        }
                      } catch (error) {
                        if (context.mounted) _notice(context, _clean(error));
                      }
                      if (mounted) setState(() => busy = false);
                    },
              icon: const Icon(Icons.send_rounded),
              label: const Text('تأكيد وإرسال العرض'),
            ),
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
  void reload() => setState(() => rows = widget.repository.adminApplications());
  @override
  Widget build(BuildContext context) => _FutureList(
    title: 'طلبات الانضمام',
    caption: 'مراجعة المزودين والمقاولين وإرسال القرار وبيانات الدخول.',
    future: rows,
    item: (row) {
      final provider = row['_kind'] == 'provider';
      return _RecordCard(
        title: '${provider ? row['company_name'] : row['contractor_name']}',
        subtitle: '${row['email']} · ${row['mobile']}',
        status: _status('${row['status']}'),
        onTap: () async {
          await showModalBottomSheet<void>(
            context: context,
            isScrollControlled: true,
            builder: (_) =>
                _AdminDecisionSheet(repository: widget.repository, row: row),
          );
          reload();
        },
      );
    },
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
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.fromLTRB(
          18,
          18,
          18,
          MediaQuery.viewInsetsOf(context).bottom + 18,
        ),
        child: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _DetailHeader(
                title:
                    '${provider ? widget.row['company_name'] : widget.row['contractor_name']}',
                caption: provider ? 'طلب انضمام مزود' : 'طلب انضمام مقاول',
              ),
              const SizedBox(height: 12),
              _Facts(
                values: {
                  'البريد': '${widget.row['email']}',
                  'الجوال': '${widget.row['mobile']}',
                  'الحالة': _status('${widget.row['status']}'),
                  'تاريخ الطلب': _date(widget.row['created_at']),
                },
              ),
              const SizedBox(height: 12),
              TextField(
                controller: reason,
                maxLines: 3,
                decoration: const InputDecoration(
                  labelText: 'سبب الرفض أو طلب التعديل',
                ),
              ),
              const SizedBox(height: 12),
              FilledButton.icon(
                onPressed: busy ? null : () => action('approve'),
                icon: const Icon(Icons.verified_rounded),
                label: const Text('اعتماد وإنشاء الحساب وإرسال كلمة المرور'),
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
              const SizedBox(height: 8),
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
      ),
    );
  }
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
      item: (row) => _RecordCard(
        title: _recordTitle(row),
        subtitle: _recordSubtitle(row),
        status: _status(
          '${row['status'] ?? row['review_status'] ?? row['approval_status'] ?? 'سجل'}',
        ),
        onTap: () async {
          await showModalBottomSheet<void>(
            context: context,
            isScrollControlled: true,
            builder: (_) =>
                _RawRecord(row: row, module: module, repository: repository),
          );
        },
      ),
    ),
  );
}

class _RoleNotifications extends StatefulWidget {
  const _RoleNotifications({required this.repository});
  final BunyaRepository repository;
  @override
  State<_RoleNotifications> createState() => _RoleNotificationsState();
}

class _RoleNotificationsState extends State<_RoleNotifications> {
  late Future<List<AppNotification>> rows = widget.repository
      .loadNotifications();
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
              subtitle: item.message,
              status: item.read ? 'مقروء' : 'جديد',
              onTap: () async {
                await widget.repository.markNotificationRead(item);
                setState(() => rows = widget.repository.loadNotifications());
              },
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
    this.onTap,
  });
  final String title, subtitle, status;
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

class _RawRecord extends StatefulWidget {
  const _RawRecord({
    required this.row,
    required this.module,
    required this.repository,
  });
  final Map<String, dynamic> row;
  final WorkspaceModule module;
  final WorkspaceRepository repository;

  @override
  State<_RawRecord> createState() => _RawRecordState();
}

class _RawRecordState extends State<_RawRecord> {
  final note = TextEditingController();
  bool busy = false;

  @override
  void dispose() {
    note.dispose();
    super.dispose();
  }

  Future<void> productDecision(String decision) async {
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
      if (mounted) {
        _notice(context, 'تم حفظ قرار المنتج');
        Navigator.pop(context);
      }
    } catch (error) {
      if (mounted) _notice(context, _clean(error));
    }
    if (mounted) setState(() => busy = false);
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
        .where((item) => item.value != null && item.value.toString().isNotEmpty)
        .take(18)
        .toList();
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _DetailHeader(
                title: _recordTitle(row),
                caption: widget.module.title,
              ),
              const SizedBox(height: 12),
              ...entries.map(
                (entry) => Container(
                  width: double.infinity,
                  margin: const EdgeInsets.only(bottom: 7),
                  padding: const EdgeInsets.all(12),
                  decoration: _panel(),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        _field(entry.key),
                        style: const TextStyle(
                          color: BunyaColors.muted,
                          fontSize: 10,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      SelectableText(
                        '${entry.value}',
                        style: const TextStyle(fontWeight: FontWeight.w800),
                      ),
                      if (widget.module.action == 'product_review' &&
                          row['review_status'] == 'pending_review') ...[
                        const SizedBox(height: 8),
                        TextField(
                          controller: note,
                          maxLines: 3,
                          decoration: const InputDecoration(
                            labelText: 'ملاحظة قرار المراجعة',
                          ),
                        ),
                        const SizedBox(height: 10),
                        FilledButton.icon(
                          onPressed: busy
                              ? null
                              : () => productDecision('approved'),
                          icon: const Icon(Icons.check_rounded),
                          label: const Text('اعتماد المنتج'),
                        ),
                        const SizedBox(height: 7),
                        OutlinedButton.icon(
                          onPressed: busy
                              ? null
                              : () => productDecision('needs_changes'),
                          icon: const Icon(Icons.edit_note_rounded),
                          label: const Text('إعادته للمزود للتعديل'),
                          style: OutlinedButton.styleFrom(
                            minimumSize: const Size.fromHeight(50),
                          ),
                        ),
                        TextButton.icon(
                          onPressed: busy
                              ? null
                              : () => productDecision('rejected'),
                          icon: const Icon(Icons.close_rounded),
                          label: const Text('رفض المنتج'),
                          style: TextButton.styleFrom(
                            foregroundColor: BunyaColors.danger,
                            minimumSize: const Size.fromHeight(48),
                          ),
                        ),
                      ],
                      if (widget.module.action == 'fulfillment' &&
                          const {
                            'assigned',
                            'preparing',
                          }.contains(row['status'])) ...[
                        const SizedBox(height: 8),
                        TextField(
                          controller: note,
                          decoration: const InputDecoration(
                            labelText: 'ملاحظة التشغيل (اختياري)',
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
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
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
String _recordTitle(Map<String, dynamic> row) =>
    '${row['name'] ?? row['title'] ?? row['company_name'] ?? row['display_name'] ?? row['request_code'] ?? row['fulfillment_code'] ?? row['proposal_code'] ?? row['transaction_code'] ?? row['id'] ?? 'سجل'}';
String _recordSubtitle(Map<String, dynamic> row) =>
    '${row['description'] ?? row['email'] ?? row['city'] ?? row['subject'] ?? row['created_at'] ?? ''}';
String _field(String value) =>
    const {
      'id': 'المعرّف',
      'name': 'الاسم',
      'title': 'العنوان',
      'status': 'الحالة',
      'created_at': 'تاريخ الإنشاء',
      'updated_at': 'آخر تحديث',
      'email': 'البريد الإلكتروني',
      'mobile': 'رقم الجوال',
      'city': 'المدينة',
      'review_status': 'حالة المراجعة',
      'approval_status': 'حالة الاعتماد',
    }[value] ??
    value.replaceAll('_', ' ');
