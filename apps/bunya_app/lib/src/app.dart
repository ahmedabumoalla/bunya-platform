import 'dart:async';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:url_launcher/url_launcher.dart';

import 'data.dart';
import 'join_screen.dart';
import 'push_service.dart';
import 'theme.dart';

class ConfigurationMissingApp extends StatelessWidget {
  const ConfigurationMissingApp({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
    debugShowCheckedModeBanner: false,
    theme: bunyaTheme(),
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
      if (event.session != null) {
        unawaited(PushService.registerForCurrentUser());
      }
      if (mounted) setState(() => authVersion++);
    });
  }

  @override
  void dispose() {
    _auth?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => MaterialApp(
    key: ValueKey(authVersion),
    title: 'بُنية',
    debugShowCheckedModeBanner: false,
    theme: bunyaTheme(),
    locale: const Locale('ar'),
    builder: (context, child) =>
        Directionality(textDirection: TextDirection.rtl, child: child!),
    home: const BunyaShell(),
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
  int index = 0;

  Future<bool> ensureAuth() async {
    if (repo.user != null) return true;
    return await Navigator.of(context).push<bool>(
          MaterialPageRoute(builder: (_) => LoginScreen(repository: repo)),
        ) ??
        false;
  }

  void refreshCatalog() =>
      setState(() => catalog = repo.loadCatalog(forceRefresh: true));

  @override
  Widget build(BuildContext context) {
    final pages = [
      HomeTab(
        catalog: catalog,
        onCatalog: () => setState(() => index = 1),
        onQuotes: () => setState(() => index = 2),
        onProduct: openProduct,
        onRefresh: refreshCatalog,
        onJoinProvider: () => openJoin(JoinKind.provider),
        onJoinContractor: () => openJoin(JoinKind.contractor),
      ),
      CatalogTab(
        catalog: catalog,
        onProduct: openProduct,
        onRefresh: refreshCatalog,
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
          IconButton.filledTonal(
            tooltip: 'الإشعارات',
            onPressed: () async {
              if (!await ensureAuth() || !context.mounted) return;
              await Navigator.of(context).push(
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
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.space_dashboard_outlined),
            selectedIcon: Icon(Icons.space_dashboard_rounded),
            label: 'الرئيسية',
          ),
          NavigationDestination(
            icon: Icon(Icons.grid_view_outlined),
            selectedIcon: Icon(Icons.grid_view_rounded),
            label: 'المنتجات',
          ),
          NavigationDestination(
            icon: Icon(Icons.receipt_long_outlined),
            selectedIcon: Icon(Icons.receipt_long_rounded),
            label: 'طلباتي',
          ),
          NavigationDestination(
            icon: Icon(Icons.person_outline_rounded),
            selectedIcon: Icon(Icons.person_rounded),
            label: 'حسابي',
          ),
        ],
      ),
    );
  }

  Future<void> openProduct(Product product) async {
    final request = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => ProductSheet(product: product),
    );
    if (request != true || !mounted || !await ensureAuth() || !mounted) return;
    final submitted = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => QuoteComposer(product: product, repository: repo),
    );
    if (submitted == true && mounted) setState(() => index = 2);
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
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      Container(
        width: 42,
        height: 42,
        padding: const EdgeInsets.all(6),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: BunyaColors.line),
        ),
        child: Image.asset('assets/brand/app-icon.png'),
      ),
      const SizedBox(width: 10),
      Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            'بُنية',
            style: Theme.of(context).textTheme.titleLarge
                ?.copyWith(fontWeight: FontWeight.w900, height: 1),
          ),
          const SizedBox(height: 3),
          Text(
            'لمشروعك، من البداية',
            style: Theme.of(context).textTheme.labelSmall?.copyWith(
              color: BunyaColors.muted,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    ],
  );
}

class HomeTab extends StatelessWidget {
  const HomeTab({
    super.key,
    required this.catalog,
    required this.onCatalog,
    required this.onQuotes,
    required this.onProduct,
    required this.onRefresh,
    required this.onJoinProvider,
    required this.onJoinContractor,
  });
  final Future<CatalogData> catalog;
  final VoidCallback onCatalog,
      onQuotes,
      onRefresh,
      onJoinProvider,
      onJoinContractor;
  final ValueChanged<Product> onProduct;

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
                      onTap: () => _message(
                        context,
                        'دليل المقاولين قيد التجهيز داخل التطبيق',
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 25),
              const _SectionTitle(
                title: 'انضم إلى شركاء بُنية',
                caption: 'ابدأ نشاطك واستقبل الفرص من التطبيق',
              ),
              const SizedBox(height: 11),
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
              ),
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
                height: 290,
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
        Positioned(
          left: 18,
          top: 8,
          child: Icon(
            Icons.auto_awesome_rounded,
            color: const Color(0xFFE8B38F).withValues(alpha: .9),
            size: 30,
          ),
        ),
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 6),
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: .1),
                borderRadius: BorderRadius.circular(30),
              ),
              child: const Text(
                'سوق البناء الذكي',
                style: TextStyle(
                  color: Color(0xFFEFC5AA),
                  fontSize: 12,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ),
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
  String query = '', category = 'الكل';
  @override
  Widget build(BuildContext context) => FutureBuilder<CatalogData>(
    future: widget.catalog,
    builder: (context, snapshot) {
      if (snapshot.connectionState == ConnectionState.waiting) {
        return const Center(child: CircularProgressIndicator());
      }
      if (snapshot.hasError) return _ErrorCard(onRetry: widget.onRefresh);
      final data = snapshot.data!;
      final filtered = data.products
          .where(
            (p) =>
                (category == 'الكل' || p.category == category) &&
                (query.isEmpty ||
                    '${p.name} ${p.category} ${p.description}'.contains(query)),
          )
          .toList();
      return CustomScrollView(
        slivers: [
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 10),
            sliver: SliverList.list(
              children: [
                Text(
                  'اكتشف مواد مشروعك',
                  style: Theme.of(context).textTheme.headlineSmall
                      ?.copyWith(fontWeight: FontWeight.w900),
                ),
                const SizedBox(height: 4),
                const Text(
                  'منتجات معتمدة تُرسل للموردين للحصول على أفضل عرض.',
                  style: TextStyle(
                    color: BunyaColors.muted,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 16),
                TextField(
                  onChanged: (value) => setState(() => query = value.trim()),
                  decoration: const InputDecoration(
                    prefixIcon: Icon(Icons.search_rounded),
                    hintText: 'اسم المنتج أو التصنيف...',
                  ),
                ),
                const SizedBox(height: 12),
                SizedBox(
                  height: 44,
                  child: ListView.separated(
                    scrollDirection: Axis.horizontal,
                    itemCount: data.categories.length + 1,
                    separatorBuilder: (_, _) => const SizedBox(width: 8),
                    itemBuilder: (_, i) {
                      final item = i == 0 ? 'الكل' : data.categories[i - 1];
                      final active = item == category;
                      return ChoiceChip(
                        label: Text(item),
                        selected: active,
                        onSelected: (_) => setState(() => category = item),
                        selectedColor: BunyaColors.forest,
                        labelStyle: TextStyle(
                          color: active ? Colors.white : BunyaColors.ink,
                          fontWeight: FontWeight.w800,
                        ),
                        side: const BorderSide(color: BunyaColors.line),
                      );
                    },
                  ),
                ),
                const SizedBox(height: 15),
                Text(
                  '${filtered.length} منتج',
                  style: const TextStyle(fontWeight: FontWeight.w900),
                ),
              ],
            ),
          ),
          if (filtered.isEmpty)
            const SliverFillRemaining(
              child: _Empty(
                icon: Icons.search_off_rounded,
                title: 'لا توجد نتائج',
                caption: 'جرّب كلمة بحث أو تصنيفًا آخر.',
              ),
            )
          else
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
              sliver: SliverGrid.builder(
                gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                  crossAxisCount: 2,
                  mainAxisExtent: 265,
                  crossAxisSpacing: 11,
                  mainAxisSpacing: 11,
                ),
                itemCount: filtered.length,
                itemBuilder: (_, i) => ProductCard(
                  product: filtered[i],
                  onTap: () => widget.onProduct(filtered[i]),
                ),
              ),
            ),
        ],
      );
    },
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
                            fontSize: 10,
                            fontWeight: FontWeight.w900,
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
                  Text(
                    product.category,
                    style: const TextStyle(
                      color: BunyaColors.copper,
                      fontSize: 10,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    product.name,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontWeight: FontWeight.w900,
                      height: 1.35,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Row(
                    children: [
                      const Icon(
                        Icons.inventory_2_outlined,
                        size: 14,
                        color: BunyaColors.muted,
                      ),
                      const SizedBox(width: 5),
                      Expanded(
                        child: Text(
                          product.unit,
                          style: const TextStyle(
                            color: BunyaColors.muted,
                            fontSize: 11,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                      const Icon(
                        Icons.arrow_back_rounded,
                        size: 17,
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

class ProductVisual extends StatelessWidget {
  const ProductVisual({super.key, required this.product});
  final Product product;
  @override
  Widget build(BuildContext context) => ColoredBox(
    color: const Color(0xFFF0E9E0),
    child: product.imageUrl == null
        ? Center(
            child: Icon(
              Icons.domain_rounded,
              size: 52,
              color: BunyaColors.copper.withValues(alpha: .45),
            ),
          )
        : CachedNetworkImage(
            imageUrl: product.imageUrl!,
            cacheKey: product.imageCacheKey,
            fit: BoxFit.cover,
            memCacheWidth: 900,
            maxWidthDiskCache: 1200,
            fadeInDuration: const Duration(milliseconds: 120),
            placeholder: (_, _) =>
                const Center(child: CircularProgressIndicator(strokeWidth: 2)),
            errorWidget: (_, _, _) => const Center(
              child: Icon(
                Icons.domain_rounded,
                size: 52,
                color: BunyaColors.copper,
              ),
            ),
          ),
  );
}

class ProductSheet extends StatelessWidget {
  const ProductSheet({super.key, required this.product});
  final Product product;
  @override
  Widget build(BuildContext context) => SafeArea(
    top: false,
    child: Container(
      constraints: BoxConstraints(
        maxHeight: MediaQuery.sizeOf(context).height * .88,
      ),
      decoration: const BoxDecoration(
        color: BunyaColors.surface,
        borderRadius: BorderRadius.vertical(top: Radius.circular(30)),
      ),
      child: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Center(
              child: Container(
                width: 44,
                height: 5,
                margin: const EdgeInsets.all(11),
                decoration: BoxDecoration(
                  color: BunyaColors.line,
                  borderRadius: BorderRadius.circular(20),
                ),
              ),
            ),
            SizedBox(
              height: 270,
              width: double.infinity,
              child: ProductVisual(product: product),
            ),
            Padding(
              padding: const EdgeInsets.all(22),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    product.category,
                    style: const TextStyle(
                      color: BunyaColors.copper,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 5),
                  Text(
                    product.name,
                    style: Theme.of(context).textTheme.headlineSmall
                        ?.copyWith(fontWeight: FontWeight.w900),
                  ),
                  const SizedBox(height: 12),
                  Text(
                    product.description.isEmpty
                        ? 'منتج معتمد ضمن كتالوج بُنية.'
                        : product.description,
                    style: const TextStyle(
                      color: BunyaColors.muted,
                      height: 1.8,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 17),
                  Row(
                    children: [
                      Expanded(
                        child: _Fact(
                          icon: Icons.inventory_2_outlined,
                          title: 'الوحدة',
                          value: product.unit,
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: _Fact(
                          icon: Icons.local_shipping_outlined,
                          title: 'التوصيل',
                          value: product.deliveryWindow,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 18),
                  FilledButton.icon(
                    onPressed: () => Navigator.pop(context, true),
                    icon: const Icon(Icons.receipt_long_rounded),
                    label: const Text('أضف إلى طلب عرض سعر'),
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

class _Fact extends StatelessWidget {
  const _Fact({required this.icon, required this.title, required this.value});
  final IconData icon;
  final String title, value;
  @override
  Widget build(BuildContext context) => Container(
    height: 86,
    padding: const EdgeInsets.all(13),
    decoration: BoxDecoration(
      color: BunyaColors.sand,
      borderRadius: BorderRadius.circular(17),
    ),
    child: Row(
      children: [
        Icon(icon, color: BunyaColors.copper),
        const SizedBox(width: 9),
        Expanded(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: const TextStyle(
                  fontSize: 10,
                  color: BunyaColors.muted,
                  fontWeight: FontWeight.w800,
                ),
              ),
              Text(
                value,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ],
          ),
        ),
      ],
    ),
  );
}

class QuoteComposer extends StatefulWidget {
  const QuoteComposer({
    super.key,
    required this.product,
    required this.repository,
  });
  final Product product;
  final BunyaRepository repository;
  @override
  State<QuoteComposer> createState() => _QuoteComposerState();
}

class _QuoteComposerState extends State<QuoteComposer> {
  final quantity = TextEditingController(text: '1'),
      city = TextEditingController(),
      notes = TextEditingController();
  DateTime requiredAt = DateTime.now().add(const Duration(days: 2));
  bool delivery = true, busy = false;
  @override
  void dispose() {
    quantity.dispose();
    city.dispose();
    notes.dispose();
    super.dispose();
  }

  Future<void> submit() async {
    final amount = double.tryParse(quantity.text.trim());
    if (amount == null || amount <= 0 || city.text.trim().length < 2) {
      _message(context, 'أدخل الكمية والمدينة بشكل صحيح');
      return;
    }
    setState(() => busy = true);
    try {
      await widget.repository.submitQuote(
        product: widget.product,
        quantity: amount,
        city: city.text,
        requiredAt: requiredAt,
        notes: notes.text,
        delivery: delivery,
      );
      if (mounted) {
        Navigator.pop(context, true);
        _message(context, 'تم إرسال طلبك للموردين المطابقين');
      }
    } catch (error) {
      if (mounted) _message(context, _friendlyError(error));
    }
    if (mounted) setState(() => busy = false);
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
                'طلب عرض سعر',
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
                        widget.product.unit,
                        style: const TextStyle(fontWeight: FontWeight.w900),
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 11),
              TextField(
                controller: city,
                decoration: const InputDecoration(
                  labelText: 'مدينة التسليم',
                  prefixIcon: Icon(Icons.location_on_outlined),
                ),
              ),
              const SizedBox(height: 11),
              InkWell(
                onTap: () async {
                  final date = await showDatePicker(
                    context: context,
                    firstDate: DateTime.now().add(const Duration(days: 1)),
                    lastDate: DateTime.now().add(const Duration(days: 180)),
                    initialDate: requiredAt,
                  );
                  if (date != null) {
                    setState(
                      () => requiredAt = DateTime(
                        date.year,
                        date.month,
                        date.day,
                        12,
                      ),
                    );
                  }
                },
                borderRadius: BorderRadius.circular(18),
                child: InputDecorator(
                  decoration: const InputDecoration(
                    labelText: 'موعد الاستلام',
                    prefixIcon: Icon(Icons.event_outlined),
                  ),
                  child: Text(
                    '${requiredAt.day}/${requiredAt.month}/${requiredAt.year}',
                    style: const TextStyle(fontWeight: FontWeight.w900),
                  ),
                ),
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
              const SizedBox(height: 11),
              TextField(
                controller: notes,
                minLines: 2,
                maxLines: 4,
                decoration: const InputDecoration(
                  labelText: 'ملاحظات اختيارية',
                ),
              ),
              const SizedBox(height: 16),
              FilledButton.icon(
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
                    : const Icon(Icons.rocket_launch_rounded),
                label: const Text('إرسال الطلب للمنافسة'),
              ),
            ],
          ),
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
        final state = _status(detail.summary.status);
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
                    'أُرسل ${_date(detail.summary.createdAt)} · آخر موعد للتسعير ${_dateTime(detail.deadline)}',
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
            _QuoteProgress(status: detail.summary.status),
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
                          label: 'المدينة',
                          value: detail.summary.city,
                          icon: Icons.location_city_outlined,
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
                : _OfferCard(offer: detail.offer!),
          ],
        );
      },
    ),
  );
}

class _QuoteProgress extends StatelessWidget {
  const _QuoteProgress({required this.status});
  final String status;
  @override
  Widget build(BuildContext context) {
    final current = switch (status) {
      'draft' => 0,
      'submitted' || 'verifying' || 'sourcing' => 1,
      'quoted' || 'accepted' || 'fulfilled' => 2,
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

class _OfferCard extends StatelessWidget {
  const _OfferCard({required this.offer});
  final QuoteOfferDetail offer;
  @override
  Widget build(BuildContext context) => Container(
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
        const SizedBox(height: 9),
        Text(
          'صالح حتى ${_dateTime(offer.validUntil)}',
          style: const TextStyle(
            color: Color(0xFFFFD9C5),
            fontSize: 10,
            fontWeight: FontWeight.w700,
          ),
        ),
      ],
    ),
  );
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
  @override
  Widget build(BuildContext context) {
    if (widget.repository.user == null) {
      return _AccessGate(
        title: 'حساب بُنية',
        caption: 'دخول واحد لإدارة طلباتك وإشعاراتك وبياناتك.',
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
              Text(value, style: const TextStyle(fontWeight: FontWeight.w900)),
            ],
          ),
        ),
      ],
    ),
  );
}

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
      _message(context, 'أدخل البريد وكلمة المرور');
      return;
    }
    setState(() => busy = true);
    try {
      await widget.repository.signIn(email.text, password.text);
      await PushService.registerForCurrentUser();
      final profile = await widget.repository.loadProfile();
      if (!mounted) return;
      if (profile?.mustChangePassword == true) {
        Navigator.of(context).pushReplacement(
          MaterialPageRoute(
            builder: (_) => ChangePasswordScreen(repository: widget.repository),
          ),
        );
      } else {
        Navigator.pop(context, true);
      }
    } catch (error) {
      if (mounted) _message(context, _friendlyError(error));
    }
    if (mounted) setState(() => busy = false);
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    body: SafeArea(
      child: ListView(
        padding: const EdgeInsets.all(22),
        children: [
          Align(
            alignment: Alignment.centerRight,
            child: IconButton.filledTonal(
              onPressed: () => Navigator.pop(context, false),
              icon: const Icon(Icons.close_rounded),
            ),
          ),
          const SizedBox(height: 25),
          Center(
            child: Container(
              width: 78,
              height: 78,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(25),
                boxShadow: const [
                  BoxShadow(
                    color: Color(0x1A5B3B29),
                    blurRadius: 25,
                    offset: Offset(0, 12),
                  ),
                ],
              ),
              child: Image.asset('assets/brand/app-icon.png'),
            ),
          ),
          const SizedBox(height: 25),
          Text(
            'مرحبًا بعودتك',
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.headlineMedium
                ?.copyWith(fontWeight: FontWeight.w900),
          ),
          const SizedBox(height: 6),
          const Text(
            'سجّل دخولك لإدارة مشروعك من بُنية',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: BunyaColors.muted,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 30),
          TextField(
            controller: email,
            keyboardType: TextInputType.emailAddress,
            textDirection: TextDirection.ltr,
            decoration: const InputDecoration(
              labelText: 'البريد الإلكتروني',
              prefixIcon: Icon(Icons.mail_outline_rounded),
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: password,
            obscureText: hidden,
            textDirection: TextDirection.ltr,
            onSubmitted: (_) => login(),
            decoration: InputDecoration(
              labelText: 'كلمة المرور',
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
          const SizedBox(height: 18),
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
            label: const Text('تسجيل الدخول'),
          ),
          const SizedBox(height: 15),
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
  const ChangePasswordScreen({super.key, required this.repository});
  final BunyaRepository repository;

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
      await widget.repository.changeTemporaryPassword(value);
      if (mounted) Navigator.pop(context, true);
    } catch (error) {
      if (mounted) _message(context, _friendlyError(error));
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => PopScope(
    canPop: false,
    child: Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(22),
          children: [
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
            const Text(
              'كلمة المرور المرسلة مؤقتة. غيّرها الآن قبل الدخول إلى حسابك.',
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
              label: const Text('حفظ ودخول التطبيق'),
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
  });
  final String title, caption;
  final VoidCallback onLogin;
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
    return 'البريد الإلكتروني أو كلمة المرور غير صحيحة';
  }
  if (value.contains('verified customer')) {
    return 'يجب توثيق حساب العميل قبل إرسال الطلب';
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
