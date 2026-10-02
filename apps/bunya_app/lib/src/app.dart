import 'dart:async';

import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter/services.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:sign_in_with_apple/sign_in_with_apple.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:url_launcher/url_launcher.dart';

import 'auth_flows.dart';
import 'brand_logo.dart';
import 'contractor_directory.dart';
import 'data.dart';
import 'join_screen.dart';
import 'product_details.dart';
import 'push_service.dart';
import 'theme.dart';
import 'workspace.dart';
import 'localization.dart';

const _saudiRegions = <String>[
  'الرياض',
  'مكة المكرمة',
  'المدينة المنورة',
  'القصيم',
  'المنطقة الشرقية',
  'عسير',
  'تبوك',
  'حائل',
  'الحدود الشمالية',
  'جازان',
  'نجران',
  'الباحة',
  'الجوف',
];

class ConfigurationMissingApp extends StatelessWidget {
  const ConfigurationMissingApp({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
    debugShowCheckedModeBanner: false,
    theme: bunyaTheme(),
    builder: (context, child) => AnnotatedRegion<SystemUiOverlayStyle>(
      value: bunyaSystemUiOverlayStyle,
      child: child ?? const SizedBox.shrink(),
    ),
    home: const Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        body: Center(
          child: Padding(
            padding: EdgeInsets.all(28),
            child: Text(
              'إعداد الاتصال غير مكتمل. شغّل التطبيق من الأمر المخصص في مجلد التطبيق.',
              textAlign: TextAlign.center,
            ),
          ),
        ),
      ),
    ),
  );
}

class BunyaApp extends StatefulWidget {
  const BunyaApp({super.key});
  @override
  State<BunyaApp> createState() => _BunyaAppState();
}

class _BunyaAppState extends State<BunyaApp> {
  StreamSubscription<AuthState>? _auth;
  int authVersion = 0;
  @override
  void initState() {
    super.initState();
    _auth = Supabase.instance.client.auth.onAuthStateChange.listen((event) {
      if (event.event == AuthChangeEvent.signedIn && event.session != null) {
        unawaited(PushService.registerForCurrentUser());
      }
      if (mounted &&
          const {
            AuthChangeEvent.signedIn,
            AuthChangeEvent.signedOut,
          }.contains(event.event)) {
        setState(() => authVersion++);
      }
    });
  }

  @override
  void dispose() {
    _auth?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => ValueListenableBuilder<Locale>(
    valueListenable: BunyaLocaleController.locale,
    builder: (context, locale, _) => MaterialApp(
      key: ValueKey('$authVersion-${locale.languageCode}'),
      title: 'بُنية',
      debugShowCheckedModeBanner: false,
      theme: bunyaTheme(locale: locale),
      builder: (context, child) => AnnotatedRegion<SystemUiOverlayStyle>(
        value: bunyaSystemUiOverlayStyle,
        child: child ?? const SizedBox.shrink(),
      ),
      locale: locale,
      supportedLocales: supportedBunyaLocales,
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      home: const BunyaShell(),
    ),
  );
}

class BunyaShell extends StatefulWidget {
  const BunyaShell({super.key});
  @override
  State<BunyaShell> createState() => _BunyaShellState();
}

class _BunyaShellState extends State<BunyaShell> {
  final repo = BunyaRepository();
  late Future<CatalogData> catalog = repo.loadCatalog();
  Future<Profile?>? roleProfile;
  final List<MobileQuoteItem> quoteItems = [];
  int index = 0;
  bool showCustomerWorkspace = false;

  @override
  void initState() {
    super.initState();
    AppDataRefresh.revision.addListener(_refreshData);
    BunyaLocaleController.locale.addListener(_localeChanged);
    if (repo.user != null) roleProfile = repo.loadProfile();
  }

  void _refreshData() {
    if (!mounted || repo.user != null) return;
    setState(() {
      catalog = repo.loadCatalog(forceRefresh: true);
    });
  }

  void _localeChanged() {
    BunyaRepository.notifyDataChanged();
    if (mounted) setState(() => catalog = repo.loadCatalog(forceRefresh: true));
  }

  @override
  void dispose() {
    AppDataRefresh.revision.removeListener(_refreshData);
    BunyaLocaleController.locale.removeListener(_localeChanged);
    super.dispose();
  }

  Future<bool> ensureAuth() async {
    if (repo.user != null) return true;
    final authenticated =
        await Navigator.of(context).push<bool>(
          MaterialPageRoute(builder: (_) => LoginScreen(repository: repo)),
        ) ??
        false;
    if (authenticated && mounted) {
      setState(() {
        roleProfile = repo.loadProfile();
      });
    }
    return authenticated;
  }

  void refreshCatalog() => setState(() {
    catalog = repo.loadCatalog(forceRefresh: true);
  });

  @override
  Widget build(BuildContext context) {
    if (repo.user != null) {
      roleProfile ??= repo.loadProfile();
      return FutureBuilder<Profile?>(
        future: roleProfile,
        builder: (_, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Scaffold(
              body: Center(child: CircularProgressIndicator()),
            );
          }
          final profile = snapshot.data;
          final needsPhoneVerification =
              !repo.hasVerifiedPhone &&
              (profile == null ||
                  const {'customer', 'provider'}.contains(profile.role) ||
                  (showCustomerWorkspace && profile.canSwitchToCustomer));
          if (needsPhoneVerification) {
            return PhoneVerificationScreen(
              repository: repo,
              initialPhone: repo.pendingVerificationPhone,
              codeAlreadySent: repo.pendingVerificationCodeSent,
              sendOnOpen:
                  repo.pendingVerificationPhone.isNotEmpty &&
                  !repo.pendingVerificationCodeSent,
              onVerified: () => setState(() {
                roleProfile = repo.loadProfile();
              }),
              onSignedOut: () => setState(() {
                roleProfile = null;
                index = 0;
              }),
            );
          }
          if (profile?.mustChangePassword == true) {
            return ChangePasswordScreen(
              repository: repo,
              forced: true,
              onComplete: () => setState(() {
                roleProfile = repo.loadProfile();
              }),
            );
          }
          if (profile != null &&
              const {
                'admin',
                'provider',
                'contractor',
                'driver',
              }.contains(profile.role)) {
            if (showCustomerWorkspace && profile.canSwitchToCustomer) {
              return _customerShell(businessProfile: profile);
            }
            return RoleWorkspace(
              profile: profile,
              repository: repo,
              onOpenCustomerWorkspace: profile.canSwitchToCustomer
                  ? () => setState(() {
                      showCustomerWorkspace = true;
                      index = 0;
                    })
                  : null,
              storefrontHome:
                  profile.role == 'provider' || profile.role == 'contractor'
                  ? CatalogTab(
                      catalog: catalog,
                      onProduct: openProduct,
                      onRefresh: refreshCatalog,
                    )
                  : null,
              quoteItemCount: quoteItems.length,
              onOpenQuoteBasket:
                  profile.role == 'provider' || profile.role == 'contractor'
                  ? openQuoteReview
                  : null,
              onChangePassword: () => Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) =>
                      ChangePasswordScreen(repository: repo, forced: false),
                ),
              ),
              onLogout: () async {
                await repo.signOut();
                if (mounted) {
                  setState(() {
                    roleProfile = null;
                    index = 0;
                  });
                }
              },
            );
          }
          return _customerShell();
        },
      );
    }
    return _customerShell();
  }

  Widget _customerShell({Profile? businessProfile}) {
    final pages = [
      CatalogTab(
        catalog: catalog,
        onProduct: openProduct,
        onRefresh: refreshCatalog,
      ),
      HomeTab(
        catalog: catalog,
        onCatalog: () => setState(() => index = 0),
        onContractors: openContractorsDirectory,
        onQuotes: () => setState(() => index = 2),
        onProduct: openProduct,
        onRefresh: refreshCatalog,
        onJoinProvider: () => openJoin(JoinKind.provider),
        onJoinContractor: () => openJoin(JoinKind.contractor),
      ),
      QuotesTab(repository: repo, onLogin: ensureAuth),
      AccountTab(repository: repo, onLogin: ensureAuth),
    ];
    return Scaffold(
      appBar: AppBar(
        toolbarHeight: 68,
        titleSpacing: 16,
        title: const BunyaWordmark(),
        actions: [
          const BunyaLanguageButton(),
          if (businessProfile != null)
            IconButton(
              tooltip: businessProfile.role == 'contractor'
                  ? 'العودة لحساب المقاول'
                  : 'العودة لحساب المزود',
              onPressed: () => setState(() {
                showCustomerWorkspace = false;
                index = 0;
              }),
              icon: const Icon(Icons.switch_account_outlined),
            ),
          Badge(
            isLabelVisible: quoteItems.isNotEmpty,
            label: Text('${quoteItems.length}'),
            child: IconButton.filledTonal(
              tooltip: context.tr('quoteRequest'),
              onPressed: openQuoteReview,
              icon: const Icon(Icons.receipt_long_outlined),
            ),
          ),
          const SizedBox(width: 8),
          IconButton.filledTonal(
            tooltip: context.tr('notifications'),
            onPressed: () async {
              final navigator = Navigator.of(context);
              if (!await ensureAuth() || !mounted) return;
              await navigator.push(
                MaterialPageRoute(
                  builder: (_) => NotificationsScreen(repository: repo),
                ),
              );
            },
            icon: const Icon(Icons.notifications_none_rounded),
          ),
          const SizedBox(width: 12),
        ],
      ),
      body: IndexedStack(index: index, children: pages),
      bottomNavigationBar: NavigationBar(
        selectedIndex: index,
        onDestinationSelected: (value) => setState(() => index = value),
        destinations: [
          NavigationDestination(
            icon: const Icon(Icons.space_dashboard_outlined),
            selectedIcon: const Icon(Icons.space_dashboard_rounded),
            label: context.tr('home'),
          ),
          NavigationDestination(
            icon: const Icon(Icons.apps_outlined),
            selectedIcon: const Icon(Icons.apps_rounded),
            label: context.tr('servicesNav'),
          ),
          NavigationDestination(
            icon: const Icon(Icons.receipt_long_outlined),
            selectedIcon: const Icon(Icons.receipt_long_rounded),
            label: context.tr('myRequests'),
          ),
          NavigationDestination(
            icon: const Icon(Icons.person_outline_rounded),
            selectedIcon: const Icon(Icons.person_rounded),
            label: context.tr('myAccount'),
          ),
        ],
      ),
    );
  }

  Future<void> openContractorsDirectory() => Navigator.of(context).push(
    MaterialPageRoute(
      builder: (_) => ContractorDirectoryScreen(repository: repo),
    ),
  );

  Future<void> openProduct(Product product) async {
    final request = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => ProductSheet(product: product),
    );
    if (request != true || !mounted) return;
    final item = await showModalBottomSheet<MobileQuoteItem>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => QuoteComposer(product: product),
    );
    if (item == null || !mounted) return;
    final existing = quoteItems.indexWhere(
      (candidate) => candidate.selectionKey == item.selectionKey,
    );
    setState(() {
      if (existing >= 0) {
        quoteItems[existing] = quoteItems[existing].copyWith(
          quantity: quoteItems[existing].quantity + item.quantity,
        );
      } else {
        quoteItems.add(item);
      }
    });
    _message(
      context,
      'تمت إضافة ${product.name}. اجمع بقية المنتجات ثم افتح طلب السعر.',
    );
  }

  Future<void> openQuoteReview() async {
    if (quoteItems.isEmpty) {
      _message(context, 'أضف منتجات إلى طلب عرض السعر أولًا');
      return;
    }
    if (!await ensureAuth() || !mounted) return;
    final submitted = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => QuoteRequestReviewSheet(
        repository: repo,
        items: List.of(quoteItems),
        onRemove: (selectionKey) => setState(
          () => quoteItems.removeWhere(
            (item) => item.selectionKey == selectionKey,
          ),
        ),
      ),
    );
    if (submitted == true && mounted) {
      setState(() {
        quoteItems.clear();
        index = 2;
      });
    }
  }

  Future<void> openJoin(JoinKind kind) => Navigator.of(context).push(
    MaterialPageRoute(
      builder: (_) => JoinApplicationScreen(kind: kind, repository: repo),
    ),
  );
}

class BunyaWordmark extends StatelessWidget {
  const BunyaWordmark({super.key});
  @override
  Widget build(BuildContext context) => const BunyaBrandLogo();
}

class HomeTab extends StatelessWidget {
  const HomeTab({
    super.key,
    required this.catalog,
    required this.onCatalog,
    required this.onContractors,
    required this.onQuotes,
    required this.onProduct,
    required this.onRefresh,
    required this.onJoinProvider,
    required this.onJoinContractor,
    this.showJoinProvider = true,
    this.showJoinContractor = true,
  });
  final Future<CatalogData> catalog;
  final VoidCallback onCatalog,
      onContractors,
      onQuotes,
      onRefresh,
      onJoinProvider,
      onJoinContractor;
  final ValueChanged<Product> onProduct;
  final bool showJoinProvider, showJoinContractor;

  @override
  Widget build(BuildContext context) => RefreshIndicator(
    onRefresh: () async => onRefresh(),
    child: CustomScrollView(
      slivers: [
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 20),
          sliver: SliverList.list(
            children: [
              const _HeroCard()
                  .animate()
                  .fadeIn(duration: 420.ms)
                  .slideY(begin: .08),
              const SizedBox(height: 14),
              InkWell(
                onTap: onCatalog,
                borderRadius: BorderRadius.circular(19),
                child: Container(
                  height: 60,
                  padding: const EdgeInsets.symmetric(horizontal: 17),
                  decoration: _whiteCard(19),
                  child: const Row(
                    children: [
                      Icon(Icons.search_rounded, color: BunyaColors.copper),
                      SizedBox(width: 11),
                      Expanded(
                        child: Text(
                          'ابحث عن أسمنت، حديد، عزل...',
                          style: TextStyle(
                            color: BunyaColors.muted,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                      Icon(Icons.tune_rounded, size: 20),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 22),
              const _SectionTitle(
                title: 'ابدأ من احتياجك',
                caption: 'كل خدمات مشروعك في مكان واحد',
              ),
              const SizedBox(height: 11),
              Row(
                children: [
                  Expanded(
                    child: _QuickAction(
                      icon: Icons.grid_view_rounded,
                      title: 'مواد البناء',
                      tone: const Color(0xFFF0DDCF),
                      ink: BunyaColors.copperDark,
                      onTap: onCatalog,
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: _QuickAction(
                      icon: Icons.receipt_long_rounded,
                      title: 'طلب سعر',
                      tone: BunyaColors.mint,
                      ink: BunyaColors.forest,
                      onTap: onQuotes,
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: _QuickAction(
                      icon: Icons.engineering_rounded,
                      title: 'المقاولون',
                      tone: const Color(0xFFE8E3F5),
                      ink: const Color(0xFF554D87),
                      onTap: onContractors,
                    ),
                  ),
                ],
              ),
              if (showJoinProvider || showJoinContractor) ...[
                const SizedBox(height: 25),
                const _SectionTitle(
                  title: 'انضم إلى شركاء بُنية',
                  caption: 'ابدأ نشاطك واستقبل الفرص من التطبيق',
                ),
                const SizedBox(height: 11),
                if (showJoinProvider && showJoinContractor)
                  Row(
                    children: [
                      Expanded(
                        child: _JoinAction(
                          icon: Icons.storefront_rounded,
                          title: 'انضم كمزود',
                          caption: 'منتجات وتسعير',
                          color: BunyaColors.copper,
                          onTap: onJoinProvider,
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: _JoinAction(
                          icon: Icons.engineering_rounded,
                          title: 'انضم كمقاول',
                          caption: 'مشاريع وفرص',
                          color: BunyaColors.forest,
                          onTap: onJoinContractor,
                        ),
                      ),
                    ],
                  )
                else if (showJoinProvider)
                  _JoinAction(
                    icon: Icons.storefront_rounded,
                    title: 'انضم كمزود',
                    caption: 'منتجات وتسعير',
                    color: BunyaColors.copper,
                    onTap: onJoinProvider,
                  )
                else
                  _JoinAction(
                    icon: Icons.engineering_rounded,
                    title: 'انضم كمقاول',
                    caption: 'مشاريع وفرص',
                    color: BunyaColors.forest,
                    onTap: onJoinContractor,
                  ),
              ],
              const SizedBox(height: 25),
              _SectionTitle(
                title: 'مختارات بُنية',
                caption: 'منتجات معتمدة وجاهزة للتسعير',
                action: 'عرض الكل',
                onAction: onCatalog,
              ),
            ],
          ),
        ),
        FutureBuilder<CatalogData>(
          future: catalog,
          builder: (context, snapshot) {
            if (snapshot.connectionState == ConnectionState.waiting) {
              return const SliverToBoxAdapter(child: _LoadingCards());
            }
            if (snapshot.hasError) {
              return SliverToBoxAdapter(child: _ErrorCard(onRetry: onRefresh));
            }
            final items =
                snapshot.data?.products.take(8).toList() ?? const <Product>[];
            return SliverToBoxAdapter(
              child: SizedBox(
                height: 326,
                child: ListView.separated(
                  padding: const EdgeInsets.fromLTRB(16, 4, 16, 18),
                  scrollDirection: Axis.horizontal,
                  reverse: false,
                  itemCount: items.length,
                  separatorBuilder: (_, _) => const SizedBox(width: 12),
                  itemBuilder: (_, i) => SizedBox(
                    width: 210,
                    child: ProductCard(
                      product: items[i],
                      onTap: () => onProduct(items[i]),
                    ),
                  ),
                ),
              ),
            );
          },
        ),
        const SliverPadding(padding: EdgeInsets.only(bottom: 24)),
      ],
    ),
  );
}

class _HeroCard extends StatelessWidget {
  const _HeroCard();
  @override
  Widget build(BuildContext context) => Container(
    height: 218,
    padding: const EdgeInsets.all(24),
    decoration: BoxDecoration(
      gradient: const LinearGradient(
        begin: Alignment.topRight,
        end: Alignment.bottomLeft,
        colors: [Color(0xFF16483B), Color(0xFF0D2F27)],
      ),
      borderRadius: BorderRadius.circular(30),
      boxShadow: const [
        BoxShadow(
          color: Color(0x33133D32),
          blurRadius: 30,
          offset: Offset(0, 16),
        ),
      ],
    ),
    child: Stack(
      children: [
        Positioned(
          left: -32,
          bottom: -58,
          child: Container(
            width: 178,
            height: 178,
            decoration: BoxDecoration(
              border: Border.all(
                color: Colors.white.withValues(alpha: .06),
                width: 26,
              ),
              borderRadius: BorderRadius.circular(52),
            ),
          ),
        ),
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Spacer(),
            Text(
              'اطلب احتياجك،\nونحن نجد السعر الأفضل.',
              style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                color: Colors.white,
                fontWeight: FontWeight.w900,
                height: 1.35,
              ),
            ),
            const SizedBox(height: 9),
            Text(
              'منافسة حقيقية بين الموردين حتى يصل لك العرض الأنسب.',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: Colors.white70,
                fontWeight: FontWeight.w700,
                height: 1.6,
              ),
            ),
          ],
        ),
      ],
    ),
  );
}

class _QuickAction extends StatelessWidget {
  const _QuickAction({
    required this.icon,
    required this.title,
    required this.tone,
    required this.ink,
    required this.onTap,
  });
  final IconData icon;
  final String title;
  final Color tone, ink;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => InkWell(
    onTap: onTap,
    borderRadius: BorderRadius.circular(21),
    child: Container(
      height: 110,
      padding: const EdgeInsets.all(12),
      decoration: _whiteCard(21),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: tone,
              borderRadius: BorderRadius.circular(15),
            ),
            child: Icon(icon, color: ink),
          ),
          const SizedBox(height: 9),
          Text(
            title,
            maxLines: 1,
            style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 12),
          ),
        ],
      ),
    ),
  );
}

class _JoinAction extends StatelessWidget {
  const _JoinAction({
    required this.icon,
    required this.title,
    required this.caption,
    required this.color,
    required this.onTap,
  });
  final IconData icon;
  final String title, caption;
  final Color color;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Material(
    color: color,
    borderRadius: BorderRadius.circular(22),
    child: InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(22),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: .14),
                borderRadius: BorderRadius.circular(15),
              ),
              child: Icon(icon, color: Colors.white),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 13,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  Text(
                    caption,
                    style: const TextStyle(
                      color: Colors.white70,
                      fontSize: 10,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    ),
  );
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle({
    required this.title,
    required this.caption,
    this.action,
    this.onAction,
  });
  final String title, caption;
  final String? action;
  final VoidCallback? onAction;
  @override
  Widget build(BuildContext context) => Row(
    crossAxisAlignment: CrossAxisAlignment.end,
    children: [
      Expanded(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              title,
              style: Theme.of(context).textTheme.titleLarge
                  ?.copyWith(fontWeight: FontWeight.w900),
            ),
            const SizedBox(height: 2),
            Text(
              caption,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: BunyaColors.muted,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
      ),
      if (action != null) TextButton(onPressed: onAction, child: Text(action!)),
    ],
  );
}

class CatalogTab extends StatefulWidget {
  const CatalogTab({
    super.key,
    required this.catalog,
    required this.onProduct,
    required this.onRefresh,
  });
  final Future<CatalogData> catalog;
  final ValueChanged<Product> onProduct;
  final VoidCallback onRefresh;
  @override
  State<CatalogTab> createState() => _CatalogTabState();
}

class _CatalogTabState extends State<CatalogTab> {
  final _searchController = TextEditingController();
  String query = '', category = 'الكل', region = 'كل المناطق';
  bool deliveryOnly = false;
  bool availableOnly = false;
  bool newOnly = false;
  bool filtersOpen = false;
  bool listView = true;
  bool sortByName = false;

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  List<String> _regions(CatalogData data) {
    final values = <String>{};
    for (final product in data.products) {
      values.addAll(
        product.regions
            .map((item) => item.city.trim())
            .where((item) => item.isNotEmpty),
      );
      values.addAll(
        product.delivery.regions
            .map((item) => item.trim())
            .where((item) => item.isNotEmpty),
      );
    }
    final extraRegions =
        values.where((item) => !_saudiRegions.contains(item)).toList()..sort();
    return [..._saudiRegions, ...extraRegions];
  }

  bool _isAvailable(Product product) =>
      product.availabilityStatus != 'حسب الطلب';

  void _resetFilters() {
    _searchController.clear();
    setState(() {
      query = '';
      category = 'الكل';
      region = 'كل المناطق';
      deliveryOnly = false;
      availableOnly = false;
      newOnly = false;
      sortByName = false;
    });
  }

  int get _filterCount =>
      (region == 'كل المناطق' ? 0 : 1) +
      (deliveryOnly ? 1 : 0) +
      (availableOnly ? 1 : 0) +
      (newOnly ? 1 : 0) +
      (sortByName ? 1 : 0);

  @override
  Widget build(BuildContext context) => FutureBuilder<CatalogData>(
    future: widget.catalog,
    builder: (context, snapshot) {
      if (snapshot.connectionState == ConnectionState.waiting) {
        return const Center(child: CircularProgressIndicator());
      }
      if (snapshot.hasError) return _ErrorCard(onRetry: widget.onRefresh);
      final data = snapshot.data!;
      final normalizedQuery = query.trim().toLowerCase();
      final filtered = data.products.where((product) {
        final productRegions = [
          ...product.regions.map((item) => item.city),
          ...product.delivery.regions,
        ];
        return (category == 'الكل' || product.category == category) &&
            (normalizedQuery.isEmpty ||
                '${product.name} ${product.category} ${product.description}'
                    .toLowerCase()
                    .contains(normalizedQuery)) &&
            (region == 'كل المناطق' || productRegions.contains(region)) &&
            (!deliveryOnly || product.delivery.available) &&
            (!availableOnly || _isAvailable(product)) &&
            (!newOnly || product.isNew);
      }).toList();
      if (sortByName) {
        filtered.sort((first, second) => first.name.compareTo(second.name));
      }
      final regions = _regions(data);

      return LayoutBuilder(
        builder: (context, constraints) {
          final wide = constraints.maxWidth >= 760;
          final horizontalPadding = constraints.maxWidth >= 1480
              ? (constraints.maxWidth - 1400) / 2
              : wide
              ? 24.0
              : 14.0;
          return ColoredBox(
            color: const Color(0xFFEDF7F1),
            child: CustomScrollView(
              key: const Key('catalog-scroll-view'),
              slivers: [
                SliverToBoxAdapter(
                  child: ColoredBox(
                    color: BunyaColors.surface,
                    child: Padding(
                      padding: EdgeInsets.fromLTRB(
                        horizontalPadding,
                        14,
                        horizontalPadding,
                        12,
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          _CatalogTitle(wide: wide),
                          SizedBox(height: wide ? 14 : 10),
                          TextField(
                            key: const Key('catalog-search-field'),
                            controller: _searchController,
                            onChanged: (value) => setState(() => query = value),
                            textInputAction: TextInputAction.search,
                            style: const TextStyle(
                              fontSize: 13,
                              fontWeight: FontWeight.w600,
                            ),
                            decoration: InputDecoration(
                              isDense: true,
                              constraints: const BoxConstraints(minHeight: 46),
                              contentPadding: const EdgeInsets.symmetric(
                                horizontal: 12,
                                vertical: 11,
                              ),
                              prefixIconConstraints: const BoxConstraints(
                                minWidth: 42,
                              ),
                              prefixIcon: const Icon(
                                Icons.search_rounded,
                                size: 20,
                              ),
                              hintText: 'ابحث عن أسمنت، حديد، بلوك أو عزل...',
                              hintStyle: const TextStyle(
                                color: Color(0xFF9A8E86),
                                fontSize: 12,
                                fontWeight: FontWeight.w500,
                              ),
                              suffixIcon: query.isEmpty
                                  ? null
                                  : IconButton(
                                      tooltip: 'مسح البحث',
                                      onPressed: () {
                                        _searchController.clear();
                                        setState(() => query = '');
                                      },
                                      icon: const Icon(Icons.close_rounded),
                                    ),
                            ),
                          ),
                          const SizedBox(height: 10),
                          SizedBox(
                            height: 45,
                            child: ListView.separated(
                              key: const Key('catalog-category-list'),
                              scrollDirection: Axis.horizontal,
                              itemCount: data.categories.length + 1,
                              separatorBuilder: (_, _) =>
                                  const SizedBox(width: 6),
                              itemBuilder: (_, i) {
                                final item = i == 0
                                    ? 'الكل'
                                    : data.categories[i - 1];
                                final active = item == category;
                                return ChoiceChip(
                                  label: Text(item),
                                  selected: active,
                                  onSelected: (_) =>
                                      setState(() => category = item),
                                  selectedColor: BunyaColors.forest,
                                  backgroundColor: Colors.transparent,
                                  showCheckmark: false,
                                  labelStyle: TextStyle(
                                    color: active
                                        ? Colors.white
                                        : BunyaColors.ink,
                                    fontSize: wide ? 12 : 10.8,
                                    fontWeight: FontWeight.w700,
                                  ),
                                  labelPadding: EdgeInsets.symmetric(
                                    horizontal: wide ? 6 : 3,
                                  ),
                                  visualDensity: VisualDensity.compact,
                                  side: BorderSide(
                                    color: active
                                        ? BunyaColors.forest
                                        : BunyaColors.line,
                                  ),
                                );
                              },
                            ),
                          ),
                          const SizedBox(height: 8),
                          SingleChildScrollView(
                            scrollDirection: Axis.horizontal,
                            child: Row(
                              children: [
                                _CatalogRegionMenu(
                                  regions: regions,
                                  value: region,
                                  onSelected: (value) =>
                                      setState(() => region = value),
                                ),
                                const SizedBox(width: 7),
                                _CatalogToolButton(
                                  key: const Key('catalog-filter-button'),
                                  icon: Icons.tune_rounded,
                                  label: 'تصفية',
                                  active: filtersOpen,
                                  count: _filterCount,
                                  onPressed: () => setState(
                                    () => filtersOpen = !filtersOpen,
                                  ),
                                ),
                                const SizedBox(width: 7),
                                _CatalogToolButton(
                                  icon: Icons.local_shipping_outlined,
                                  label: wide ? 'يوصل للموقع' : 'توصيل',
                                  active: deliveryOnly,
                                  onPressed: () => setState(
                                    () => deliveryOnly = !deliveryOnly,
                                  ),
                                ),
                                const SizedBox(width: 7),
                                _CatalogViewToggle(
                                  compact: !wide,
                                  listView: listView,
                                  onChanged: (value) =>
                                      setState(() => listView = value),
                                ),
                              ],
                            ),
                          ),
                          if (filtersOpen) ...[
                            const SizedBox(height: 10),
                            _CatalogFilterPanel(
                              availableOnly: availableOnly,
                              newOnly: newOnly,
                              sortByName: sortByName,
                              onAvailableChanged: () => setState(
                                () => availableOnly = !availableOnly,
                              ),
                              onNewChanged: () =>
                                  setState(() => newOnly = !newOnly),
                              onSortChanged: (value) =>
                                  setState(() => sortByName = value),
                              onReset: _resetFilters,
                            ),
                          ],
                        ],
                      ),
                    ),
                  ),
                ),
                SliverPadding(
                  padding: EdgeInsets.fromLTRB(
                    horizontalPadding,
                    16,
                    horizontalPadding,
                    10,
                  ),
                  sliver: SliverToBoxAdapter(
                    child: Row(
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text(
                                'كتالوج بُنية',
                                style: TextStyle(
                                  color: BunyaColors.copper,
                                  fontSize: 9.5,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                              Text(
                                'المنتجات المطابقة',
                                style: Theme.of(context).textTheme.titleLarge
                                    ?.copyWith(
                                      fontSize: wide ? 21 : 18,
                                      fontWeight: FontWeight.w800,
                                      height: 1.25,
                                    ),
                              ),
                            ],
                          ),
                        ),
                        Semantics(
                          liveRegion: true,
                          label: '${filtered.length} منتج',
                          excludeSemantics: true,
                          child: Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 12,
                              vertical: 7,
                            ),
                            decoration: BoxDecoration(
                              color: Colors.white,
                              border: Border.all(color: BunyaColors.line),
                              borderRadius: BorderRadius.circular(30),
                            ),
                            child: Text(
                              '${filtered.length} منتج',
                              style: const TextStyle(
                                color: BunyaColors.forest,
                                fontSize: 10,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                if (filtered.isEmpty)
                  SliverPadding(
                    padding: EdgeInsets.fromLTRB(
                      horizontalPadding,
                      0,
                      horizontalPadding,
                      24,
                    ),
                    sliver: SliverFillRemaining(
                      hasScrollBody: false,
                      child: _CatalogEmpty(onReset: _resetFilters),
                    ),
                  )
                else
                  SliverPadding(
                    padding: EdgeInsets.fromLTRB(
                      horizontalPadding,
                      0,
                      horizontalPadding,
                      28,
                    ),
                    sliver: SliverGrid.builder(
                      key: Key(listView ? 'catalog-list' : 'catalog-grid'),
                      gridDelegate: SliverGridDelegateWithMaxCrossAxisExtent(
                        maxCrossAxisExtent: listView ? 1600 : 330,
                        mainAxisExtent: listView ? 146 : 288,
                        crossAxisSpacing: 12,
                        mainAxisSpacing: 12,
                      ),
                      itemCount: filtered.length,
                      itemBuilder: (_, i) => listView
                          ? ProductListCard(
                              product: filtered[i],
                              onTap: () => widget.onProduct(filtered[i]),
                            )
                          : ProductCard(
                              product: filtered[i],
                              onTap: () => widget.onProduct(filtered[i]),
                            ),
                    ),
                  ),
              ],
            ),
          );
        },
      );
    },
  );
}

class _CatalogTitle extends StatelessWidget {
  const _CatalogTitle({required this.wide});
  final bool wide;

  @override
  Widget build(BuildContext context) => Row(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Expanded(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'سوق مواد البناء',
              style: TextStyle(
                color: BunyaColors.copper,
                fontSize: 10,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              'كل احتياج مشروعك، في بحث واحد',
              style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                color: BunyaColors.ink,
                fontSize: wide ? 25 : 20,
                fontWeight: FontWeight.w800,
                height: 1.3,
                letterSpacing: -0.2,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              wide
                  ? 'اختر المواد واجمعها ثم أرسل طلبًا واحدًا لأفضل عرض.'
                  : 'ابحث، اختر، واجمع احتياجك في طلب سعر واحد.',
              style: const TextStyle(
                color: BunyaColors.muted,
                fontSize: 10.5,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ),
      ),
      Container(
        width: wide ? 44 : 40,
        height: wide ? 44 : 40,
        decoration: BoxDecoration(
          color: BunyaColors.mint,
          borderRadius: BorderRadius.circular(12),
        ),
        child: const Icon(
          Icons.inventory_2_outlined,
          color: BunyaColors.forest,
          size: 21,
        ),
      ),
    ],
  );
}

class _CatalogToolButton extends StatelessWidget {
  const _CatalogToolButton({
    super.key,
    required this.icon,
    required this.label,
    required this.active,
    required this.onPressed,
    this.count = 0,
  });
  final IconData icon;
  final String label;
  final bool active;
  final VoidCallback onPressed;
  final int count;

  @override
  Widget build(BuildContext context) => SizedBox(
    height: 44,
    child: OutlinedButton.icon(
      onPressed: onPressed,
      style: OutlinedButton.styleFrom(
        foregroundColor: active ? BunyaColors.forest : BunyaColors.muted,
        backgroundColor: active ? BunyaColors.mint : Colors.white,
        minimumSize: const Size(0, 44),
        side: BorderSide(
          color: active ? const Color(0xFF91C7B2) : BunyaColors.line,
        ),
        padding: const EdgeInsets.symmetric(horizontal: 9),
        textStyle: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
      icon: Icon(icon, size: 16),
      label: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(label),
          if (count > 0) ...[
            const SizedBox(width: 5),
            Container(
              constraints: const BoxConstraints(minWidth: 20, minHeight: 20),
              alignment: Alignment.center,
              padding: const EdgeInsets.symmetric(horizontal: 5),
              decoration: const BoxDecoration(
                color: BunyaColors.copper,
                shape: BoxShape.circle,
              ),
              child: Text(
                '$count',
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 8.5,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ],
        ],
      ),
    ),
  );
}

class _CatalogRegionMenu extends StatelessWidget {
  const _CatalogRegionMenu({
    required this.regions,
    required this.value,
    required this.onSelected,
  });
  final List<String> regions;
  final String value;
  final ValueChanged<String> onSelected;

  @override
  Widget build(BuildContext context) => PopupMenuButton<String>(
    key: const Key('catalog-region-menu'),
    tooltip: 'منطقة التوفر',
    initialValue: value,
    onSelected: onSelected,
    itemBuilder: (_) => [
      const PopupMenuItem(value: 'كل المناطق', child: Text('كل المناطق')),
      ...regions.map((item) => PopupMenuItem(value: item, child: Text(item))),
    ],
    child: Container(
      height: 44,
      padding: const EdgeInsets.symmetric(horizontal: 8),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: BunyaColors.line),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(
            Icons.location_on_outlined,
            size: 16,
            color: BunyaColors.forest,
          ),
          const SizedBox(width: 6),
          Text(
            value,
            style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700),
          ),
          const SizedBox(width: 4),
          const Icon(Icons.expand_more_rounded, size: 16),
        ],
      ),
    ),
  );
}

class _CatalogViewToggle extends StatelessWidget {
  const _CatalogViewToggle({
    required this.compact,
    required this.listView,
    required this.onChanged,
  });
  final bool compact;
  final bool listView;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    final buttons = compact
        ? <Widget>[
            _CatalogViewButton(
              key: const Key('catalog-view-toggle'),
              tooltip: listView
                  ? 'التبديل إلى عرض شبكي'
                  : 'التبديل إلى عرض قائمة',
              icon: listView
                  ? Icons.view_list_rounded
                  : Icons.grid_view_rounded,
              active: true,
              onTap: () => onChanged(!listView),
            ),
          ]
        : <Widget>[
            _CatalogViewButton(
              key: const Key('catalog-grid-button'),
              tooltip: 'عرض شبكي',
              icon: Icons.grid_view_rounded,
              active: !listView,
              onTap: () => onChanged(false),
            ),
            _CatalogViewButton(
              key: const Key('catalog-list-button'),
              tooltip: 'عرض قائمة',
              icon: Icons.view_list_rounded,
              active: listView,
              onTap: () => onChanged(true),
            ),
          ];
    return Container(
      height: 44,
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: BunyaColors.line),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(children: buttons),
    );
  }
}

class _CatalogViewButton extends StatelessWidget {
  const _CatalogViewButton({
    super.key,
    required this.tooltip,
    required this.icon,
    required this.active,
    required this.onTap,
  });
  final String tooltip;
  final IconData icon;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Tooltip(
    message: tooltip,
    excludeFromSemantics: true,
    child: Semantics(
      button: true,
      selected: active,
      label: tooltip,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(9),
        child: Container(
          width: 44,
          height: 44,
          decoration: BoxDecoration(
            color: active ? BunyaColors.forest : Colors.transparent,
            borderRadius: BorderRadius.circular(9),
          ),
          child: Icon(
            icon,
            size: 18,
            color: active ? Colors.white : BunyaColors.muted,
          ),
        ),
      ),
    ),
  );
}

class _CatalogFilterPanel extends StatelessWidget {
  const _CatalogFilterPanel({
    required this.availableOnly,
    required this.newOnly,
    required this.sortByName,
    required this.onAvailableChanged,
    required this.onNewChanged,
    required this.onSortChanged,
    required this.onReset,
  });
  final bool availableOnly, newOnly, sortByName;
  final VoidCallback onAvailableChanged, onNewChanged, onReset;
  final ValueChanged<bool> onSortChanged;

  @override
  Widget build(BuildContext context) => Container(
    width: double.infinity,
    padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(
      color: BunyaColors.sand,
      border: Border.all(color: BunyaColors.line),
      borderRadius: BorderRadius.circular(15),
    ),
    child: Wrap(
      spacing: 8,
      runSpacing: 8,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        FilterChip(
          label: const Text('متوفر الآن'),
          selected: availableOnly,
          onSelected: (_) => onAvailableChanged(),
          labelStyle: const TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w700,
          ),
          visualDensity: VisualDensity.compact,
        ),
        FilterChip(
          label: const Text('وصل حديثًا'),
          selected: newOnly,
          onSelected: (_) => onNewChanged(),
          labelStyle: const TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w700,
          ),
          visualDensity: VisualDensity.compact,
        ),
        FilterChip(
          label: const Text('ترتيب حسب الاسم'),
          selected: sortByName,
          onSelected: onSortChanged,
          labelStyle: const TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w700,
          ),
          visualDensity: VisualDensity.compact,
        ),
        TextButton.icon(
          onPressed: onReset,
          style: TextButton.styleFrom(
            textStyle: const TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w700,
            ),
          ),
          icon: const Icon(Icons.restart_alt_rounded, size: 18),
          label: const Text('إعادة الضبط'),
        ),
      ],
    ),
  );
}

class _CatalogEmpty extends StatelessWidget {
  const _CatalogEmpty({required this.onReset});
  final VoidCallback onReset;

  @override
  Widget build(BuildContext context) => Center(
    child: Container(
      width: double.infinity,
      constraints: const BoxConstraints(maxWidth: 760, minHeight: 300),
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: BunyaColors.surface,
        border: Border.all(color: const Color(0xFFB9C9BF)),
        borderRadius: BorderRadius.circular(22),
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Container(
            width: 64,
            height: 64,
            decoration: const BoxDecoration(
              color: BunyaColors.mint,
              shape: BoxShape.circle,
            ),
            child: const Icon(
              Icons.inventory_2_outlined,
              color: BunyaColors.forest,
              size: 30,
            ),
          ),
          const SizedBox(height: 14),
          const Text(
            'لا توجد منتجات مطابقة',
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 5),
          const Text(
            'جرّب كلمة بحث أخرى أو أزل بعض عوامل التصفية.',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: BunyaColors.muted,
              fontSize: 11.5,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 12),
          OutlinedButton(
            onPressed: onReset,
            child: const Text('مسح عوامل التصفية'),
          ),
        ],
      ),
    ),
  );
}

class ProductCard extends StatelessWidget {
  const ProductCard({super.key, required this.product, required this.onTap});
  final Product product;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => Material(
    color: Colors.transparent,
    child: InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(22),
      child: Container(
        decoration: _whiteCard(22),
        clipBehavior: Clip.antiAlias,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Stack(
                fit: StackFit.expand,
                children: [
                  ProductVisual(product: product),
                  if (product.isNew)
                    Positioned(
                      top: 10,
                      right: 10,
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 9,
                          vertical: 5,
                        ),
                        decoration: BoxDecoration(
                          color: BunyaColors.copper,
                          borderRadius: BorderRadius.circular(20),
                        ),
                        child: const Text(
                          'جديد',
                          style: TextStyle(
                            color: Colors.white,
                            fontSize: 9,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(13, 11, 13, 13),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          product.category,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: BunyaColors.copper,
                            fontSize: 9.5,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 7,
                          vertical: 3,
                        ),
                        decoration: BoxDecoration(
                          color: BunyaColors.mint,
                          borderRadius: BorderRadius.circular(20),
                        ),
                        child: Text(
                          product.availabilityStatus,
                          style: const TextStyle(
                            color: BunyaColors.forest,
                            fontSize: 8,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(
                    product.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w800,
                      height: 1.35,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    product.shortDescription.isEmpty
                        ? product.description
                        : product.shortDescription,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: BunyaColors.muted,
                      fontSize: 9,
                      height: 1.5,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                  const SizedBox(height: 7),
                  Row(
                    children: [
                      const Icon(
                        Icons.inventory_2_outlined,
                        size: 13,
                        color: BunyaColors.copper,
                      ),
                      const SizedBox(width: 4),
                      Expanded(
                        child: Text(
                          product.unit,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: BunyaColors.muted,
                            fontSize: 9,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                      const Icon(
                        Icons.local_shipping_outlined,
                        size: 13,
                        color: BunyaColors.copper,
                      ),
                      const SizedBox(width: 4),
                      Flexible(
                        child: Text(
                          product.deliveryWindow,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: BunyaColors.muted,
                            fontSize: 9,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                      const SizedBox(width: 4),
                      const Icon(
                        Icons.arrow_back_rounded,
                        size: 16,
                        color: BunyaColors.copper,
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    ),
  );
}

class ProductListCard extends StatelessWidget {
  const ProductListCard({
    super.key,
    required this.product,
    required this.onTap,
  });
  final Product product;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Material(
    color: Colors.transparent,
    child: InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(18),
      child: Container(
        decoration: _whiteCard(18),
        clipBehavior: Clip.antiAlias,
        child: Row(
          children: [
            SizedBox(
              width: MediaQuery.sizeOf(context).width < 430 ? 112 : 150,
              height: double.infinity,
              child: Stack(
                fit: StackFit.expand,
                children: [
                  ProductVisual(product: product),
                  if (product.isNew)
                    Positioned(
                      top: 9,
                      right: 9,
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 8,
                          vertical: 4,
                        ),
                        decoration: BoxDecoration(
                          color: BunyaColors.copper,
                          borderRadius: BorderRadius.circular(20),
                        ),
                        child: const Text(
                          'جديد',
                          style: TextStyle(
                            color: Colors.white,
                            fontSize: 9,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            ),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(13, 12, 13, 12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            product.category,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: BunyaColors.copper,
                              fontSize: 9,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 7,
                            vertical: 3,
                          ),
                          decoration: BoxDecoration(
                            color: BunyaColors.mint,
                            borderRadius: BorderRadius.circular(20),
                          ),
                          child: Text(
                            product.availabilityStatus,
                            style: const TextStyle(
                              color: BunyaColors.forest,
                              fontSize: 8,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text(
                      product.name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Expanded(
                      child: Text(
                        product.shortDescription.isEmpty
                            ? product.description
                            : product.shortDescription,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: BunyaColors.muted,
                          fontSize: 9.5,
                          height: 1.5,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ),
                    Row(
                      children: [
                        const Icon(
                          Icons.inventory_2_outlined,
                          size: 13,
                          color: BunyaColors.copper,
                        ),
                        const SizedBox(width: 4),
                        Flexible(
                          child: Text(
                            product.unit,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: BunyaColors.muted,
                              fontSize: 8.5,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                        const SizedBox(width: 10),
                        const Icon(
                          Icons.local_shipping_outlined,
                          size: 13,
                          color: BunyaColors.copper,
                        ),
                        const SizedBox(width: 4),
                        Flexible(
                          child: Text(
                            product.deliveryWindow,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: BunyaColors.muted,
                              fontSize: 8.5,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                        const Spacer(),
                        const Icon(
                          Icons.arrow_back_rounded,
                          size: 18,
                          color: BunyaColors.copper,
                        ),
                      ],
                    ),
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

class _ProductVariantGroup {
  const _ProductVariantGroup({
    required this.key,
    required this.label,
    required this.options,
  });

  final String key, label;
  final List<ProductVariantOption> options;
}

List<_ProductVariantGroup> _groupProductVariants(Product product) {
  final groups = <String, _ProductVariantGroup>{};
  for (final variant in product.variants) {
    final attributes = variant.attributes.entries
        .where(
          (attribute) =>
              attribute.key.trim().isNotEmpty &&
              attribute.value.trim().isNotEmpty,
        )
        .toList();
    final key = attributes.length == 1
        ? attributes.first.key.trim()
        : '__variant__';
    final label = attributes.length == 1
        ? attributes.first.key.trim()
        : 'الخيار';
    final current = groups[key];
    groups[key] = _ProductVariantGroup(
      key: key,
      label: label,
      options: [...?current?.options, variant],
    );
  }
  return groups.values.toList();
}

String _variantOptionLabel(ProductVariantOption variant, String groupKey) {
  if (groupKey != '__variant__') {
    final value = variant.attributes[groupKey]?.trim() ?? '';
    if (value.isNotEmpty) return value;
  }
  if (variant.attributes.isNotEmpty) {
    return variant.attributes.entries
        .map((attribute) => '${attribute.key}: ${attribute.value}')
        .join(' · ');
  }
  return variant.name;
}

class QuoteComposer extends StatefulWidget {
  const QuoteComposer({super.key, required this.product});
  final Product product;
  @override
  State<QuoteComposer> createState() => _QuoteComposerState();
}

class _QuoteComposerState extends State<QuoteComposer> {
  final quantity = TextEditingController(text: '1'),
      notes = TextEditingController();
  ProductMeasurementOption? selectedMeasurement;
  final Map<String, String> selectedVariantIds = {};
  late final List<_ProductVariantGroup> variantGroups;

  @override
  void initState() {
    super.initState();
    for (final measurement in widget.product.measurements) {
      if (measurement.isDefault) {
        selectedMeasurement = measurement;
        break;
      }
    }
    if (selectedMeasurement == null && widget.product.measurements.isNotEmpty) {
      selectedMeasurement = widget.product.measurements.first;
    }
    variantGroups = _groupProductVariants(widget.product);
    for (final group in variantGroups) {
      if (group.options.isNotEmpty) {
        selectedVariantIds[group.key] = group.options.first.id;
      }
    }
  }

  @override
  void dispose() {
    quantity.dispose();
    notes.dispose();
    super.dispose();
  }

  void submit() {
    final amount = double.tryParse(quantity.text.trim());
    if (amount == null || amount <= 0) {
      _message(context, 'أدخل كمية صحيحة أكبر من صفر');
      return;
    }
    if (widget.product.measurements.isNotEmpty && selectedMeasurement == null) {
      _message(context, 'اختر القياس المطلوب');
      return;
    }
    if (variantGroups.any((group) => selectedVariantIds[group.key] == null)) {
      _message(context, 'اختر جميع الخيارات المطلوبة');
      return;
    }
    final selectedVariants = widget.product.variants
        .where((variant) => selectedVariantIds.values.contains(variant.id))
        .toList();
    Navigator.pop(
      context,
      MobileQuoteItem(
        product: widget.product,
        quantity: amount,
        measurement: selectedMeasurement,
        selectedVariants: selectedVariants,
        notes: notes.text.trim(),
      ),
    );
  }

  @override
  Widget build(BuildContext context) => Padding(
    padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
    child: Container(
      decoration: const BoxDecoration(
        color: BunyaColors.surface,
        borderRadius: BorderRadius.vertical(top: Radius.circular(30)),
      ),
      child: SafeArea(
        top: false,
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 22),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  width: 44,
                  height: 5,
                  margin: const EdgeInsets.only(bottom: 18),
                  decoration: BoxDecoration(
                    color: BunyaColors.line,
                    borderRadius: BorderRadius.circular(20),
                  ),
                ),
              ),
              const Text(
                'إضافة إلى طلب السعر',
                style: TextStyle(fontSize: 22, fontWeight: FontWeight.w900),
              ),
              Text(
                widget.product.name,
                style: const TextStyle(
                  color: BunyaColors.copper,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 17),
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: quantity,
                      keyboardType: const TextInputType.numberWithOptions(
                        decimal: true,
                      ),
                      decoration: const InputDecoration(labelText: 'الكمية'),
                    ),
                  ),
                  const SizedBox(width: 10),
                  SizedBox(
                    width: 110,
                    child: InputDecorator(
                      decoration: const InputDecoration(labelText: 'الوحدة'),
                      child: Text(
                        selectedMeasurement?.unit ?? widget.product.unit,
                        style: const TextStyle(fontWeight: FontWeight.w900),
                      ),
                    ),
                  ),
                ],
              ),
              if (widget.product.measurements.isNotEmpty) ...[
                const SizedBox(height: 11),
                DropdownButtonFormField<String>(
                  initialValue: selectedMeasurement?.id,
                  decoration: const InputDecoration(labelText: 'القياس'),
                  isExpanded: true,
                  items: widget.product.measurements
                      .map(
                        (measurement) => DropdownMenuItem(
                          value: measurement.id,
                          child: Text(measurement.label),
                        ),
                      )
                      .toList(),
                  onChanged: (id) => setState(() {
                    for (final measurement in widget.product.measurements) {
                      if (measurement.id == id) {
                        selectedMeasurement = measurement;
                        break;
                      }
                    }
                  }),
                ),
              ],
              for (final group in variantGroups) ...[
                const SizedBox(height: 11),
                DropdownButtonFormField<String>(
                  initialValue: selectedVariantIds[group.key],
                  decoration: InputDecoration(labelText: group.label),
                  isExpanded: true,
                  items: group.options
                      .map(
                        (variant) => DropdownMenuItem(
                          value: variant.id,
                          child: Text(_variantOptionLabel(variant, group.key)),
                        ),
                      )
                      .toList(),
                  onChanged: (id) => setState(() {
                    if (id != null) selectedVariantIds[group.key] = id;
                  }),
                ),
              ],
              const SizedBox(height: 11),
              TextField(
                controller: notes,
                minLines: 2,
                maxLines: 4,
                decoration: const InputDecoration(
                  labelText: 'ملاحظات اختيارية',
                ),
              ),
              const SizedBox(height: 12),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(13),
                decoration: BoxDecoration(
                  color: const Color(0xFFFFF5E8),
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: const Color(0xFFE5C8AE)),
                ),
                child: const Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(Icons.location_on_outlined, color: BunyaColors.copper),
                    SizedBox(width: 9),
                    Expanded(
                      child: Text(
                        'بعد تجميع المنتجات ستضيف رابط Google Maps وبيانات المستلم والوصول والإقرارات مرة واحدة للطلب كاملًا.',
                        style: TextStyle(
                          color: BunyaColors.muted,
                          height: 1.6,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              FilledButton.icon(
                onPressed: submit,
                icon: const Icon(Icons.add_shopping_cart_rounded),
                label: const Text('إضافة ومتابعة تجميع المنتجات'),
              ),
            ],
          ),
        ),
      ),
    ),
  );
}

class QuoteRequestReviewSheet extends StatefulWidget {
  const QuoteRequestReviewSheet({
    super.key,
    required this.repository,
    required this.items,
    required this.onRemove,
  });

  final BunyaRepository repository;
  final List<MobileQuoteItem> items;
  final ValueChanged<String> onRemove;

  @override
  State<QuoteRequestReviewSheet> createState() =>
      _QuoteRequestReviewSheetState();
}

class _QuoteRequestReviewSheetState extends State<QuoteRequestReviewSheet> {
  final mapsUrl = TextEditingController(),
      locationHint = TextEditingController(),
      projectName = TextEditingController(),
      recipientName = TextEditingController(),
      recipientMobile = TextEditingController(),
      responsibleName = TextEditingController(),
      responsibleMobile = TextEditingController(),
      contractorName = TextEditingController(),
      contractorMobile = TextEditingController(),
      accessInstructions = TextEditingController(),
      notes = TextEditingController();
  late final List<MobileQuoteItem> items = List.of(widget.items);
  DateTime requiredAt = DateTime.now().add(const Duration(days: 2));
  TimeOfDay receptionStartsAt = const TimeOfDay(hour: 7, minute: 0);
  TimeOfDay receptionEndsAt = const TimeOfDay(hour: 16, minute: 0);
  bool delivery = true, driverAck = false, dataAck = false, busy = false;
  String loadingOption = '', unloadingOption = '', roadAccess = '';
  String? formError;

  static const loadingOptions = [
    'التحميل ضمن مسؤولية المزود',
    'العميل يوفّر معدات التحميل',
    'يلزم تنسيق رافعة أو فوركلفت',
  ];
  static const unloadingOptions = [
    'العميل يوفّر عمال التنزيل',
    'العميل يوفّر رافعة أو فوركلفت',
    'مطلوب تضمين التنزيل في العرض',
    'لا يلزم تنزيل - استلام مباشر',
  ];
  static const roadOptions = [
    'سهل ومناسب للشاحنات الكبيرة',
    'مناسب للشاحنات الصغيرة فقط',
    'دخول مقيد ويحتاج تنسيقًا مسبقًا',
    'طريق غير ممهد أو تحت الإنشاء',
  ];

  @override
  void initState() {
    super.initState();
    unawaited(_prefillProfile());
  }

  Future<void> _prefillProfile() async {
    final profile = await widget.repository.loadProfile();
    if (!mounted || profile == null) return;
    setState(() {
      recipientName.text = profile.name;
      recipientMobile.text = profile.mobile;
      responsibleName.text = profile.name;
      responsibleMobile.text = profile.mobile;
    });
  }

  @override
  void dispose() {
    for (final controller in [
      mapsUrl,
      locationHint,
      projectName,
      recipientName,
      recipientMobile,
      responsibleName,
      responsibleMobile,
      contractorName,
      contractorMobile,
      accessInstructions,
      notes,
    ]) {
      controller.dispose();
    }
    super.dispose();
  }

  bool get validMapsUrl {
    final uri = Uri.tryParse(mapsUrl.text.trim());
    if (uri == null || !{'http', 'https'}.contains(uri.scheme)) return false;
    final host = uri.host.toLowerCase();
    return host == 'maps.app.goo.gl' ||
        host == 'goo.gl' ||
        host.startsWith('maps.google.') ||
        (host.endsWith('google.com') && uri.path.contains('/maps'));
  }

  String _timeValue(TimeOfDay value) =>
      '${value.hour.toString().padLeft(2, '0')}:${value.minute.toString().padLeft(2, '0')}';

  int _minutes(TimeOfDay value) => value.hour * 60 + value.minute;

  String get workingHoursValue =>
      'من ${_timeValue(receptionStartsAt)} إلى ${_timeValue(receptionEndsAt)}';

  Future<void> _pickRequiredDate() async {
    final date = await showDatePicker(
      context: context,
      firstDate: DateTime.now(),
      lastDate: DateTime.now().add(const Duration(days: 180)),
      initialDate: requiredAt,
      helpText: 'اختر تاريخ الاستلام',
      cancelText: 'إلغاء',
      confirmText: 'اعتماد التاريخ',
    );
    if (date == null || !mounted) return;
    setState(() {
      requiredAt = DateTime(
        date.year,
        date.month,
        date.day,
        requiredAt.hour,
        requiredAt.minute,
      );
      formError = null;
    });
  }

  Future<void> _pickRequiredTime() async {
    final time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(requiredAt),
      helpText: 'اختر ساعة الاستلام',
      cancelText: 'إلغاء',
      confirmText: 'اعتماد الساعة',
    );
    if (time == null || !mounted) return;
    setState(() {
      requiredAt = DateTime(
        requiredAt.year,
        requiredAt.month,
        requiredAt.day,
        time.hour,
        time.minute,
      );
      formError = null;
    });
  }

  Future<void> _pickReceptionTime({required bool start}) async {
    final time = await showTimePicker(
      context: context,
      initialTime: start ? receptionStartsAt : receptionEndsAt,
      helpText: start ? 'بداية استقبال الموقع' : 'نهاية استقبال الموقع',
      cancelText: 'إلغاء',
      confirmText: 'اعتماد الساعة',
    );
    if (time == null || !mounted) return;
    setState(() {
      if (start) {
        receptionStartsAt = time;
      } else {
        receptionEndsAt = time;
      }
      formError = null;
    });
  }

  String? validate() {
    if (items.isEmpty) return 'أضف منتجًا واحدًا على الأقل';
    if (!validMapsUrl) return 'ألصق رابط Google Maps صحيحًا لمكان التسليم';
    if (locationHint.text.trim().length < 3) {
      return 'اكتب وصفًا واضحًا لمكان التسليم';
    }
    if (recipientName.text.trim().length < 2 ||
        recipientMobile.text.replaceAll(RegExp(r'\D'), '').length < 9) {
      return 'أكمل اسم المستلم ورقم جواله';
    }
    if (responsibleName.text.trim().length < 2 ||
        responsibleMobile.text.replaceAll(RegExp(r'\D'), '').length < 9) {
      return 'أكمل اسم مسؤول الموقع ورقم جواله';
    }
    if ((contractorName.text.trim().isEmpty) !=
        (contractorMobile.text.trim().isEmpty)) {
      return 'أكمل اسم المقاول ورقم جواله معًا أو اتركهما فارغين';
    }
    if (!requiredAt.isAfter(DateTime.now().add(const Duration(hours: 2)))) {
      return 'اختر موعد استلام بعد أكثر من ساعتين';
    }
    if (_minutes(receptionEndsAt) <= _minutes(receptionStartsAt)) {
      return 'ساعة نهاية الاستلام يجب أن تكون بعد ساعة البداية';
    }
    if (loadingOption.isEmpty || unloadingOption.isEmpty) {
      return 'حدد مسؤولية التحميل وخيار التنزيل';
    }
    if (roadAccess.isEmpty || accessInstructions.text.trim().length < 3) {
      return 'حدد سهولة الطريق واكتب تعليمات الوصول';
    }
    if (!driverAck || !dataAck) return 'وافق على الإقرارين قبل اعتماد الطلب';
    return null;
  }

  Future<void> submit() async {
    final error = validate();
    if (error != null) {
      setState(() => formError = error);
      return;
    }
    setState(() {
      busy = true;
      formError = null;
    });
    try {
      final submissionMessage = await widget.repository.submitQuote(
        items: items,
        details: QuoteSubmissionDetails(
          mapsUrl: mapsUrl.text,
          locationHint: locationHint.text,
          requiredAt: requiredAt,
          delivery: delivery,
          projectName: projectName.text,
          recipientName: recipientName.text,
          recipientMobile: recipientMobile.text,
          siteResponsibleName: responsibleName.text,
          siteResponsibleMobile: responsibleMobile.text,
          contractorName: contractorName.text,
          contractorMobile: contractorMobile.text,
          workingHours: workingHoursValue,
          loadingOption: loadingOption,
          unloadingOption: unloadingOption,
          roadAccess: roadAccess,
          accessInstructions: accessInstructions.text,
          notes: notes.text,
        ),
      );
      if (mounted && submissionMessage.contains('خلال 24 ساعة')) {
        await showDialog<void>(
          context: context,
          builder: (dialogContext) => AlertDialog(
            title: const Text('تم استلام طلبك'),
            content: Text(submissionMessage),
            actions: [
              FilledButton(
                onPressed: () => Navigator.pop(dialogContext),
                child: const Text('حسنًا'),
              ),
            ],
          ),
        );
      }
      if (mounted) Navigator.pop(context, true);
    } catch (error) {
      if (mounted) setState(() => formError = _friendlyError(error));
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Widget field(
    String label,
    TextEditingController controller, {
    TextInputType? keyboard,
    String? hint,
    int lines = 1,
  }) => Padding(
    padding: const EdgeInsets.only(bottom: 11),
    child: TextField(
      controller: controller,
      keyboardType: keyboard,
      minLines: lines,
      maxLines: lines == 1 ? 1 : lines + 1,
      decoration: InputDecoration(labelText: label, hintText: hint),
    ),
  );

  Widget choice(
    String label,
    String value,
    List<String> options,
    ValueChanged<String> onChanged,
  ) => Padding(
    padding: const EdgeInsets.only(bottom: 11),
    child: DropdownButtonFormField<String>(
      initialValue: value.isEmpty ? null : value,
      decoration: InputDecoration(labelText: label),
      isExpanded: true,
      items: options
          .map((option) => DropdownMenuItem(value: option, child: Text(option)))
          .toList(),
      onChanged: (next) => next == null ? null : onChanged(next),
    ),
  );

  @override
  Widget build(BuildContext context) => SafeArea(
    top: false,
    child: Container(
      height: MediaQuery.sizeOf(context).height * .96,
      decoration: const BoxDecoration(
        color: BunyaColors.surface,
        borderRadius: BorderRadius.vertical(top: Radius.circular(30)),
      ),
      child: Column(
        children: [
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(18, 10, 18, 28),
              children: [
                Center(
                  child: Container(
                    width: 44,
                    height: 5,
                    margin: const EdgeInsets.only(bottom: 16),
                    decoration: BoxDecoration(
                      color: BunyaColors.line,
                      borderRadius: BorderRadius.circular(20),
                    ),
                  ),
                ),
                Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'مراجعة طلب عرض السعر',
                            style: TextStyle(
                              fontSize: 22,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                          Text(
                            '${items.length} منتجات · أكمل بيانات التسليم قبل الاعتماد',
                            style: const TextStyle(
                              color: BunyaColors.muted,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ],
                      ),
                    ),
                    IconButton(
                      tooltip: 'إغلاق',
                      onPressed: () => Navigator.pop(context),
                      icon: const Icon(Icons.close_rounded),
                    ),
                  ],
                ),
                const SizedBox(height: 18),
                const _QuoteReviewHeading(
                  icon: Icons.inventory_2_outlined,
                  title: 'المنتجات المجمعة',
                ),
                const SizedBox(height: 9),
                ...items.map(
                  (item) => Container(
                    margin: const EdgeInsets.only(bottom: 8),
                    padding: const EdgeInsets.all(13),
                    decoration: _whiteCard(17),
                    child: Row(
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                item.product.name,
                                style: const TextStyle(
                                  fontWeight: FontWeight.w900,
                                ),
                              ),
                              Text(
                                '${item.quantity} ${item.unit} · ${item.measurementLabel}',
                                style: const TextStyle(
                                  color: BunyaColors.muted,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                              if (item.variantLabel.isNotEmpty)
                                Text(
                                  item.variantLabel,
                                  style: const TextStyle(
                                    color: BunyaColors.copper,
                                    fontWeight: FontWeight.w800,
                                  ),
                                ),
                            ],
                          ),
                        ),
                        IconButton(
                          tooltip: 'حذف المنتج',
                          onPressed: () {
                            widget.onRemove(item.selectionKey);
                            setState(() => items.remove(item));
                          },
                          icon: const Icon(
                            Icons.delete_outline_rounded,
                            color: Color(0xFFB42318),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 14),
                const _QuoteReviewHeading(
                  icon: Icons.location_on_outlined,
                  title: 'موقع التسليم',
                ),
                const SizedBox(height: 9),
                Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: const Color(0xFFFFF5E8),
                    borderRadius: BorderRadius.circular(18),
                    border: Border.all(color: BunyaColors.copper),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'رابط Google Maps هو المرجع الوحيد للموقع',
                        style: TextStyle(fontWeight: FontWeight.w900),
                      ),
                      const SizedBox(height: 10),
                      TextField(
                        controller: mapsUrl,
                        onChanged: (_) => setState(() {}),
                        keyboardType: TextInputType.url,
                        textDirection: TextDirection.ltr,
                        decoration: const InputDecoration(
                          labelText: 'رابط Google Maps',
                          hintText: 'https://maps.app.goo.gl/...',
                          prefixIcon: Icon(Icons.map_outlined),
                        ),
                      ),
                      if (validMapsUrl)
                        Align(
                          alignment: Alignment.centerRight,
                          child: TextButton.icon(
                            onPressed: () => launchUrl(
                              Uri.parse(mapsUrl.text.trim()),
                              mode: LaunchMode.externalApplication,
                            ),
                            icon: const Icon(Icons.open_in_new_rounded),
                            label: const Text('فتح الرابط والتأكد من الموقع'),
                          ),
                        ),
                    ],
                  ),
                ),
                const SizedBox(height: 11),
                field(
                  'وصف مكان التسليم',
                  locationHint,
                  hint: 'اسم الموقع، البوابة أو أقرب معلم',
                ),
                field('اسم المشروع (اختياري)', projectName),
                const _QuoteReviewHeading(
                  icon: Icons.event_available_outlined,
                  title: 'موعد الاستلام المطلوب',
                ),
                const SizedBox(height: 9),
                Row(
                  children: [
                    Expanded(
                      child: _QuoteScheduleTile(
                        icon: Icons.calendar_month_outlined,
                        label: 'التاريخ',
                        value:
                            '${requiredAt.day}/${requiredAt.month}/${requiredAt.year}',
                        onTap: _pickRequiredDate,
                      ),
                    ),
                    const SizedBox(width: 9),
                    Expanded(
                      child: _QuoteScheduleTile(
                        icon: Icons.schedule_rounded,
                        label: 'الساعة',
                        value: TimeOfDay.fromDateTime(requiredAt)
                            .format(context),
                        onTap: _pickRequiredTime,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 11),
                SegmentedButton<bool>(
                  segments: const [
                    ButtonSegment(
                      value: true,
                      icon: Icon(Icons.local_shipping_outlined),
                      label: Text('توصيل'),
                    ),
                    ButtonSegment(
                      value: false,
                      icon: Icon(Icons.storefront_outlined),
                      label: Text('استلام'),
                    ),
                  ],
                  selected: {delivery},
                  onSelectionChanged: (value) =>
                      setState(() => delivery = value.first),
                  showSelectedIcon: false,
                ),
                const SizedBox(height: 20),
                const _QuoteReviewHeading(
                  icon: Icons.badge_outlined,
                  title: 'المستلم والتواصل',
                ),
                const SizedBox(height: 9),
                field('اسم المستلم', recipientName),
                field(
                  'جوال المستلم',
                  recipientMobile,
                  keyboard: TextInputType.phone,
                  hint: '05xxxxxxxx',
                ),
                field('اسم المسؤول في الموقع', responsibleName),
                field(
                  'جوال مسؤول الموقع',
                  responsibleMobile,
                  keyboard: TextInputType.phone,
                  hint: '05xxxxxxxx',
                ),
                field('اسم المقاول (اختياري)', contractorName),
                field(
                  'جوال المقاول (اختياري)',
                  contractorMobile,
                  keyboard: TextInputType.phone,
                ),
                const SizedBox(height: 8),
                const _QuoteReviewHeading(
                  icon: Icons.access_time_rounded,
                  title: 'نافذة استقبال الموقع',
                ),
                const SizedBox(height: 9),
                Row(
                  children: [
                    Expanded(
                      child: _QuoteScheduleTile(
                        icon: Icons.login_rounded,
                        label: 'من الساعة',
                        value: receptionStartsAt.format(context),
                        onTap: () => _pickReceptionTime(start: true),
                      ),
                    ),
                    const SizedBox(width: 9),
                    Expanded(
                      child: _QuoteScheduleTile(
                        icon: Icons.logout_rounded,
                        label: 'إلى الساعة',
                        value: receptionEndsAt.format(context),
                        onTap: () => _pickReceptionTime(start: false),
                      ),
                    ),
                  ],
                ),
                Container(
                  width: double.infinity,
                  margin: const EdgeInsets.only(top: 9),
                  padding: const EdgeInsets.symmetric(
                    horizontal: 13,
                    vertical: 10,
                  ),
                  decoration: BoxDecoration(
                    color: BunyaColors.mint,
                    borderRadius: BorderRadius.circular(15),
                  ),
                  child: Text(
                    'الموقع يستقبل الطلبات $workingHoursValue',
                    style: const TextStyle(
                      color: BunyaColors.forest,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ),
                const SizedBox(height: 10),
                const _QuoteReviewHeading(
                  icon: Icons.local_shipping_outlined,
                  title: 'التحميل والتنزيل والوصول',
                ),
                const SizedBox(height: 9),
                choice(
                  'مسؤولية التحميل عند المزود',
                  loadingOption,
                  loadingOptions,
                  (value) => setState(() => loadingOption = value),
                ),
                choice(
                  'التنزيل في موقع العميل',
                  unloadingOption,
                  unloadingOptions,
                  (value) => setState(() => unloadingOption = value),
                ),
                choice(
                  'سهولة الطريق والوصول',
                  roadAccess,
                  roadOptions,
                  (value) => setState(() => roadAccess = value),
                ),
                field(
                  'تعليمات الوصول والبوابة',
                  accessInstructions,
                  hint: 'قيود الشاحنات، تصريح الدخول أو نقطة تجمع السائق',
                  lines: 2,
                ),
                field('ملاحظات عامة (اختياري)', notes, lines: 2),
                const SizedBox(height: 10),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: BunyaColors.mint,
                    borderRadius: BorderRadius.circular(16),
                  ),
                  child: const Text(
                    'منافسة الأسعار تستمر 3 ساعات. الطلب بين 8 ص و4 م يبدأ فورًا، والطلب خارج هذه الفترة يُتاح للمزودين من 6 ص ويبدأ عداده الساعة 8 صباحًا بتوقيت الرياض.',
                    style: TextStyle(
                      color: BunyaColors.forest,
                      fontWeight: FontWeight.w900,
                      height: 1.65,
                    ),
                  ),
                ),
                const SizedBox(height: 14),
                const _QuoteReviewHeading(
                  icon: Icons.gavel_outlined,
                  title: 'إقرارات العميل',
                ),
                const SizedBox(height: 8),
                _QuoteAcknowledgement(
                  value: driverAck,
                  onChanged: (value) => setState(() => driverAck = value),
                  text: 'أقر بتحمل المسؤولية الكاملة عن أي تكلفة أو إعادة توصيل إذا وصل السائق وفق الموعد والبيانات المعتمدة ثم غادر لعدم وجود مستلم أو تعذر الاستلام من طرفي.',
                ),
                _QuoteAcknowledgement(
                  value: dataAck,
                  onChanged: (value) => setState(() => dataAck = value),
                  text: 'أقر بصحة رابط الموقع وأسماء وأرقام التواصل ومواعيد العمل وخيارات التحميل والتنزيل وتعليمات الوصول الواردة في هذا الطلب.',
                ),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.fromLTRB(18, 11, 18, 12),
            decoration: const BoxDecoration(
              color: BunyaColors.surface,
              border: Border(top: BorderSide(color: BunyaColors.line)),
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (formError != null) ...[
                  Semantics(
                    liveRegion: true,
                    child: Container(
                      width: double.infinity,
                      margin: const EdgeInsets.only(bottom: 9),
                      padding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 10,
                      ),
                      decoration: BoxDecoration(
                        color: const Color(0xFFFFECE8),
                        borderRadius: BorderRadius.circular(14),
                        border: Border.all(color: const Color(0xFFE8A99D)),
                      ),
                      child: Row(
                        children: [
                          const Icon(
                            Icons.error_outline_rounded,
                            color: BunyaColors.danger,
                          ),
                          const SizedBox(width: 9),
                          Expanded(
                            child: Text(
                              formError!,
                              style: const TextStyle(
                                color: BunyaColors.danger,
                                fontWeight: FontWeight.w800,
                                height: 1.45,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
                SizedBox(
                  width: double.infinity,
                  child: FilledButton.icon(
                    onPressed: busy ? null : submit,
                    icon: busy
                        ? const SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: Colors.white,
                            ),
                          )
                        : const Icon(Icons.verified_rounded),
                    label: Text(
                      busy
                          ? 'جارٍ اعتماد الطلب...'
                          : 'اعتماد وإرسال طلب عرض السعر',
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    ),
  );
}

class _QuoteReviewHeading extends StatelessWidget {
  const _QuoteReviewHeading({required this.icon, required this.title});
  final IconData icon;
  final String title;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      Icon(icon, size: 20, color: BunyaColors.copper),
      const SizedBox(width: 8),
      Text(
        title,
        style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w900),
      ),
    ],
  );
}

class _QuoteScheduleTile extends StatelessWidget {
  const _QuoteScheduleTile({
    required this.icon,
    required this.label,
    required this.value,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final String value;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    label: '$label، $value',
    child: Material(
      color: Colors.white,
      shape: RoundedRectangleBorder(
        side: const BorderSide(color: BunyaColors.line),
        borderRadius: BorderRadius.circular(17),
      ),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(17),
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 68),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            child: Row(
              children: [
                Container(
                  width: 36,
                  height: 36,
                  decoration: BoxDecoration(
                    color: const Color(0xFFFFF0E6),
                    borderRadius: BorderRadius.circular(11),
                  ),
                  child: Icon(icon, size: 20, color: BunyaColors.copper),
                ),
                const SizedBox(width: 9),
                Expanded(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        label,
                        style: const TextStyle(
                          color: BunyaColors.muted,
                          fontSize: 11,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        value,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontWeight: FontWeight.w900),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    ),
  );
}

class _QuoteAcknowledgement extends StatelessWidget {
  const _QuoteAcknowledgement({
    required this.value,
    required this.onChanged,
    required this.text,
  });
  final bool value;
  final ValueChanged<bool> onChanged;
  final String text;

  @override
  Widget build(BuildContext context) => Container(
    margin: const EdgeInsets.only(bottom: 9),
    decoration: BoxDecoration(
      color: const Color(0xFFFFF8EF),
      borderRadius: BorderRadius.circular(16),
      border: Border.all(color: const Color(0xFFE5C8AE)),
    ),
    child: CheckboxListTile(
      value: value,
      onChanged: (next) => onChanged(next ?? false),
      controlAffinity: ListTileControlAffinity.leading,
      contentPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      title: Text(
        text,
        style: const TextStyle(
          height: 1.65,
          fontSize: 12,
          fontWeight: FontWeight.w700,
        ),
      ),
    ),
  );
}

class QuotesTab extends StatefulWidget {
  const QuotesTab({super.key, required this.repository, required this.onLogin});
  final BunyaRepository repository;
  final Future<bool> Function() onLogin;
  @override
  State<QuotesTab> createState() => _QuotesTabState();
}

class _QuotesTabState extends State<QuotesTab> {
  @override
  Widget build(BuildContext context) {
    if (widget.repository.user == null) {
      return _AccessGate(
        title: 'طلباتك في مكان واحد',
        caption: 'سجّل دخولك لمتابعة المنافسة بين الموردين وحالة التسليم.',
        onLogin: () async {
          await widget.onLogin();
          if (mounted) setState(() {});
        },
      );
    }
    return FutureBuilder<List<QuoteSummary>>(
      future: widget.repository.loadQuotes(),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Center(child: CircularProgressIndicator());
        }
        final rows = snapshot.data ?? const [];
        return RefreshIndicator(
          onRefresh: () async => setState(() {}),
          child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 15, 16, 28),
            children: [
              Text(
                'طلبات عروض السعر',
                style: Theme.of(context).textTheme.headlineSmall
                    ?.copyWith(fontWeight: FontWeight.w900),
              ),
              const SizedBox(height: 4),
              const Text(
                'من الإرسال حتى اختيار العرض والتسليم.',
                style: TextStyle(
                  color: BunyaColors.muted,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 18),
              if (rows.isEmpty)
                const SizedBox(
                  height: 440,
                  child: _Empty(
                    icon: Icons.receipt_long_outlined,
                    title: 'لا توجد طلبات بعد',
                    caption: 'اختر منتجًا وابدأ أول منافسة سعرية.',
                  ),
                )
              else
                ...rows.map(
                  (quote) => _QuoteCard(
                    quote: quote,
                    onTap: () => Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) => QuoteDetailScreen(
                          repository: widget.repository,
                          quote: quote,
                        ),
                      ),
                    ),
                  ),
                ),
            ],
          ),
        );
      },
    );
  }
}

class CustomerDeliveriesScreen extends StatefulWidget {
  const CustomerDeliveriesScreen({super.key, required this.repository});
  final BunyaRepository repository;

  @override
  State<CustomerDeliveriesScreen> createState() =>
      _CustomerDeliveriesScreenState();
}

class _CustomerDeliveriesScreenState extends State<CustomerDeliveriesScreen> {
  late Future<List<Map<String, dynamic>>> deliveries = widget.repository
      .loadCustomerDeliveries();

  Future<void> reload() async {
    setState(() {
      deliveries = widget.repository.loadCustomerDeliveries();
    });
    await deliveries;
  }

  String stamp(dynamic value) {
    final parsed = DateTime.tryParse('$value')?.toLocal();
    return parsed == null ? '—' : _dateTime(parsed);
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('متابعة التوصيل')),
    body: FutureBuilder<List<Map<String, dynamic>>>(
      future: deliveries,
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Center(child: CircularProgressIndicator());
        }
        if (snapshot.hasError) {
          return Center(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Text(
                _friendlyError(snapshot.error!),
                textAlign: TextAlign.center,
              ),
            ),
          );
        }
        final rows = snapshot.data ?? const [];
        return RefreshIndicator(
          onRefresh: reload,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 30),
            children: [
              const Text(
                'أثبت الاستلام بأمان',
                style: TextStyle(fontSize: 24, fontWeight: FontWeight.w900),
              ),
              const SizedBox(height: 5),
              const Text(
                'لا تدخل الرمز إلا بعد وصول كامل البضاعة ومراجعتها. التأكيد يغلق التوصيل والطلب نهائيًا.',
                style: TextStyle(
                  color: BunyaColors.muted,
                  height: 1.65,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 18),
              if (rows.isEmpty)
                const SizedBox(
                  height: 380,
                  child: _Empty(
                    icon: Icons.local_shipping_outlined,
                    title: 'لا توجد توصيلات',
                    caption: 'تظهر هنا التوصيلات المرتبطة بطلباتك المدفوعة.',
                  ),
                )
              else
                ...rows.map((row) {
                  final status = '${row['delivery_status']}';
                  final confirmed = row['confirmed_at'] != null;
                  return Container(
                    margin: const EdgeInsets.only(bottom: 12),
                    padding: const EdgeInsets.all(16),
                    decoration: _whiteCard(20),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    '${row['order_code']}',
                                    style: const TextStyle(
                                      fontWeight: FontWeight.w900,
                                      fontSize: 17,
                                    ),
                                  ),
                                  Text(
                                    'الحالة: $status',
                                    style: const TextStyle(
                                      color: BunyaColors.muted,
                                      fontWeight: FontWeight.w700,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            Icon(
                              confirmed
                                  ? Icons.verified_rounded
                                  : Icons.local_shipping_rounded,
                              color: confirmed
                                  ? const Color(0xFF15734B)
                                  : BunyaColors.copper,
                            ),
                          ],
                        ),
                        const SizedBox(height: 12),
                        _DeliveryFacts(
                          values: {
                            'السائق': '${row['driver_name'] ?? 'لم يُسند بعد'}',
                            'الموعد المتوقع': stamp(row['expected_at']),
                            'آخر تحديث': stamp(row['latest_update_at']),
                            'تم التسليم': stamp(row['delivered_at']),
                          },
                        ),
                        if ('${row['google_maps_url'] ?? ''}'.isNotEmpty) ...[
                          const SizedBox(height: 10),
                          OutlinedButton.icon(
                            onPressed: () => launchUrl(
                              Uri.parse('${row['google_maps_url']}'),
                              mode: LaunchMode.externalApplication,
                            ),
                            icon: const Icon(Icons.map_outlined),
                            label: const Text(
                              'فتح موقع التسليم في Google Maps',
                            ),
                          ),
                        ],
                        if (row['delivery_status'] == 'arrived' &&
                            !confirmed) ...[
                          const SizedBox(height: 14),
                          Container(
                            padding: const EdgeInsets.all(13),
                            decoration: BoxDecoration(
                              color: const Color(0xFFFFF8EF),
                              borderRadius: BorderRadius.circular(16),
                              border: Border.all(
                                color: const Color(0xFFE6C9B1),
                              ),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                const Text(
                                  'وصل السائق إلى الموقع',
                                  style: TextStyle(fontWeight: FontWeight.w900),
                                ),
                                const Text(
                                  'سلّم الرمز للسائق أو المزود بعد استلام كامل البضاعة ومراجعتها. لا يمكن للعميل إدخال الرمز من التطبيق.',
                                  style: TextStyle(
                                    color: BunyaColors.muted,
                                    height: 1.6,
                                    fontSize: 12,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ] else if (confirmed) ...[
                          const SizedBox(height: 12),
                          Container(
                            padding: const EdgeInsets.all(12),
                            decoration: BoxDecoration(
                              color: const Color(0xFFE3F4EB),
                              borderRadius: BorderRadius.circular(14),
                            ),
                            child: Text(
                              '✓ تم إثبات التسليم في ${stamp(row['confirmed_at'])} والطلب مغلق بنجاح.',
                              style: const TextStyle(
                                color: Color(0xFF126541),
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                          ),
                        ],
                      ],
                    ),
                  );
                }),
            ],
          ),
        );
      },
    ),
  );
}

class _DeliveryFacts extends StatelessWidget {
  const _DeliveryFacts({required this.values});
  final Map<String, String> values;

  @override
  Widget build(BuildContext context) => Wrap(
    spacing: 8,
    runSpacing: 8,
    children: values.entries
        .map(
          (entry) => Container(
            width: MediaQuery.sizeOf(context).width > 430
                ? 180
                : (MediaQuery.sizeOf(context).width - 58) / 2,
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: BunyaColors.sand,
              borderRadius: BorderRadius.circular(13),
            ),
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
                const SizedBox(height: 3),
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

class _QuoteCard extends StatelessWidget {
  const _QuoteCard({required this.quote, required this.onTap});
  final QuoteSummary quote;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) {
    final state = _status(quote.status);
    return Padding(
      padding: const EdgeInsets.only(bottom: 11),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(20),
          child: Container(
            padding: const EdgeInsets.all(17),
            decoration: _whiteCard(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        quote.code,
                        style: const TextStyle(fontWeight: FontWeight.w900),
                      ),
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 10,
                        vertical: 5,
                      ),
                      decoration: BoxDecoration(
                        color: state.$2,
                        borderRadius: BorderRadius.circular(30),
                      ),
                      child: Text(
                        state.$1,
                        style: TextStyle(
                          color: state.$3,
                          fontSize: 10,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ),
                  ],
                ),
                const Divider(height: 24, color: BunyaColors.line),
                Row(
                  children: [
                    const Icon(
                      Icons.location_on_outlined,
                      size: 18,
                      color: BunyaColors.copper,
                    ),
                    const SizedBox(width: 6),
                    Text(
                      quote.city,
                      style: const TextStyle(fontWeight: FontWeight.w800),
                    ),
                    const Spacer(),
                    const Icon(
                      Icons.event_outlined,
                      size: 17,
                      color: BunyaColors.muted,
                    ),
                    const SizedBox(width: 5),
                    Text(
                      '${quote.requiredAt.day}/${quote.requiredAt.month}',
                      style: const TextStyle(
                        color: BunyaColors.muted,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(width: 8),
                    const Icon(
                      Icons.arrow_back_ios_new_rounded,
                      size: 15,
                      color: BunyaColors.copper,
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class QuoteDetailScreen extends StatelessWidget {
  const QuoteDetailScreen({
    super.key,
    required this.repository,
    required this.quote,
  });
  final BunyaRepository repository;
  final QuoteSummary quote;

  Future<void> _openMap(BuildContext context, String value) async {
    final uri = Uri.tryParse(value.trim());
    if (uri == null ||
        !await launchUrl(uri, mode: LaunchMode.externalApplication)) {
      if (context.mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(const SnackBar(content: Text('تعذر فتح موقع التسليم')));
      }
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('تفاصيل الطلب')),
    body: FutureBuilder<QuoteDetail>(
      future: repository.loadQuoteDetail(quote),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Center(child: CircularProgressIndicator());
        }
        if (snapshot.hasError) {
          return _ErrorCard(
            onRetry: () => Navigator.of(context).pushReplacement(
              MaterialPageRoute(
                builder: (_) =>
                    QuoteDetailScreen(repository: repository, quote: quote),
              ),
            ),
          );
        }
        final detail = snapshot.data!;
        final hasFinalOffer = detail.offer != null;
        final effectiveStatus = hasFinalOffer
            ? (detail.offer!.status == 'accepted' ? 'accepted' : 'quote_ready')
            : detail.summary.status;
        final state = _status(effectiveStatus);
        return ListView(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 30),
          children: [
            Container(
              padding: const EdgeInsets.all(21),
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  colors: [BunyaColors.forest, Color(0xFF276A58)],
                ),
                borderRadius: BorderRadius.circular(26),
                boxShadow: const [
                  BoxShadow(
                    color: Color(0x28123F33),
                    blurRadius: 28,
                    offset: Offset(0, 14),
                  ),
                ],
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          detail.summary.code,
                          textDirection: TextDirection.ltr,
                          style: const TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ),
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 11,
                          vertical: 6,
                        ),
                        decoration: BoxDecoration(
                          color: state.$2,
                          borderRadius: BorderRadius.circular(30),
                        ),
                        child: Text(
                          state.$1,
                          style: TextStyle(
                            color: state.$3,
                            fontSize: 11,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 18),
                  Text(
                    'طلب عرض السعر',
                    style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                      color: Colors.white,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 5),
                  Text(
                    hasFinalOffer
                        ? 'أُرسل ${_date(detail.summary.createdAt)} · العرض النهائي جاهز'
                        : 'أُرسل ${_date(detail.summary.createdAt)} · آخر موعد للتسعير ${_dateTime(detail.deadline)}',
                    style: const TextStyle(
                      color: Color(0xFFBFE2D6),
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 14),
            _QuoteProgress(status: effectiveStatus),
            if (!hasFinalOffer) ...[
              const SizedBox(height: 12),
              _PricingWindowCard(
                opensAt: detail.pricingOpensAt,
                startsAt: detail.pricingCountdownStartsAt,
                deadlineAt: detail.deadline,
              ),
            ],
            const SizedBox(height: 18),
            _DetailSection(
              title: 'المنتجات المطلوبة',
              icon: Icons.inventory_2_outlined,
              child: Column(
                children: detail.items.asMap().entries.map((entry) {
                  final item = entry.value;
                  return Container(
                    margin: EdgeInsets.only(
                      bottom: entry.key == detail.items.length - 1 ? 0 : 10,
                    ),
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: BunyaColors.sand,
                      borderRadius: BorderRadius.circular(17),
                    ),
                    child: Row(
                      children: [
                        Container(
                          width: 44,
                          height: 44,
                          decoration: BoxDecoration(
                            color: const Color(0xFFF0DDCF),
                            borderRadius: BorderRadius.circular(14),
                          ),
                          child: const Icon(
                            Icons.domain_rounded,
                            color: BunyaColors.copperDark,
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                item.name,
                                style: const TextStyle(
                                  fontWeight: FontWeight.w900,
                                ),
                              ),
                              if (item.measurement.isNotEmpty)
                                Text(
                                  item.measurement,
                                  style: const TextStyle(
                                    color: BunyaColors.muted,
                                    fontSize: 11,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                              if (item.notes.isNotEmpty)
                                Text(
                                  item.notes,
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                    color: BunyaColors.muted,
                                    fontSize: 10,
                                  ),
                                ),
                            ],
                          ),
                        ),
                        const SizedBox(width: 8),
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            Text(
                              _quantity(item.quantity),
                              style: const TextStyle(
                                fontSize: 18,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                            Text(
                              item.unit,
                              style: const TextStyle(
                                color: BunyaColors.muted,
                                fontSize: 10,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  );
                }).toList(),
              ),
            ),
            const SizedBox(height: 12),
            _DetailSection(
              title: 'التسليم والموقع',
              icon: Icons.local_shipping_outlined,
              child: Column(
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: _DetailFact(
                          label: 'مواعيد العمل',
                          value: detail.workingHours.isEmpty
                              ? '—'
                              : detail.workingHours,
                          icon: Icons.schedule_outlined,
                        ),
                      ),
                      const SizedBox(width: 9),
                      Expanded(
                        child: _DetailFact(
                          label: 'طريقة الاستلام',
                          value: detail.deliveryMode == 'pickup'
                              ? 'استلام من المورد'
                              : 'توصيل للموقع',
                          icon: detail.deliveryMode == 'pickup'
                              ? Icons.storefront_outlined
                              : Icons.local_shipping_outlined,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 9),
                  Row(
                    children: [
                      Expanded(
                        child: _DetailFact(
                          label: 'موعد الاستلام',
                          value: _date(detail.summary.requiredAt),
                          icon: Icons.event_outlined,
                        ),
                      ),
                      const SizedBox(width: 9),
                      Expanded(
                        child: _DetailFact(
                          label: 'وصف الموقع',
                          value: detail.location,
                          icon: Icons.pin_drop_outlined,
                        ),
                      ),
                    ],
                  ),
                  if (detail.mapsUrl.isNotEmpty) ...[
                    const SizedBox(height: 9),
                    Material(
                      color: BunyaColors.mint,
                      borderRadius: BorderRadius.circular(15),
                      child: InkWell(
                        onTap: () => _openMap(context, detail.mapsUrl),
                        borderRadius: BorderRadius.circular(15),
                        child: const Padding(
                          padding: EdgeInsets.all(13),
                          child: Row(
                            children: [
                              Icon(
                                Icons.map_outlined,
                                color: BunyaColors.forest,
                              ),
                              SizedBox(width: 9),
                              Expanded(
                                child: Text(
                                  'فتح موقع التسليم في Google Maps',
                                  style: TextStyle(
                                    color: BunyaColors.forest,
                                    fontSize: 11,
                                    fontWeight: FontWeight.w900,
                                  ),
                                ),
                              ),
                              Icon(
                                Icons.open_in_new_rounded,
                                color: BunyaColors.forest,
                                size: 18,
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ),
            if (detail.recipientName.isNotEmpty ||
                detail.recipientMobile.isNotEmpty) ...[
              const SizedBox(height: 12),
              _DetailSection(
                title: 'بيانات المستلم',
                icon: Icons.person_pin_circle_outlined,
                child: Row(
                  children: [
                    Expanded(
                      child: _DetailFact(
                        label: 'الاسم',
                        value: detail.recipientName.isEmpty
                            ? '—'
                            : detail.recipientName,
                        icon: Icons.person_outline,
                      ),
                    ),
                    const SizedBox(width: 9),
                    Expanded(
                      child: _DetailFact(
                        label: 'الجوال',
                        value: detail.recipientMobile.isEmpty
                            ? '—'
                            : detail.recipientMobile,
                        icon: Icons.phone_outlined,
                      ),
                    ),
                  ],
                ),
              ),
            ],
            if (detail.siteResponsibleName.isNotEmpty ||
                detail.loadingOption.isNotEmpty) ...[
              const SizedBox(height: 12),
              _DetailSection(
                title: 'مسؤول الموقع والوصول',
                icon: Icons.badge_outlined,
                child: Column(
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: _DetailFact(
                            label: 'مسؤول الموقع',
                            value: detail.siteResponsibleName.isEmpty
                                ? '—'
                                : detail.siteResponsibleName,
                            icon: Icons.person_outline_rounded,
                          ),
                        ),
                        const SizedBox(width: 9),
                        Expanded(
                          child: _DetailFact(
                            label: 'جوال المسؤول',
                            value: detail.siteResponsibleMobile.isEmpty
                                ? '—'
                                : detail.siteResponsibleMobile,
                            icon: Icons.phone_outlined,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 9),
                    Row(
                      children: [
                        Expanded(
                          child: _DetailFact(
                            label: 'المقاول',
                            value: detail.contractorName.isEmpty
                                ? 'لا يوجد'
                                : detail.contractorName,
                            icon: Icons.engineering_outlined,
                          ),
                        ),
                        const SizedBox(width: 9),
                        Expanded(
                          child: _DetailFact(
                            label: 'جوال المقاول',
                            value: detail.contractorMobile.isEmpty
                                ? '—'
                                : detail.contractorMobile,
                            icon: Icons.phone_outlined,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 9),
                    _DetailFact(
                      label: 'التحميل',
                      value: detail.loadingOption,
                      icon: Icons.inventory_2_outlined,
                    ),
                    const SizedBox(height: 9),
                    _DetailFact(
                      label: 'التنزيل',
                      value: detail.unloadingOption,
                      icon: Icons.unarchive_outlined,
                    ),
                    const SizedBox(height: 9),
                    _DetailFact(
                      label: 'سهولة الطريق',
                      value: detail.roadAccess,
                      icon: Icons.route_outlined,
                    ),
                    const SizedBox(height: 9),
                    _DetailFact(
                      label: 'تعليمات الوصول',
                      value: detail.accessInstructions,
                      icon: Icons.signpost_outlined,
                    ),
                    if (detail.acknowledgedAt != null) ...[
                      const SizedBox(height: 9),
                      Container(
                        width: double.infinity,
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: BunyaColors.mint,
                          borderRadius: BorderRadius.circular(14),
                        ),
                        child: const Text(
                          'تم تسجيل إقرار مسؤولية الاستلام وصحة بيانات الطلب.',
                          style: TextStyle(
                            color: BunyaColors.forest,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ],
            if (detail.notes.isNotEmpty) ...[
              const SizedBox(height: 12),
              _DetailSection(
                title: 'ملاحظات الطلب',
                icon: Icons.notes_rounded,
                child: Text(
                  detail.notes,
                  style: const TextStyle(
                    color: BunyaColors.muted,
                    height: 1.7,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ],
            const SizedBox(height: 12),
            detail.offer == null
                ? Container(
                    padding: const EdgeInsets.all(17),
                    decoration: BoxDecoration(
                      color: const Color(0xFFFFF2DF),
                      borderRadius: BorderRadius.circular(20),
                      border: Border.all(color: const Color(0xFFF0D2A9)),
                    ),
                    child: const Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Icon(
                          Icons.hourglass_top_rounded,
                          color: Color(0xFF9B651E),
                        ),
                        SizedBox(width: 11),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                'العرض قيد التجهيز',
                                style: TextStyle(
                                  color: Color(0xFF7D4E13),
                                  fontWeight: FontWeight.w900,
                                ),
                              ),
                              SizedBox(height: 3),
                              Text(
                                'يجري التحقق ومقارنة أسعار الموردين. سيصلك إشعار فور جاهزية العرض.',
                                style: TextStyle(
                                  color: Color(0xFF8C6A3F),
                                  height: 1.6,
                                  fontSize: 11,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  )
                : Column(
                    children: [
                      _OfferCard(offer: detail.offer!, repository: repository),
                      const SizedBox(height: 12),
                      _CustomerDeliveryTrackingCard(
                        repository: repository,
                        requestId: quote.id,
                      ),
                    ],
                  ),
          ],
        );
      },
    ),
  );
}

class _CustomerDeliveryTrackingCard extends StatefulWidget {
  const _CustomerDeliveryTrackingCard({
    required this.repository,
    required this.requestId,
  });
  final BunyaRepository repository;
  final String requestId;

  @override
  State<_CustomerDeliveryTrackingCard> createState() =>
      _CustomerDeliveryTrackingCardState();
}

class _CustomerDeliveryTrackingCardState
    extends State<_CustomerDeliveryTrackingCard> {
  late Future<Map<String, dynamic>?> delivery = widget.repository
      .loadCustomerDeliveryTracking(widget.requestId);

  Future<void> reload() async {
    setState(() {
      delivery = widget.repository.loadCustomerDeliveryTracking(
        widget.requestId,
      );
    });
    await delivery;
  }

  @override
  Widget build(BuildContext context) => FutureBuilder<Map<String, dynamic>?>(
    future: delivery,
    builder: (context, snapshot) {
      if (snapshot.connectionState == ConnectionState.waiting) {
        return Container(
          padding: const EdgeInsets.all(18),
          decoration: _whiteCard(20),
          child: const Center(child: CircularProgressIndicator()),
        );
      }
      final row = snapshot.data;
      if (row == null) return const SizedBox.shrink();
      final driverName = '${row['driver_name'] ?? ''}'.trim();
      final driverMobile = '${row['driver_mobile'] ?? ''}'.trim();
      final status = '${row['delivery_status'] ?? 'assigned'}';
      final expected = DateTime.tryParse('${row['expected_at']}')?.toLocal();
      final latest = DateTime.tryParse('${row['latest_update_at'] ?? ''}')
          ?.toLocal();
      return Container(
        padding: const EdgeInsets.all(17),
        decoration: _whiteCard(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    color: BunyaColors.mint,
                    borderRadius: BorderRadius.circular(13),
                  ),
                  child: const Icon(
                    Icons.local_shipping_outlined,
                    color: BunyaColors.forest,
                  ),
                ),
                const SizedBox(width: 10),
                const Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'متابعة التوصيل',
                        style: TextStyle(fontWeight: FontWeight.w900),
                      ),
                      Text(
                        'ضمن العرض المدفوع',
                        style: TextStyle(
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
                    horizontal: 10,
                    vertical: 6,
                  ),
                  decoration: BoxDecoration(
                    color: BunyaColors.sand,
                    borderRadius: BorderRadius.circular(30),
                  ),
                  child: Text(
                    _deliveryStatusLabel(status),
                    style: const TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 13),
            Row(
              children: [
                Expanded(
                  child: _DetailFact(
                    label: 'السائق المسند',
                    value: driverName.isEmpty ? 'لم يُسند بعد' : driverName,
                    icon: Icons.badge_outlined,
                  ),
                ),
                const SizedBox(width: 9),
                Expanded(
                  child: _DetailFact(
                    label: 'موعد الوصول',
                    value: expected == null ? '—' : _dateTime(expected),
                    icon: Icons.schedule_outlined,
                  ),
                ),
              ],
            ),
            if (driverMobile.isNotEmpty) ...[
              const SizedBox(height: 9),
              OutlinedButton.icon(
                onPressed: () => launchUrl(Uri.parse('tel:$driverMobile')),
                icon: const Icon(Icons.phone_outlined),
                label: Text('اتصال بالسائق · $driverMobile'),
              ),
            ],
            const SizedBox(height: 9),
            Text(
              latest == null
                  ? 'لم يصل تحديث جديد بعد.'
                  : 'آخر تحديث ${_dateTime(latest)}',
              style: const TextStyle(
                color: BunyaColors.muted,
                fontSize: 11,
                fontWeight: FontWeight.w700,
              ),
            ),
            if (status == 'arrived') ...[
              const SizedBox(height: 9),
              _CustomerDeliveryCodePanel(
                repository: widget.repository,
                deliveryId: '${row['delivery_id']}',
              ),
              const SizedBox(height: 9),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: const Color(0xFFFFF2DF),
                  borderRadius: BorderRadius.circular(14),
                ),
                child: const Text(
                  'وصل السائق. سلّمه رمز التسليم بعد استلام كامل البضاعة؛ إدخال الرمز متاح للسائق أو المزود فقط.',
                  style: TextStyle(
                    color: Color(0xFF7D4E13),
                    height: 1.6,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
            ],
            const SizedBox(height: 8),
            TextButton.icon(
              onPressed: reload,
              icon: const Icon(Icons.refresh_rounded),
              label: const Text('تحديث حالة السائق'),
            ),
          ],
        ),
      );
    },
  );
}

class _CustomerDeliveryCodePanel extends StatefulWidget {
  const _CustomerDeliveryCodePanel({
    required this.repository,
    required this.deliveryId,
  });

  final BunyaRepository repository;
  final String deliveryId;

  @override
  State<_CustomerDeliveryCodePanel> createState() =>
      _CustomerDeliveryCodePanelState();
}

class _CustomerDeliveryCodePanelState
    extends State<_CustomerDeliveryCodePanel> {
  late Future<String> code = widget.repository.loadCustomerDeliveryCode(
    widget.deliveryId,
  );
  bool copied = false;

  void retry() {
    setState(() {
      copied = false;
      code = widget.repository.loadCustomerDeliveryCode(widget.deliveryId);
    });
  }

  String errorMessage(Object? error) {
    final message = '$error'.replaceFirst(RegExp(r'^Exception:\s*'), '').trim();
    if (message.isEmpty ||
        message.contains('ClientException') ||
        message.contains('SocketException') ||
        message.contains('XMLHttpRequest')) {
      return 'تعذر الاتصال بمنصة بُنية. تحقق من الشبكة ثم حاول مجددًا.';
    }
    return message;
  }

  @override
  Widget build(BuildContext context) => FutureBuilder<String>(
    future: code,
    builder: (context, snapshot) {
      if (snapshot.connectionState == ConnectionState.waiting) {
        return Container(
          constraints: const BoxConstraints(minHeight: 92),
          decoration: BoxDecoration(
            color: BunyaColors.forest,
            borderRadius: BorderRadius.circular(16),
          ),
          child: const Center(
            child: CircularProgressIndicator(color: Colors.white),
          ),
        );
      }
      if (snapshot.hasError || snapshot.data == null) {
        return Container(
          padding: const EdgeInsets.all(13),
          decoration: BoxDecoration(
            color: const Color(0xFFFFF2DF),
            borderRadius: BorderRadius.circular(16),
          ),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  errorMessage(snapshot.error),
                  style: const TextStyle(
                    color: Color(0xFF7D4E13),
                    fontWeight: FontWeight.w800,
                    height: 1.5,
                  ),
                ),
              ),
              IconButton(
                onPressed: retry,
                tooltip: 'إعادة تحميل رمز التسليم',
                icon: const Icon(Icons.refresh_rounded),
              ),
            ],
          ),
        );
      }
      final value = snapshot.data!;
      return Container(
        padding: const EdgeInsets.all(15),
        decoration: BoxDecoration(
          color: BunyaColors.forest,
          borderRadius: BorderRadius.circular(16),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text(
              'رمز التسليم الخاص بك',
              style: TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.w900,
              ),
            ),
            const SizedBox(height: 3),
            const Text(
              'لا تسلّمه للسائق أو المزود إلا بعد استلام كامل البضاعة ومراجعتها.',
              style: TextStyle(
                color: Color(0xFFD7E7DF),
                fontSize: 11,
                height: 1.5,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: SelectableText(
                    value,
                    textDirection: TextDirection.ltr,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 30,
                      fontWeight: FontWeight.w900,
                      letterSpacing: 7,
                    ),
                  ),
                ),
                IconButton.filledTonal(
                  onPressed: () async {
                    await Clipboard.setData(ClipboardData(text: value));
                    if (mounted) setState(() => copied = true);
                  },
                  tooltip: 'نسخ رمز التسليم',
                  icon: Icon(copied ? Icons.check_rounded : Icons.copy_rounded),
                ),
              ],
            ),
          ],
        ),
      );
    },
  );
}

String _deliveryStatusLabel(String value) =>
    const {
      'assigned': 'تم الإسناد',
      'picked_up': 'استلم البضاعة',
      'in_transit': 'في الطريق',
      'arrived': 'وصل للموقع',
      'delivered': 'تم التسليم',
      'failed_delivery': 'تعذر التسليم',
    }[value] ??
    value;

class _PricingWindowCard extends StatefulWidget {
  const _PricingWindowCard({
    required this.opensAt,
    required this.startsAt,
    required this.deadlineAt,
  });
  final DateTime opensAt, startsAt, deadlineAt;

  @override
  State<_PricingWindowCard> createState() => _PricingWindowCardState();
}

class _PricingWindowCardState extends State<_PricingWindowCard> {
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
    final now = DateTime.now();
    late final String label;
    late final DateTime target;
    if (now.isBefore(widget.opensAt)) {
      label = 'يفتح تسعير المزودين بعد';
      target = widget.opensAt;
    } else if (now.isBefore(widget.startsAt)) {
      label = 'يبدأ عداد الثلاث ساعات بعد';
      target = widget.startsAt;
    } else if (now.isBefore(widget.deadlineAt)) {
      label = 'الوقت المتبقي لمنافسة الأسعار';
      target = widget.deadlineAt;
    } else {
      label = 'انتهت نافذة تسعير المزودين';
      target = now;
    }
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: BunyaColors.mint,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: const Color(0xFFB9D9CB)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: const TextStyle(
              color: BunyaColors.forest,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 5),
          Text(
            _durationClock(target.difference(now)),
            textDirection: TextDirection.ltr,
            style: const TextStyle(
              color: BunyaColors.forest,
              fontSize: 23,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 5),
          const Text(
            'مدة التسعير 3 ساعات. الطلب بين 8 ص و4 م يبدأ فورًا، وخارجها يبدأ العداد 8 ص ويُتاح للمزودين من 6 ص بتوقيت الرياض.',
            style: TextStyle(
              color: BunyaColors.muted,
              fontSize: 11,
              height: 1.6,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }
}

String _durationClock(Duration value) {
  final seconds = value.inSeconds.clamp(0, 999999);
  final days = seconds ~/ 86400;
  final hours = (seconds % 86400) ~/ 3600;
  final minutes = (seconds % 3600) ~/ 60;
  final rest = seconds % 60;
  final clock =
      '${hours.toString().padLeft(2, '0')}:${minutes.toString().padLeft(2, '0')}:${rest.toString().padLeft(2, '0')}';
  return days > 0 ? '$days يوم · $clock' : clock;
}

class _QuoteProgress extends StatelessWidget {
  const _QuoteProgress({required this.status});
  final String status;
  @override
  Widget build(BuildContext context) {
    final current = switch (status) {
      'draft' => 0,
      'submitted' || 'verifying' || 'sourcing' => 1,
      'quoted' ||
      'quote_ready' ||
      'customer_review' ||
      'accepted' ||
      'fulfilled' => 2,
      _ => 1,
    };
    const labels = ['تم الإرسال', 'التحقق والتسعير', 'العرض النهائي'];
    return Container(
      padding: const EdgeInsets.all(17),
      decoration: _whiteCard(20),
      child: Row(
        children: List.generate(
          labels.length,
          (i) => Expanded(
            child: Column(
              children: [
                Row(
                  children: [
                    if (i > 0)
                      Expanded(
                        child: Container(
                          height: 2,
                          color: i <= current
                              ? BunyaColors.copper
                              : BunyaColors.line,
                        ),
                      ),
                    Container(
                      width: 28,
                      height: 28,
                      decoration: BoxDecoration(
                        color: i <= current
                            ? BunyaColors.copper
                            : BunyaColors.sand,
                        shape: BoxShape.circle,
                        border: Border.all(
                          color: i <= current
                              ? BunyaColors.copper
                              : BunyaColors.line,
                        ),
                      ),
                      child: Icon(
                        i < current ? Icons.check_rounded : Icons.circle,
                        size: i < current ? 16 : 7,
                        color: i <= current ? Colors.white : BunyaColors.muted,
                      ),
                    ),
                    if (i < labels.length - 1)
                      Expanded(
                        child: Container(
                          height: 2,
                          color: i < current
                              ? BunyaColors.copper
                              : BunyaColors.line,
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 7),
                Text(
                  labels[i],
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: i <= current ? BunyaColors.ink : BunyaColors.muted,
                    fontSize: 9,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _DetailSection extends StatelessWidget {
  const _DetailSection({
    required this.title,
    required this.icon,
    required this.child,
  });
  final String title;
  final IconData icon;
  final Widget child;
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(17),
    decoration: _whiteCard(20),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Container(
              width: 36,
              height: 36,
              decoration: BoxDecoration(
                color: const Color(0xFFF0DDCF),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Icon(icon, size: 19, color: BunyaColors.copperDark),
            ),
            const SizedBox(width: 10),
            Text(title, style: const TextStyle(fontWeight: FontWeight.w900)),
          ],
        ),
        const SizedBox(height: 14),
        child,
      ],
    ),
  );
}

class _DetailFact extends StatelessWidget {
  const _DetailFact({
    required this.label,
    required this.value,
    required this.icon,
  });
  final String label, value;
  final IconData icon;
  @override
  Widget build(BuildContext context) => Container(
    height: 84,
    padding: const EdgeInsets.all(11),
    decoration: BoxDecoration(
      color: BunyaColors.sand,
      borderRadius: BorderRadius.circular(15),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Icon(icon, size: 17, color: BunyaColors.copper),
        const SizedBox(height: 4),
        Text(
          label,
          style: const TextStyle(
            color: BunyaColors.muted,
            fontSize: 9,
            fontWeight: FontWeight.w700,
          ),
        ),
        Text(
          value,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w900),
        ),
      ],
    ),
  );
}

class _OfferCard extends StatefulWidget {
  const _OfferCard({required this.offer, required this.repository});
  final QuoteOfferDetail offer;
  final BunyaRepository repository;
  @override
  State<_OfferCard> createState() => _OfferCardState();
}

class _OfferCardState extends State<_OfferCard> with WidgetsBindingObserver {
  late final Timer timer;
  late String paymentStatus;
  bool busy = false;
  bool openedCheckout = false;
  String error = '';

  @override
  void initState() {
    super.initState();
    paymentStatus = widget.offer.paymentStatus;
    WidgetsBinding.instance.addObserver(this);
    if (kIsWeb &&
        Uri.base.queryParameters['payment'] == 'returned' &&
        Uri.base.queryParameters['quote'] == widget.offer.id) {
      unawaited(_reconcileReturnedPayment());
    }
    timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void didUpdateWidget(covariant _OfferCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.offer.paymentStatus != widget.offer.paymentStatus) {
      paymentStatus = widget.offer.paymentStatus;
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    timer.cancel();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && openedCheckout) {
      unawaited(_reconcileReturnedPayment());
    }
  }

  Future<void> _reconcileReturnedPayment() async {
    final paymentRepository = WorkspaceRepository(widget.repository.client);
    final status = await paymentRepository.reconcileQuotePayment(
      widget.offer.id,
    );
    BunyaRepository.notifyDataChanged();
    if (mounted) {
      setState(() {
        if (QuoteOfferDetail.isPaymentComplete(status)) {
          paymentStatus = status;
        }
        busy = false;
      });
    }
  }

  Future<void> _acceptAndPay() async {
    setState(() {
      busy = true;
      error = '';
    });
    try {
      final paymentRepository = WorkspaceRepository(widget.repository.client);
      final returnUrl = kIsWeb
          ? Uri.base
                .resolve('/')
                .replace(
                  queryParameters: {
                    'payment': 'returned',
                    'quote': widget.offer.id,
                  },
                )
                .toString()
          : null;
      final url = await paymentRepository.startQuotePayment(
        widget.offer.id,
        acceptFirst:
            widget.offer.status == 'ready' ||
            widget.offer.status == 'customer_review',
        returnUrl: returnUrl,
      );
      if (url == 'succeeded') {
        BunyaRepository.notifyDataChanged();
        if (mounted) {
          setState(() {
            paymentStatus = 'succeeded';
            busy = false;
          });
        }
        return;
      }
      final opened = await launchUrl(
        Uri.parse(url),
        mode: kIsWeb
            ? LaunchMode.platformDefault
            : LaunchMode.externalApplication,
        webOnlyWindowName: kIsWeb ? '_self' : null,
      );
      if (!opened) throw Exception('payment_open_failed');
      openedCheckout = true;
      if (mounted) setState(() => busy = false);
    } catch (_) {
      if (!mounted) return;
      setState(() {
        busy = false;
        error = context.tr('paymentStartFailed');
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final offer = widget.offer;
    final paid = QuoteOfferDetail.isPaymentComplete(paymentStatus);
    final remaining = offer.validUntil.difference(DateTime.now());
    final expired = remaining <= Duration.zero;
    return Container(
      padding: const EdgeInsets.all(19),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [BunyaColors.copper, BunyaColors.copperDark],
        ),
        borderRadius: BorderRadius.circular(22),
        boxShadow: const [
          BoxShadow(
            color: Color(0x2EB7603B),
            blurRadius: 24,
            offset: Offset(0, 12),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'عرض بُنية النهائي',
            style: TextStyle(
              color: Color(0xFFFFD9C5),
              fontWeight: FontWeight.w900,
            ),
          ),
          Text(
            offer.code,
            textDirection: TextDirection.ltr,
            style: const TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.w800,
            ),
          ),
          const Divider(height: 24, color: Color(0x44FFFFFF)),
          _PriceRow(label: 'قيمة المنتجات', value: offer.subtotal),
          _PriceRow(label: 'الضريبة', value: offer.vat),
          _PriceRow(label: 'التوصيل', value: offer.delivery),
          const Divider(height: 20, color: Color(0x44FFFFFF)),
          Row(
            children: [
              const Expanded(
                child: Text(
                  'الإجمالي',
                  style: TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
              Text(
                '${_money(offer.total)} ر.س',
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 21,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ],
          ),
          if (!paid) ...[
            const SizedBox(height: 9),
            Text(
              expired
                  ? 'انتهت صلاحية العرض ولا يمكن اعتماده'
                  : 'متبقي للاعتماد ${_durationClock(remaining)}',
              style: const TextStyle(
                color: Color(0xFFFFD9C5),
                fontSize: 13,
                fontWeight: FontWeight.w900,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              'صالح 48 ساعة · حتى ${_dateTime(offer.validUntil)}',
              style: const TextStyle(
                color: Color(0xFFFFD9C5),
                fontSize: 10,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
          const SizedBox(height: 16),
          if (paid)
            Container(
              width: double.infinity,
              constraints: const BoxConstraints(minHeight: 52),
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 13),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(15),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Icon(Icons.verified_rounded, color: BunyaColors.forest),
                  const SizedBox(width: 8),
                  Flexible(
                    child: Text(
                      context.tr('paymentSucceeded'),
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        color: BunyaColors.forest,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ),
                ],
              ),
            )
          else
            FilledButton.icon(
              onPressed: expired || busy ? null : _acceptAndPay,
              icon: busy
                  ? const SizedBox.square(
                      dimension: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.lock_outline_rounded),
              label: Text(
                expired
                    ? 'انتهت صلاحية العرض'
                    : busy
                    ? context.tr('paymentOpening')
                    : offer.status == 'accepted'
                    ? context.tr('paySecurely')
                    : context.tr('acceptAndPay'),
              ),
              style: FilledButton.styleFrom(
                backgroundColor: Colors.white,
                foregroundColor: BunyaColors.copperDark,
                disabledBackgroundColor: const Color(0x66FFFFFF),
                disabledForegroundColor: const Color(0xFF7D4A35),
                minimumSize: const Size.fromHeight(52),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(15),
                ),
                textStyle: const TextStyle(fontWeight: FontWeight.w900),
              ),
            ),
          if (error.isNotEmpty) ...[
            const SizedBox(height: 10),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(11),
              decoration: BoxDecoration(
                color: const Color(0xFFFFE8E2),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Text(
                error,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: BunyaColors.danger,
                  fontSize: 11,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _PriceRow extends StatelessWidget {
  const _PriceRow({required this.label, required this.value});
  final String label;
  final double value;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 6),
    child: Row(
      children: [
        Expanded(
          child: Text(
            label,
            style: const TextStyle(
              color: Color(0xFFEFD5C8),
              fontSize: 11,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
        Text(
          '${_money(value)} ر.س',
          style: const TextStyle(
            color: Colors.white,
            fontSize: 12,
            fontWeight: FontWeight.w900,
          ),
        ),
      ],
    ),
  );
}

class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key, required this.repository});
  final BunyaRepository repository;
  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('الإشعارات')),
    body: FutureBuilder<List<AppNotification>>(
      future: widget.repository.loadNotifications(),
      builder: (_, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Center(child: CircularProgressIndicator());
        }
        final rows = snapshot.data ?? const [];
        if (rows.isEmpty) {
          return const _Empty(
            icon: Icons.notifications_none_rounded,
            title: 'كل شيء هادئ',
            caption: 'ستصل هنا تحديثات الطلبات والأسعار والتسليم.',
          );
        }
        return RefreshIndicator(
          onRefresh: () async => setState(() {}),
          child: ListView.separated(
            padding: const EdgeInsets.all(16),
            itemCount: rows.length,
            separatorBuilder: (_, _) => const SizedBox(height: 10),
            itemBuilder: (_, i) {
              final item = rows[i];
              return InkWell(
                onTap: () async {
                  if (!item.read) {
                    await widget.repository.markNotificationRead(item);
                    if (mounted) setState(() {});
                  }
                },
                borderRadius: BorderRadius.circular(19),
                child: Container(
                  padding: const EdgeInsets.all(16),
                  decoration: _whiteCard(19),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Container(
                        width: 42,
                        height: 42,
                        decoration: BoxDecoration(
                          color: item.read
                              ? BunyaColors.sand
                              : BunyaColors.mint,
                          borderRadius: BorderRadius.circular(14),
                        ),
                        child: Icon(
                          item.read
                              ? Icons.notifications_none_rounded
                              : Icons.notifications_active_rounded,
                          color: item.read
                              ? BunyaColors.muted
                              : BunyaColors.forest,
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              item.title,
                              style: const TextStyle(
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              item.message,
                              style: const TextStyle(
                                color: BunyaColors.muted,
                                height: 1.6,
                                fontSize: 12,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              );
            },
          ),
        );
      },
    ),
  );
}

class AccountTab extends StatefulWidget {
  const AccountTab({
    super.key,
    required this.repository,
    required this.onLogin,
  });
  final BunyaRepository repository;
  final Future<bool> Function() onLogin;
  @override
  State<AccountTab> createState() => _AccountTabState();
}

class _AccountTabState extends State<AccountTab> {
  Future<void> _openLegalPage(String path, String label) async {
    final opened = await launchUrl(
      Uri.https('www.buniahksa.com', path),
      mode: LaunchMode.externalApplication,
    );
    if (!opened && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('تعذر فتح $label حاليًا. حاول مرة أخرى.')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    if (widget.repository.user == null) {
      return _AccessGate(
        title: 'حساب بُنية',
        caption: 'دخول واحد لإدارة طلباتك وإشعاراتك وبياناتك.',
        footer: Wrap(
          alignment: WrapAlignment.center,
          spacing: 4,
          runSpacing: 4,
          children: [
            TextButton(
              onPressed: () => _openLegalPage('/privacy', 'سياسة الخصوصية'),
              child: const Text('الخصوصية'),
            ),
            TextButton(
              onPressed: () => _openLegalPage('/terms', 'شروط الاستخدام'),
              child: const Text('الشروط'),
            ),
            TextButton(
              onPressed: () => _openLegalPage(
                '/account-deletion',
                'صفحة حذف الحساب والبيانات',
              ),
              child: const Text('حذف الحساب'),
            ),
          ],
        ),
        onLogin: () async {
          await widget.onLogin();
          if (mounted) setState(() {});
        },
      );
    }
    return FutureBuilder<Profile?>(
      future: widget.repository.loadProfile(),
      builder: (_, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Center(child: CircularProgressIndicator());
        }
        final profile = snapshot.data;
        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Container(
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  colors: [BunyaColors.forest, Color(0xFF236A57)],
                ),
                borderRadius: BorderRadius.circular(26),
              ),
              child: Row(
                children: [
                  CircleAvatar(
                    radius: 29,
                    backgroundColor: Colors.white.withValues(alpha: .14),
                    child: Text(
                      (profile?.name ?? 'ب').characters.first,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 22,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          profile?.name ?? 'مستخدم بُنية',
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 18,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                        Text(
                          _role(profile?.role),
                          style: const TextStyle(
                            color: Color(0xFFBDE2D4),
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 15),
            _AccountRow(
              icon: Icons.mail_outline_rounded,
              title: 'البريد الإلكتروني',
              value: profile?.email ?? '',
            ),
            _AccountRow(
              icon: Icons.phone_outlined,
              title: 'رقم الجوال',
              value: profile?.mobile.isNotEmpty == true
                  ? profile!.mobile
                  : 'غير مضاف',
            ),
            const SizedBox(height: 6),
            Container(
              decoration: _whiteCard(18),
              clipBehavior: Clip.antiAlias,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Padding(
                    padding: EdgeInsets.fromLTRB(16, 16, 16, 10),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'المعلومات القانونية والخصوصية',
                          style: TextStyle(
                            color: BunyaColors.forest,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                        SizedBox(height: 4),
                        Text(
                          'بُنية تديرها شركة ضفاف الإبداع التجارية · الرقم الوطني الموحد 7041070603',
                          style: TextStyle(
                            color: BunyaColors.muted,
                            height: 1.55,
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const Divider(height: 1),
                  _LegalLinkRow(
                    icon: Icons.privacy_tip_outlined,
                    title: 'سياسة الخصوصية',
                    onTap: () => _openLegalPage('/privacy', 'سياسة الخصوصية'),
                  ),
                  const Divider(height: 1, indent: 58),
                  _LegalLinkRow(
                    icon: Icons.description_outlined,
                    title: 'شروط الاستخدام',
                    onTap: () => _openLegalPage('/terms', 'شروط الاستخدام'),
                  ),
                  const Divider(height: 1, indent: 58),
                  _LegalLinkRow(
                    icon: Icons.manage_accounts_outlined,
                    title: 'حذف الحساب والبيانات',
                    onTap: () => _openLegalPage(
                      '/account-deletion',
                      'صفحة حذف الحساب والبيانات',
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 10),
            OutlinedButton.icon(
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => ChangePasswordScreen(
                    repository: widget.repository,
                    forced: false,
                  ),
                ),
              ),
              icon: const Icon(Icons.lock_reset_rounded),
              label: const Text('إعادة تعيين كلمة المرور'),
              style: OutlinedButton.styleFrom(
                minimumSize: const Size.fromHeight(52),
                foregroundColor: BunyaColors.forest,
                side: const BorderSide(color: BunyaColors.line),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(17),
                ),
              ),
            ),
            const SizedBox(height: 10),
            OutlinedButton.icon(
              onPressed: () async {
                await widget.repository.signOut();
                if (mounted) setState(() {});
              },
              icon: const Icon(Icons.logout_rounded),
              label: const Text('تسجيل الخروج'),
              style: OutlinedButton.styleFrom(
                minimumSize: const Size.fromHeight(52),
                foregroundColor: BunyaColors.danger,
                side: const BorderSide(color: Color(0x33B33A3A)),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(17),
                ),
              ),
            ),
          ],
        );
      },
    );
  }
}

class _LegalLinkRow extends StatelessWidget {
  const _LegalLinkRow({
    required this.icon,
    required this.title,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    label: 'فتح $title',
    child: ExcludeSemantics(
      child: ListTile(
        minTileHeight: 56,
        contentPadding: const EdgeInsets.symmetric(horizontal: 16),
        leading: Icon(icon, color: BunyaColors.copper),
        title: Text(title, style: const TextStyle(fontWeight: FontWeight.w800)),
        trailing: const Icon(Icons.open_in_new_rounded, size: 20),
        onTap: onTap,
      ),
    ),
  );
}

class _AccountRow extends StatelessWidget {
  const _AccountRow({
    required this.icon,
    required this.title,
    required this.value,
  });
  final IconData icon;
  final String title, value;
  @override
  Widget build(BuildContext context) => Container(
    margin: const EdgeInsets.only(bottom: 10),
    padding: const EdgeInsets.all(15),
    decoration: _whiteCard(18),
    child: Row(
      children: [
        Container(
          width: 42,
          height: 42,
          decoration: BoxDecoration(
            color: BunyaColors.sand,
            borderRadius: BorderRadius.circular(14),
          ),
          child: Icon(icon, color: BunyaColors.copper),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: const TextStyle(
                  color: BunyaColors.muted,
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                ),
              ),
              Text(
                value,
                textDirection: _isLeftToRightValue(value)
                    ? TextDirection.ltr
                    : null,
                style: const TextStyle(fontWeight: FontWeight.w900),
              ),
            ],
          ),
        ),
      ],
    ),
  );
}

bool _isLeftToRightValue(String value) =>
    value.contains('@') ||
    RegExp(r'^\+?[0-9][0-9\s().-]+$').hasMatch(value.trim());

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key, required this.repository});
  final BunyaRepository repository;
  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final email = TextEditingController(), password = TextEditingController();
  bool hidden = true, busy = false;
  @override
  void dispose() {
    email.dispose();
    password.dispose();
    super.dispose();
  }

  Future<void> login() async {
    if (email.text.trim().isEmpty || password.text.length < 6) {
      _message(context, 'أدخل البريد الإلكتروني أو رقم الجوال وكلمة المرور');
      return;
    }
    setState(() => busy = true);
    try {
      await widget.repository.signIn(email.text, password.text);
      await finishAuthenticatedLogin();
    } catch (error) {
      if (mounted) _message(context, _friendlyError(error));
    }
    if (mounted) setState(() => busy = false);
  }

  Future<void> loginWithApple() async {
    if (busy) return;
    setState(() => busy = true);
    try {
      await widget.repository.signInWithApple();
      await finishAuthenticatedLogin();
    } catch (error) {
      if (mounted) _message(context, _friendlyError(error));
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> finishAuthenticatedLogin() async {
    if (await widget.repository.requiresPhoneVerification()) {
      if (!mounted) return;
      final verified = await Navigator.of(context).push<bool>(
        MaterialPageRoute(
          builder: (_) =>
              PhoneVerificationScreen(repository: widget.repository),
        ),
      );
      if (verified != true) return;
    }
    await PushService.registerForCurrentUser();
    if (!mounted) return;
    Navigator.pop(context, true);
  }

  Future<void> openRegistration() async {
    final created = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) =>
            CustomerRegistrationScreen(repository: widget.repository),
      ),
    );
    if (created == true) {
      await PushService.registerForCurrentUser();
      if (mounted) Navigator.pop(context, true);
    }
  }

  Future<void> openPasswordRecovery() async {
    await Navigator.of(context).push<void>(
      MaterialPageRoute(
        builder: (_) => ForgotPasswordScreen(repository: widget.repository),
      ),
    );
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    body: SafeArea(
      child: ListView(
        padding: const EdgeInsets.all(22),
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              IconButton.filledTonal(
                onPressed: () => Navigator.pop(context, false),
                icon: const Icon(Icons.close_rounded),
              ),
              const BunyaLanguageButton(),
            ],
          ),
          const SizedBox(height: 25),
          const Center(child: BunyaBrandLogo(width: 220, height: 72)),
          const SizedBox(height: 25),
          Text(
            context.tr('welcomeBack'),
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.headlineMedium
                ?.copyWith(fontWeight: FontWeight.w900),
          ),
          const SizedBox(height: 6),
          Text(
            context.tr('loginCaption'),
            textAlign: TextAlign.center,
            style: TextStyle(
              color: BunyaColors.muted,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 30),
          TextField(
            controller: email,
            keyboardType: TextInputType.text,
            textDirection: TextDirection.ltr,
            autofillHints: const [
              AutofillHints.username,
              AutofillHints.telephoneNumber,
            ],
            decoration: InputDecoration(
              labelText: context.tr('emailOrPhone'),
              prefixIcon: const Icon(Icons.alternate_email_rounded),
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: password,
            obscureText: hidden,
            textDirection: TextDirection.ltr,
            autofillHints: const [AutofillHints.password],
            onSubmitted: (_) => login(),
            decoration: InputDecoration(
              labelText: context.tr('password'),
              prefixIcon: const Icon(Icons.lock_outline_rounded),
              suffixIcon: IconButton(
                onPressed: () => setState(() => hidden = !hidden),
                icon: Icon(
                  hidden
                      ? Icons.visibility_outlined
                      : Icons.visibility_off_outlined,
                ),
              ),
            ),
          ),
          Align(
            alignment: Alignment.centerRight,
            child: TextButton.icon(
              onPressed: busy ? null : openPasswordRecovery,
              icon: const Icon(Icons.lock_reset_rounded, size: 19),
              label: Text(context.tr('forgotPassword')),
            ),
          ),
          const SizedBox(height: 6),
          FilledButton.icon(
            onPressed: busy ? null : login,
            icon: busy
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: Colors.white,
                    ),
                  )
                : const Icon(Icons.arrow_back_rounded),
            label: Text(context.tr('signIn')),
          ),
          if (widget.repository.appleSignInAvailable) ...[
            const SizedBox(height: 14),
            SignInWithAppleButton(
              onPressed: busy ? null : loginWithApple,
              text: 'المتابعة باستخدام Apple',
              height: 52,
              borderRadius: const BorderRadius.all(Radius.circular(12)),
            ),
          ],
          const SizedBox(height: 18),
          const Row(
            children: [
              Expanded(child: Divider()),
              Padding(
                padding: EdgeInsets.symmetric(horizontal: 12),
                child: Text(
                  'أو',
                  style: TextStyle(
                    color: BunyaColors.muted,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              Expanded(child: Divider()),
            ],
          ),
          const SizedBox(height: 14),
          OutlinedButton.icon(
            onPressed: busy ? null : openRegistration,
            icon: const Icon(Icons.person_add_alt_1_rounded),
            label: const Text('إنشاء حساب عميل'),
          ),
          const SizedBox(height: 6),
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('متابعة التصفح كضيف'),
          ),
        ],
      ),
    ),
  );
}

class ChangePasswordScreen extends StatefulWidget {
  const ChangePasswordScreen({
    super.key,
    required this.repository,
    this.forced = true,
    this.onComplete,
  });
  final BunyaRepository repository;
  final bool forced;
  final VoidCallback? onComplete;

  @override
  State<ChangePasswordScreen> createState() => _ChangePasswordScreenState();
}

class _ChangePasswordScreenState extends State<ChangePasswordScreen> {
  final password = TextEditingController(), confirm = TextEditingController();
  bool hidden = true, busy = false;

  @override
  void dispose() {
    password.dispose();
    confirm.dispose();
    super.dispose();
  }

  Future<void> save() async {
    final value = password.text;
    final error = value.length < 8
        ? 'يجب ألا تقل كلمة المرور عن 8 أحرف'
        : !RegExp(r'[A-Z]').hasMatch(value)
        ? 'أضف حرفًا إنجليزيًا كبيرًا واحدًا على الأقل'
        : !RegExp(r'[0-9]').hasMatch(value)
        ? 'أضف رقمًا واحدًا على الأقل'
        : value != confirm.text
        ? 'كلمتا المرور غير متطابقتين'
        : null;
    if (error != null) {
      _message(context, error);
      return;
    }
    setState(() => busy = true);
    try {
      await widget.repository.changePassword(
        value,
        completeTemporarySetup: widget.forced,
      );
      if (!mounted) return;
      if (widget.onComplete != null) {
        widget.onComplete!();
      } else {
        Navigator.pop(context, true);
      }
    } catch (error) {
      if (mounted) _message(context, _friendlyError(error));
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => PopScope(
    canPop: !widget.forced,
    child: Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(22),
          children: [
            if (!widget.forced)
              Align(
                alignment: Alignment.centerRight,
                child: IconButton.filledTonal(
                  onPressed: () => Navigator.pop(context),
                  icon: const Icon(Icons.close_rounded),
                ),
              )
            else
              const SizedBox(height: 45),
            const CircleAvatar(
              radius: 38,
              backgroundColor: BunyaColors.mint,
              child: Icon(
                Icons.lock_reset_rounded,
                size: 40,
                color: BunyaColors.forest,
              ),
            ),
            const SizedBox(height: 20),
            Text(
              'عيّن كلمة مرور جديدة',
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.headlineSmall
                  ?.copyWith(fontWeight: FontWeight.w900),
            ),
            const SizedBox(height: 8),
            Text(
              widget.forced
                  ? 'كلمة المرور المرسلة مؤقتة. أنشئ كلمة جديدة قبل الدخول إلى حسابك.'
                  : 'اختر كلمة قوية وآمنة لحماية حسابك في بُنية.',
              textAlign: TextAlign.center,
              style: TextStyle(
                color: BunyaColors.muted,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 28),
            TextField(
              controller: password,
              obscureText: hidden,
              textDirection: TextDirection.ltr,
              decoration: InputDecoration(
                labelText: 'كلمة المرور الجديدة',
                prefixIcon: const Icon(Icons.lock_outline_rounded),
                suffixIcon: IconButton(
                  onPressed: () => setState(() => hidden = !hidden),
                  icon: Icon(
                    hidden
                        ? Icons.visibility_outlined
                        : Icons.visibility_off_outlined,
                  ),
                ),
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: confirm,
              obscureText: hidden,
              textDirection: TextDirection.ltr,
              onSubmitted: (_) => save(),
              decoration: const InputDecoration(
                labelText: 'تأكيد كلمة المرور',
                prefixIcon: Icon(Icons.verified_user_outlined),
              ),
            ),
            const SizedBox(height: 9),
            const Text(
              '8 أحرف على الأقل، حرف إنجليزي كبير، ورقم.',
              style: TextStyle(
                color: BunyaColors.muted,
                fontSize: 11,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 18),
            FilledButton.icon(
              onPressed: busy ? null : save,
              icon: busy
                  ? const SizedBox(
                      width: 19,
                      height: 19,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : const Icon(Icons.check_rounded),
              label: Text(
                widget.forced ? 'حفظ ودخول التطبيق' : 'حفظ كلمة المرور الجديدة',
              ),
            ),
          ],
        ),
      ),
    ),
  );
}

class _AccessGate extends StatelessWidget {
  const _AccessGate({
    required this.title,
    required this.caption,
    required this.onLogin,
    this.footer,
  });
  final String title, caption;
  final VoidCallback onLogin;
  final Widget? footer;
  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(24),
      child: Container(
        padding: const EdgeInsets.all(26),
        decoration: _whiteCard(28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 72,
              height: 72,
              decoration: const BoxDecoration(
                color: BunyaColors.mint,
                shape: BoxShape.circle,
              ),
              child: const Icon(
                Icons.lock_open_rounded,
                color: BunyaColors.forest,
                size: 31,
              ),
            ),
            const SizedBox(height: 18),
            Text(
              title,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.titleLarge
                  ?.copyWith(fontWeight: FontWeight.w900),
            ),
            const SizedBox(height: 7),
            Text(
              caption,
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: BunyaColors.muted,
                height: 1.7,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 20),
            FilledButton(onPressed: onLogin, child: const Text('تسجيل الدخول')),
            if (footer != null) ...[const SizedBox(height: 10), footer!],
          ],
        ),
      ),
    ),
  );
}

class _Empty extends StatelessWidget {
  const _Empty({
    required this.icon,
    required this.title,
    required this.caption,
  });
  final IconData icon;
  final String title, caption;
  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(30),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            icon,
            size: 55,
            color: BunyaColors.copper.withValues(alpha: .65),
          ),
          const SizedBox(height: 14),
          Text(
            title,
            style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w900),
          ),
          const SizedBox(height: 6),
          Text(
            caption,
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: BunyaColors.muted,
              height: 1.7,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    ),
  );
}

class _LoadingCards extends StatelessWidget {
  const _LoadingCards();
  @override
  Widget build(BuildContext context) => SizedBox(
    height: 280,
    child: ListView.separated(
      padding: const EdgeInsets.all(16),
      scrollDirection: Axis.horizontal,
      itemCount: 3,
      separatorBuilder: (_, _) => const SizedBox(width: 12),
      itemBuilder: (_, _) => Container(width: 205, decoration: _whiteCard(22)),
    ),
  );
}

class _ErrorCard extends StatelessWidget {
  const _ErrorCard({required this.onRetry});
  final VoidCallback onRetry;
  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(24),
      child: Container(
        padding: const EdgeInsets.all(22),
        decoration: _whiteCard(22),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(
              Icons.cloud_off_rounded,
              color: BunyaColors.copper,
              size: 38,
            ),
            const SizedBox(height: 10),
            const Text(
              'تعذر تحميل البيانات',
              style: TextStyle(fontWeight: FontWeight.w900),
            ),
            const SizedBox(height: 9),
            TextButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh_rounded),
              label: const Text('إعادة المحاولة'),
            ),
          ],
        ),
      ),
    ),
  );
}

BoxDecoration _whiteCard(double radius) => BoxDecoration(
  color: BunyaColors.surface,
  borderRadius: BorderRadius.circular(radius),
  border: Border.all(color: BunyaColors.line.withValues(alpha: .8)),
  boxShadow: const [
    BoxShadow(color: Color(0x0C3C2B20), blurRadius: 18, offset: Offset(0, 8)),
  ],
);
void _message(BuildContext context, String value) =>
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value)));
String _friendlyError(Object error) {
  final value = '$error'.toLowerCase();
  if (value.contains('invalid login')) {
    return 'البريد الإلكتروني أو رقم الجوال أو كلمة المرور غير صحيحة';
  }
  if (value.contains('not authorized')) {
    return 'لا تملك صلاحية تنفيذ هذه العملية';
  }
  if (value.contains('not out for delivery')) {
    return 'لم تبدأ رحلة التوصيل لهذا الطلب بعد';
  }
  if (value.contains('verified customer')) {
    return 'يجب توثيق حساب العميل قبل إرسال الطلب';
  }
  if (value.contains('valid google maps url')) {
    return 'ألصق رابط Google Maps صحيحًا لمكان التسليم';
  }
  if (value.contains('delivery location description')) {
    return 'اكتب وصفًا واضحًا لمكان التسليم';
  }
  if (value.contains('valid recipient contact')) {
    return 'أكمل اسم المستلم ورقم جواله السعودي الصحيح';
  }
  if (value.contains('valid site responsible contact')) {
    return 'أكمل اسم مسؤول الموقع ورقم جواله السعودي الصحيح';
  }
  if (value.contains('complete delivery and access details')) {
    return 'أكمل مواعيد العمل وخيارات التحميل والتنزيل وتعليمات الوصول';
  }
  if (value.contains('delivery acknowledgements')) {
    return 'وافق على الإقرارين قبل اعتماد الطلب';
  }
  if (value.contains('product is not available')) {
    return 'أحد المنتجات لم يعد متاحًا؛ احذفه وأضفه من الكتالوج مجددًا';
  }
  if (value.contains('product variant is required') ||
      value.contains('select every product variant group')) {
    return 'اختر جميع قياسات وخيارات المنتج المطلوبة';
  }
  if (value.contains('schedule')) return 'موعد الاستلام قريب جدًا';
  return 'تعذر إكمال العملية، حاول مرة أخرى';
}

String _role(String? value) =>
    const {
      'customer': 'عميل',
      'provider': 'مزود',
      'contractor': 'مقاول',
      'driver': 'سائق',
      'admin': 'إدارة المنصة',
    }[value] ??
    'عضو بُنية';
(String, Color, Color) _status(String value) => switch (value) {
  'sourcing' => ('جاري التسعير', BunyaColors.mint, BunyaColors.forest),
  'verifying' => ('التحقق', const Color(0xFFFFE9C9), const Color(0xFF8D5D15)),
  'quoted' => ('عرض جاهز', const Color(0xFFDCE8FF), const Color(0xFF31598C)),
  'quote_ready' => (
    'عرض جاهز',
    const Color(0xFFDCE8FF),
    const Color(0xFF31598C),
  ),
  'customer_review' => (
    'بانتظار قرارك',
    const Color(0xFFDCE8FF),
    const Color(0xFF31598C),
  ),
  'accepted' => ('معتمد', BunyaColors.mint, BunyaColors.forest),
  'cancelled' => ('ملغي', const Color(0xFFFFDFDF), BunyaColors.danger),
  _ => ('قيد المعالجة', const Color(0xFFF0E8DE), BunyaColors.muted),
};
String _quantity(double value) => value == value.roundToDouble()
    ? value.toInt().toString()
    : value.toStringAsFixed(2);
String _money(double value) =>
    value.toStringAsFixed(2).replaceFirst(RegExp(r'\.00$'), '');
String _date(DateTime value) => '${value.day}/${value.month}/${value.year}';
String _dateTime(DateTime value) =>
    '${value.day}/${value.month} · ${value.hour.toString().padLeft(2, '0')}:${value.minute.toString().padLeft(2, '0')}';
