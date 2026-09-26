import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import 'data.dart';
import 'theme.dart';

abstract final class _DirectoryMetrics {
  static const pageInset = 16.0;
  static const sectionGap = 18.0;
  static const cardGap = 12.0;
  static const cardRadius = 22.0;
}

class ContractorDirectoryScreen extends StatefulWidget {
  const ContractorDirectoryScreen({super.key, required this.repository});

  final BunyaRepository repository;

  @override
  State<ContractorDirectoryScreen> createState() =>
      _ContractorDirectoryScreenState();
}

class _ContractorDirectoryScreenState extends State<ContractorDirectoryScreen> {
  final search = TextEditingController();
  late Future<List<ContractorDirectoryEntry>> request;
  String selectedRegion = 'الكل';

  @override
  void initState() {
    super.initState();
    request = widget.repository.loadContractorDirectory();
    search.addListener(_refreshSearch);
  }

  @override
  void dispose() {
    search
      ..removeListener(_refreshSearch)
      ..dispose();
    super.dispose();
  }

  void _refreshSearch() => setState(() {});

  Future<void> _reload() async {
    setState(() => request = widget.repository.loadContractorDirectory());
    await request;
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: const Text('دليل المقاولين'),
      leading: IconButton(
        tooltip: 'العودة',
        onPressed: () => Navigator.pop(context),
        icon: const Icon(Icons.arrow_forward_rounded),
      ),
    ),
    body: SafeArea(
      top: false,
      child: FutureBuilder<List<ContractorDirectoryEntry>>(
        future: request,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const _DirectoryLoading();
          }
          if (snapshot.hasError) {
            return _DirectoryState(
              icon: Icons.cloud_off_rounded,
              title: 'تعذر تحميل دليل المقاولين',
              caption: 'تحقق من الاتصال ثم حاول مرة أخرى.',
              action: 'إعادة المحاولة',
              onAction: _reload,
            );
          }
          final contractors = snapshot.data ?? const [];
          final regions = <String>{
            for (final contractor in contractors)
              ...(contractor.workRegions.isEmpty
                  ? [contractor.city]
                  : contractor.workRegions),
          }.where((value) => value.trim().isNotEmpty).toList()..sort();
          final clean = search.text.trim().toLowerCase();
          final filtered = contractors.where((contractor) {
            final matchesSearch =
                clean.isEmpty ||
                <String>[
                  contractor.displayName,
                  contractor.commercialName,
                  contractor.summary,
                  ...contractor.serviceTypes,
                ].any((value) => value.toLowerCase().contains(clean));
            final matchesRegion =
                selectedRegion == 'الكل' ||
                contractor.city == selectedRegion ||
                contractor.workRegions.contains(selectedRegion);
            return matchesSearch && matchesRegion;
          }).toList();

          return RefreshIndicator(
            onRefresh: _reload,
            child: CustomScrollView(
              keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
              slivers: [
                SliverPadding(
                  padding: const EdgeInsets.fromLTRB(
                    _DirectoryMetrics.pageInset,
                    6,
                    _DirectoryMetrics.pageInset,
                    10,
                  ),
                  sliver: SliverList.list(
                    children: [
                      const _DirectoryIntro(),
                      const SizedBox(height: _DirectoryMetrics.sectionGap),
                      TextField(
                        controller: search,
                        textInputAction: TextInputAction.search,
                        decoration: const InputDecoration(
                          labelText: 'ابحث بالاسم أو التخصص',
                          hintText: 'مثال: تشطيبات، عزل، مقاولات عامة',
                          prefixIcon: Icon(Icons.search_rounded),
                        ),
                      ),
                      if (regions.isNotEmpty) ...[
                        const SizedBox(height: 11),
                        SizedBox(
                          height: 42,
                          child: ListView.separated(
                            scrollDirection: Axis.horizontal,
                            itemCount: regions.length + 1,
                            separatorBuilder: (_, _) =>
                                const SizedBox(width: 7),
                            itemBuilder: (context, index) {
                              final value = index == 0
                                  ? 'الكل'
                                  : regions[index - 1];
                              return ChoiceChip(
                                label: Text(value),
                                selected: selectedRegion == value,
                                onSelected: (_) =>
                                    setState(() => selectedRegion = value),
                              );
                            },
                          ),
                        ),
                      ],
                      const SizedBox(height: 14),
                      Row(
                        children: [
                          Text(
                            'المقاولون المعتمدون',
                            style: Theme.of(context).textTheme.titleMedium
                                ?.copyWith(fontWeight: FontWeight.w900),
                          ),
                          const Spacer(),
                          Text(
                            '${filtered.length} مقاول',
                            style: const TextStyle(
                              color: BunyaColors.copper,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                if (filtered.isEmpty)
                  SliverFillRemaining(
                    hasScrollBody: false,
                    child: _DirectoryState(
                      icon: contractors.isEmpty
                          ? Icons.engineering_outlined
                          : Icons.search_off_rounded,
                      title: contractors.isEmpty
                          ? 'لا يوجد مقاولون معتمدون حتى الآن'
                          : 'لا توجد نتائج مطابقة',
                      caption: contractors.isEmpty
                          ? 'سيظهر هنا كل مقاول فور اعتماد طلب انضمامه من الإدارة.'
                          : 'غيّر البحث أو اختر كل المناطق.',
                      action: contractors.isEmpty ? null : 'إعادة الضبط',
                      onAction: contractors.isEmpty
                          ? null
                          : () => setState(() {
                              search.clear();
                              selectedRegion = 'الكل';
                            }),
                    ),
                  )
                else
                  SliverPadding(
                    padding: const EdgeInsets.fromLTRB(
                      _DirectoryMetrics.pageInset,
                      2,
                      _DirectoryMetrics.pageInset,
                      28,
                    ),
                    sliver: SliverList.separated(
                      itemCount: filtered.length,
                      separatorBuilder: (_, _) =>
                          const SizedBox(height: _DirectoryMetrics.cardGap),
                      itemBuilder: (_, index) =>
                          _ContractorCard(contractor: filtered[index]),
                    ),
                  ),
              ],
            ),
          );
        },
      ),
    ),
  );
}

class _DirectoryIntro extends StatelessWidget {
  const _DirectoryIntro();

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(18),
    decoration: BoxDecoration(
      color: BunyaColors.forest,
      borderRadius: BorderRadius.circular(_DirectoryMetrics.cardRadius),
    ),
    child: const Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'شبكة بُنية المهنية',
                style: TextStyle(
                  color: Color(0xFFDCEFE6),
                  fontWeight: FontWeight.w800,
                ),
              ),
              SizedBox(height: 5),
              Text(
                'اختر مقاولًا معتمدًا لمشروعك',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 20,
                  fontWeight: FontWeight.w900,
                  height: 1.4,
                ),
              ),
              SizedBox(height: 5),
              Text(
                'بيانات الاعتماد والتخصصات ومناطق العمل من ملفات الانضمام المعتمدة.',
                style: TextStyle(
                  color: Color(0xFFC2D8D0),
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                  height: 1.6,
                ),
              ),
            ],
          ),
        ),
        SizedBox(width: 12),
        Icon(Icons.verified_rounded, color: Color(0xFFE5B28E), size: 34),
      ],
    ),
  );
}

class _ContractorCard extends StatelessWidget {
  const _ContractorCard({required this.contractor});

  final ContractorDirectoryEntry contractor;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(16),
    decoration: BoxDecoration(
      color: BunyaColors.surface,
      borderRadius: BorderRadius.circular(_DirectoryMetrics.cardRadius),
      border: Border.all(color: BunyaColors.line),
      boxShadow: const [
        BoxShadow(
          color: Color(0x0C3C2B20),
          blurRadius: 18,
          offset: Offset(0, 8),
        ),
      ],
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            CircleAvatar(
              radius: 25,
              backgroundColor: BunyaColors.mint,
              foregroundColor: BunyaColors.forest,
              child: Text(
                contractor.displayName.trim().isEmpty
                    ? 'م'
                    : contractor.displayName.trim()[0],
                style: const TextStyle(
                  fontSize: 19,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ),
            const SizedBox(width: 11),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    contractor.commercialName,
                    style: Theme.of(context).textTheme.titleMedium
                        ?.copyWith(fontWeight: FontWeight.w900),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    contractor.badge,
                    style: const TextStyle(
                      color: BunyaColors.muted,
                      fontSize: 10,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ],
              ),
            ),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
              decoration: BoxDecoration(
                color: BunyaColors.mint,
                borderRadius: BorderRadius.circular(999),
              ),
              child: const Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(
                    Icons.verified_rounded,
                    size: 14,
                    color: BunyaColors.forest,
                  ),
                  SizedBox(width: 4),
                  Text(
                    'معتمد',
                    style: TextStyle(
                      color: BunyaColors.forest,
                      fontSize: 9,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
        const SizedBox(height: 13),
        Text(
          contractor.summary,
          style: const TextStyle(
            color: BunyaColors.muted,
            height: 1.65,
            fontSize: 11,
            fontWeight: FontWeight.w700,
          ),
        ),
        const SizedBox(height: 13),
        Row(
          children: [
            Expanded(
              child: _Metric(
                label: 'التقييم',
                value: '${contractor.averageRating.toStringAsFixed(1)}/5',
              ),
            ),
            const SizedBox(width: 7),
            Expanded(
              child: _Metric(
                label: 'المشاريع',
                value: '${contractor.projectsCount}',
              ),
            ),
            const SizedBox(width: 7),
            Expanded(
              child: _Metric(
                label: 'الخبرة',
                value: contractor.yearsExperience > 0
                    ? '${contractor.yearsExperience} سنوات'
                    : 'غير محددة',
              ),
            ),
          ],
        ),
        const SizedBox(height: 13),
        _TagsSection(
          title: 'التخصصات',
          icon: Icons.handyman_outlined,
          values: contractor.serviceTypes.isEmpty
              ? const ['مقاولات عامة']
              : contractor.serviceTypes,
        ),
        const SizedBox(height: 10),
        _TagsSection(
          title: 'مناطق العمل',
          icon: Icons.location_on_outlined,
          values: contractor.workRegions.isEmpty
              ? [contractor.city]
              : contractor.workRegions,
        ),
        if (contractor.workItems.isNotEmpty) ...[
          const SizedBox(height: 13),
          SizedBox(
            height: 92,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: contractor.workItems.length,
              separatorBuilder: (_, _) => const SizedBox(width: 8),
              itemBuilder: (_, index) =>
                  _WorkItem(item: contractor.workItems[index]),
            ),
          ),
        ],
        const SizedBox(height: 14),
        Row(
          children: [
            Expanded(
              child: OutlinedButton.icon(
                onPressed: contractor.phone.isEmpty
                    ? null
                    : () => _launch(Uri(scheme: 'tel', path: contractor.phone)),
                icon: const Icon(Icons.call_outlined, size: 18),
                label: const Text('اتصال'),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: OutlinedButton.icon(
                onPressed: contractor.email.isEmpty
                    ? null
                    : () => _launch(
                        Uri(scheme: 'mailto', path: contractor.email),
                      ),
                icon: const Icon(Icons.mail_outline_rounded, size: 18),
                label: const Text('البريد'),
              ),
            ),
            if (contractor.mapsUrl?.trim().isNotEmpty == true) ...[
              const SizedBox(width: 8),
              IconButton.outlined(
                tooltip: 'الموقع على الخريطة',
                onPressed: () => _launch(Uri.parse(contractor.mapsUrl!)),
                icon: const Icon(Icons.map_outlined),
              ),
            ],
          ],
        ),
      ],
    ),
  );

  static Future<void> _launch(Uri uri) =>
      launchUrl(uri, mode: LaunchMode.externalApplication);
}

class _Metric extends StatelessWidget {
  const _Metric({required this.label, required this.value});

  final String label, value;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 9),
    decoration: BoxDecoration(
      color: BunyaColors.sand,
      borderRadius: BorderRadius.circular(14),
    ),
    child: Column(
      children: [
        Text(
          label,
          style: const TextStyle(
            color: BunyaColors.muted,
            fontSize: 9,
            fontWeight: FontWeight.w700,
          ),
        ),
        const SizedBox(height: 2),
        Text(
          value,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w900),
        ),
      ],
    ),
  );
}

class _TagsSection extends StatelessWidget {
  const _TagsSection({
    required this.title,
    required this.icon,
    required this.values,
  });

  final String title;
  final IconData icon;
  final List<String> values;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Row(
        children: [
          Icon(icon, size: 17, color: BunyaColors.copper),
          const SizedBox(width: 6),
          Text(
            title,
            style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w900),
          ),
        ],
      ),
      const SizedBox(height: 7),
      Wrap(
        spacing: 6,
        runSpacing: 6,
        children: values
            .map(
              (value) => Container(
                padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
                decoration: BoxDecoration(
                  color: BunyaColors.mint,
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  value,
                  style: const TextStyle(
                    color: BunyaColors.forest,
                    fontSize: 9,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
            )
            .toList(),
      ),
    ],
  );
}

class _WorkItem extends StatelessWidget {
  const _WorkItem({required this.item});

  final ContractorDirectoryWorkItem item;

  @override
  Widget build(BuildContext context) => Container(
    width: 128,
    clipBehavior: Clip.antiAlias,
    decoration: BoxDecoration(
      color: BunyaColors.sand,
      borderRadius: BorderRadius.circular(14),
      border: Border.all(color: BunyaColors.line),
    ),
    child: Stack(
      fit: StackFit.expand,
      children: [
        if (item.mediaUrl != null &&
            item.mimeType?.startsWith('image/') == true)
          Image.network(
            item.mediaUrl!,
            fit: BoxFit.cover,
            errorBuilder: (_, _, _) => const SizedBox.shrink(),
          ),
        Align(
          alignment: Alignment.bottomCenter,
          child: Container(
            width: double.infinity,
            color: BunyaColors.ink.withValues(alpha: .78),
            padding: const EdgeInsets.all(7),
            child: Text(
              item.title,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 9,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
        ),
      ],
    ),
  );
}

class _DirectoryLoading extends StatelessWidget {
  const _DirectoryLoading();

  @override
  Widget build(BuildContext context) => const Center(
    child: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        CircularProgressIndicator(),
        SizedBox(height: 14),
        Text('جارٍ تحميل المقاولين المعتمدين...'),
      ],
    ),
  );
}

class _DirectoryState extends StatelessWidget {
  const _DirectoryState({
    required this.icon,
    required this.title,
    required this.caption,
    this.action,
    this.onAction,
  });

  final IconData icon;
  final String title, caption;
  final String? action;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(28),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 58,
            height: 58,
            decoration: BoxDecoration(
              color: BunyaColors.mint,
              borderRadius: BorderRadius.circular(20),
            ),
            child: Icon(icon, color: BunyaColors.forest, size: 29),
          ),
          const SizedBox(height: 14),
          Text(
            title,
            textAlign: TextAlign.center,
            style: const TextStyle(fontWeight: FontWeight.w900),
          ),
          const SizedBox(height: 6),
          Text(
            caption,
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: BunyaColors.muted,
              fontSize: 11,
              fontWeight: FontWeight.w700,
              height: 1.6,
            ),
          ),
          if (action != null && onAction != null) ...[
            const SizedBox(height: 16),
            SizedBox(
              width: 190,
              child: FilledButton(
                onPressed: () => onAction!(),
                child: Text(action!),
              ),
            ),
          ],
        ],
      ),
    ),
  );
}
