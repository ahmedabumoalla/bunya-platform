import 'package:flutter/material.dart';

import 'data.dart';
import 'product_image_urls.dart';
import 'theme.dart';

class ProductVisual extends StatelessWidget {
  const ProductVisual({super.key, required this.product, this.image});

  final Product product;
  final CatalogProductImage? image;

  @override
  Widget build(BuildContext context) {
    final selectedImage = image ?? product.primaryImage;
    return ColoredBox(
      color: const Color(0xFFF0E9E0),
      child: selectedImage?.url == null
          ? Center(
              child: Icon(
                Icons.domain_rounded,
                size: 52,
                color: BunyaColors.copper.withValues(alpha: .45),
              ),
            )
          : FastProductImage(
              imageUrl: selectedImage!.url!,
              fallbackUrl: selectedImage.fallbackUrl,
              cacheKey: selectedImage.cacheKey,
            ),
    );
  }
}

class ProductSheet extends StatefulWidget {
  const ProductSheet({super.key, required this.product});

  final Product product;

  @override
  State<ProductSheet> createState() => _ProductSheetState();
}

class _ProductSheetState extends State<ProductSheet> {
  var activeImage = 0;

  Product get product => widget.product;

  @override
  Widget build(BuildContext context) {
    final media = MediaQuery.of(context);
    final deliveryRegions = product.delivery.regions.isNotEmpty
        ? product.delivery.regions
        : product.regions.map((region) => region.city).toList();

    return SafeArea(
      top: false,
      child: Container(
        constraints: BoxConstraints(maxHeight: media.size.height * .94),
        decoration: const BoxDecoration(
          color: BunyaColors.surface,
          borderRadius: BorderRadius.vertical(top: Radius.circular(30)),
        ),
        clipBehavior: Clip.antiAlias,
        child: Column(
          children: [
            Expanded(
              child: ListView(
                padding: EdgeInsets.zero,
                children: [
                  _ProductGallery(
                    product: product,
                    activeImage: activeImage,
                    onImageChanged: (value) =>
                        setState(() => activeImage = value),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(18, 18, 18, 28),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Wrap(
                          spacing: 7,
                          runSpacing: 7,
                          children: [
                            _MetaTag(
                              label: product.category,
                              color: BunyaColors.copper,
                            ),
                            _MetaTag(
                              label: product.availabilityStatus,
                              color: BunyaColors.forest,
                            ),
                            if (product.isNew)
                              const _MetaTag(
                                label: 'جديد',
                                color: BunyaColors.copperDark,
                              ),
                          ],
                        ),
                        const SizedBox(height: 10),
                        Text(
                          product.name,
                          style: Theme.of(context).textTheme.headlineSmall
                              ?.copyWith(
                                fontWeight: FontWeight.w900,
                                height: 1.35,
                              ),
                        ),
                        const SizedBox(height: 7),
                        Text(
                          product.shortDescription.isNotEmpty
                              ? product.shortDescription
                              : product.description,
                          style: const TextStyle(
                            color: BunyaColors.muted,
                            height: 1.75,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(height: 12),
                        Wrap(
                          spacing: 7,
                          runSpacing: 7,
                          children: [
                            if (product.sku.isNotEmpty)
                              _MetaTag(label: 'رمز المنتج: ${product.sku}'),
                            _MetaTag(label: 'العرض: ${product.offerType}'),
                            const _MetaTag(
                              label: 'السعر والضريبة يُحدَّدان في عرض السعر',
                            ),
                          ],
                        ),
                        const SizedBox(height: 18),
                        _ProductFacts(product: product),
                        const SizedBox(height: 6),
                        _ProductSection(
                          icon: Icons.description_outlined,
                          title: 'عن المنتج',
                          child: Text(
                            product.fullDescription.isNotEmpty
                                ? product.fullDescription
                                : product.description.isNotEmpty
                                ? product.description
                                : 'منتج معتمد ضمن كتالوج بُنية.',
                            style: const TextStyle(
                              color: BunyaColors.muted,
                              height: 1.8,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                        _ProductSection(
                          icon: Icons.fact_check_outlined,
                          title: 'المواصفات الفنية',
                          child: product.specifications.isEmpty
                              ? const _SectionEmpty(
                                  text: 'لا توجد مواصفات إضافية مسجلة.',
                                )
                              : Column(
                                  children: product.specifications
                                      .map((value) => _DetailLine(value: value))
                                      .toList(),
                                ),
                        ),
                        _ProductSection(
                          icon: Icons.straighten_rounded,
                          title: 'الوحدات والقياسات',
                          child: _Measurements(product: product),
                        ),
                        _ProductSection(
                          icon: Icons.tune_rounded,
                          title: 'الخيارات والفئات',
                          child: product.variants.isEmpty
                              ? const _SectionEmpty(
                                  text: 'هذا المنتج لا يحتاج خيارات إضافية.',
                                )
                              : Column(
                                  children: product.variants.map((variant) {
                                    final attributes = variant
                                        .attributes
                                        .entries
                                        .map(
                                          (entry) =>
                                              '${entry.key}: ${entry.value}',
                                        )
                                        .join(' · ');
                                    return _DetailTile(
                                      title: variant.name,
                                      value: attributes,
                                    );
                                  }).toList(),
                                ),
                        ),
                        _ProductSection(
                          icon: Icons.local_shipping_outlined,
                          title: 'التوفر والتوصيل',
                          child: _DeliveryDetails(
                            product: product,
                            regions: deliveryRegions,
                          ),
                        ),
                        _ProductSection(
                          icon: Icons.verified_user_outlined,
                          title: 'الضمان وشروط الطلب',
                          child: _WarrantyAndTerms(product: product),
                        ),
                        const _PricingNotice(),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            Container(
              padding: const EdgeInsets.fromLTRB(18, 12, 18, 12),
              decoration: const BoxDecoration(
                color: BunyaColors.surface,
                border: Border(top: BorderSide(color: BunyaColors.line)),
                boxShadow: [
                  BoxShadow(
                    color: Color(0x123C2B20),
                    blurRadius: 18,
                    offset: Offset(0, -6),
                  ),
                ],
              ),
              child: FilledButton.icon(
                onPressed: () => Navigator.pop(context, true),
                icon: const Icon(Icons.receipt_long_rounded),
                label: const Text('أضف إلى طلب عرض سعر'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ProductGallery extends StatelessWidget {
  const _ProductGallery({
    required this.product,
    required this.activeImage,
    required this.onImageChanged,
  });

  final Product product;
  final int activeImage;
  final ValueChanged<int> onImageChanged;

  @override
  Widget build(BuildContext context) => Stack(
    children: [
      Column(
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
            height: 278,
            child: PageView.builder(
              itemCount: product.images.isEmpty ? 1 : product.images.length,
              onPageChanged: onImageChanged,
              itemBuilder: (_, index) => ProductVisual(
                product: product,
                image: product.images.isEmpty ? null : product.images[index],
              ),
            ),
          ),
          if (product.images.length > 1)
            Padding(
              padding: const EdgeInsets.only(top: 10),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: List.generate(
                  product.images.length,
                  (index) => AnimatedContainer(
                    duration: const Duration(milliseconds: 180),
                    width: index == activeImage ? 22 : 7,
                    height: 7,
                    margin: const EdgeInsets.symmetric(horizontal: 3),
                    decoration: BoxDecoration(
                      color: index == activeImage
                          ? BunyaColors.copper
                          : BunyaColors.line,
                      borderRadius: BorderRadius.circular(9),
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
      Positioned(
        top: 17,
        left: 15,
        child: Material(
          color: BunyaColors.surface.withValues(alpha: .92),
          shape: const CircleBorder(),
          child: IconButton(
            tooltip: 'إغلاق',
            onPressed: () => Navigator.pop(context),
            icon: const Icon(Icons.close_rounded),
          ),
        ),
      ),
    ],
  );
}

class _ProductFacts extends StatelessWidget {
  const _ProductFacts({required this.product});

  final Product product;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) {
      final width = (constraints.maxWidth - 10) / 2;
      return Wrap(
        spacing: 10,
        runSpacing: 10,
        children: [
          SizedBox(
            width: width,
            child: _Fact(
              icon: Icons.inventory_2_outlined,
              title: 'الوحدة الأساسية',
              value: product.unit,
            ),
          ),
          SizedBox(
            width: width,
            child: _Fact(
              icon: Icons.check_circle_outline_rounded,
              title: 'التوفر',
              value: product.availability,
            ),
          ),
          SizedBox(
            width: width,
            child: _Fact(
              icon: Icons.schedule_rounded,
              title: 'مدة التجهيز',
              value: product.leadTime,
            ),
          ),
          SizedBox(
            width: width,
            child: _Fact(
              icon: Icons.local_shipping_outlined,
              title: 'مدة التوصيل',
              value: product.deliveryWindow,
            ),
          ),
        ],
      );
    },
  );
}

class _Measurements extends StatelessWidget {
  const _Measurements({required this.product});

  final Product product;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      if (product.units.isNotEmpty)
        Wrap(
          spacing: 7,
          runSpacing: 7,
          children: product.units
              .map(
                (unit) =>
                    _ProductChip(label: unit, emphasized: unit == product.unit),
              )
              .toList(),
        ),
      if (product.units.isNotEmpty && product.measurements.isNotEmpty)
        const SizedBox(height: 10),
      if (product.measurements.isEmpty)
        const _SectionEmpty(text: 'لا توجد قياسات إضافية لهذا المنتج.')
      else
        Wrap(
          spacing: 7,
          runSpacing: 7,
          children: product.measurements
              .map(
                (value) => _ProductChip(
                  label:
                      '${value.label} · ${value.unit}${value.isDefault ? ' · افتراضي' : ''}',
                ),
              )
              .toList(),
        ),
    ],
  );
}

class _DeliveryDetails extends StatelessWidget {
  const _DeliveryDetails({required this.product, required this.regions});

  final Product product;
  final List<String> regions;

  @override
  Widget build(BuildContext context) => Column(
    children: [
      _DetailTile(
        title: 'حالة التوصيل',
        value: product.deliveryLabel.isNotEmpty
            ? product.deliveryLabel
            : product.delivery.available
            ? 'متاح'
            : 'حسب الموقع',
      ),
      _DetailTile(
        title: 'أقصى مدة',
        value: product.delivery.maximumDuration.isEmpty
            ? product.deliveryWindow
            : product.delivery.maximumDuration,
      ),
      _DetailTile(
        title: 'أقصى مسافة',
        value: product.delivery.maximumDistanceKm == null
            ? 'حسب الموقع'
            : '${_number(product.delivery.maximumDistanceKm!)} كم',
      ),
      _DetailTile(
        title: 'تكلفة المسافة',
        value: product.delivery.pricePerKm == null
            ? 'تحدد في عرض السعر'
            : '${_number(product.delivery.pricePerKm!)} ر.س/كم',
      ),
      const SizedBox(height: 9),
      if (regions.isEmpty)
        const _SectionEmpty(text: 'تُراجع تغطية الموقع عند طلب عرض السعر.')
      else
        Wrap(
          spacing: 7,
          runSpacing: 7,
          children: regions
              .map(
                (region) => _ProductChip(
                  label: region,
                  icon: Icons.location_on_outlined,
                ),
              )
              .toList(),
        ),
      if (product.delivery.notes.isNotEmpty ||
          product.deliveryNotes.isNotEmpty) ...[
        const SizedBox(height: 10),
        _SectionNote(
          text: product.delivery.notes.isNotEmpty
              ? product.delivery.notes
              : product.deliveryNotes,
        ),
      ],
    ],
  );
}

class _WarrantyAndTerms extends StatelessWidget {
  const _WarrantyAndTerms({required this.product});

  final Product product;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      _DetailTile(
        title: product.warranty.label,
        value: product.warranty.duration,
        highlighted: product.warranty.available,
      ),
      if (product.warranty.details.isNotEmpty)
        Padding(
          padding: const EdgeInsets.only(top: 4),
          child: Text(
            product.warranty.details,
            style: const TextStyle(
              color: BunyaColors.muted,
              height: 1.7,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
      const SizedBox(height: 10),
      Wrap(
        spacing: 7,
        runSpacing: 7,
        children: [
          _ProductChip(label: 'نوع العرض: ${product.offerType}'),
          if (product.rentalDuration.isNotEmpty)
            _ProductChip(label: 'مدة التأجير: ${product.rentalDuration}'),
          _ProductChip(
            label: product.minimumOrder == null
                ? 'الحد الأدنى: حسب المشروع'
                : 'الحد الأدنى: ${_number(product.minimumOrder!)} ${product.unit}',
          ),
          _ProductChip(
            label: product.stockQuantity == null
                ? 'المخزون: ${product.availabilityStatus}'
                : 'المخزون: ${_number(product.stockQuantity!)} ${product.unit}',
          ),
        ],
      ),
    ],
  );
}

class _PricingNotice extends StatelessWidget {
  const _PricingNotice();

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(15),
    decoration: BoxDecoration(
      color: BunyaColors.mint,
      borderRadius: BorderRadius.circular(18),
    ),
    child: const Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(Icons.price_check_rounded, color: BunyaColors.forest),
        SizedBox(width: 10),
        Expanded(
          child: Text(
            'السعر النهائي يظهر بعد جمع عروض المزودين ومقارنة التكلفة والتوصيل.',
            style: TextStyle(
              color: BunyaColors.forest,
              height: 1.65,
              fontWeight: FontWeight.w800,
            ),
          ),
        ),
      ],
    ),
  );
}

class _ProductSection extends StatelessWidget {
  const _ProductSection({
    required this.icon,
    required this.title,
    required this.child,
  });

  final IconData icon;
  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(vertical: 16),
    decoration: const BoxDecoration(
      border: Border(bottom: BorderSide(color: BunyaColors.line)),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Container(
              width: 34,
              height: 34,
              decoration: BoxDecoration(
                color: BunyaColors.sand,
                borderRadius: BorderRadius.circular(11),
              ),
              child: Icon(icon, size: 18, color: BunyaColors.copper),
            ),
            const SizedBox(width: 9),
            Text(title, style: const TextStyle(fontWeight: FontWeight.w900)),
          ],
        ),
        const SizedBox(height: 12),
        child,
      ],
    ),
  );
}

class _Fact extends StatelessWidget {
  const _Fact({required this.icon, required this.title, required this.value});

  final IconData icon;
  final String title, value;

  @override
  Widget build(BuildContext context) => Container(
    constraints: const BoxConstraints(minHeight: 90),
    padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(
      color: BunyaColors.sand,
      borderRadius: BorderRadius.circular(17),
      border: Border.all(color: BunyaColors.line.withValues(alpha: .75)),
    ),
    child: Row(
      children: [
        Container(
          width: 34,
          height: 34,
          decoration: BoxDecoration(
            color: BunyaColors.surface,
            borderRadius: BorderRadius.circular(11),
          ),
          child: Icon(icon, color: BunyaColors.copper, size: 18),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: const TextStyle(
                  fontSize: 9,
                  color: BunyaColors.muted,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                value,
                maxLines: 3,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontSize: 11,
                  height: 1.45,
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

class _MetaTag extends StatelessWidget {
  const _MetaTag({required this.label, this.color = BunyaColors.muted});

  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
    decoration: BoxDecoration(
      color: color.withValues(alpha: .09),
      borderRadius: BorderRadius.circular(20),
      border: Border.all(color: color.withValues(alpha: .18)),
    ),
    child: Text(
      label,
      style: TextStyle(color: color, fontSize: 10, fontWeight: FontWeight.w900),
    ),
  );
}

class _ProductChip extends StatelessWidget {
  const _ProductChip({required this.label, this.icon, this.emphasized = false});

  final String label;
  final IconData? icon;
  final bool emphasized;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
    decoration: BoxDecoration(
      color: emphasized ? BunyaColors.mint : BunyaColors.sand,
      borderRadius: BorderRadius.circular(12),
      border: Border.all(color: BunyaColors.line.withValues(alpha: .75)),
    ),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (icon != null) ...[
          Icon(icon, size: 14, color: BunyaColors.copper),
          const SizedBox(width: 4),
        ],
        Flexible(
          child: Text(
            label,
            style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w800),
          ),
        ),
      ],
    ),
  );
}

class _DetailLine extends StatelessWidget {
  const _DetailLine({required this.value});

  final String value;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 9),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 24,
          height: 24,
          decoration: BoxDecoration(
            color: BunyaColors.mint,
            borderRadius: BorderRadius.circular(8),
          ),
          child: const Icon(
            Icons.check_rounded,
            size: 15,
            color: BunyaColors.forest,
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            value,
            style: const TextStyle(
              color: BunyaColors.muted,
              height: 1.65,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
      ],
    ),
  );
}

class _DetailTile extends StatelessWidget {
  const _DetailTile({
    required this.title,
    required this.value,
    this.highlighted = false,
  });

  final String title, value;
  final bool highlighted;

  @override
  Widget build(BuildContext context) => Container(
    margin: const EdgeInsets.only(bottom: 7),
    padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 9),
    decoration: BoxDecoration(
      color: highlighted ? BunyaColors.mint : BunyaColors.sand,
      borderRadius: BorderRadius.circular(13),
    ),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Text(
            title,
            style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w800),
          ),
        ),
        const SizedBox(width: 10),
        Flexible(
          child: Text(
            value,
            textAlign: TextAlign.end,
            style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w900),
          ),
        ),
      ],
    ),
  );
}

class _SectionEmpty extends StatelessWidget {
  const _SectionEmpty({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) => Container(
    width: double.infinity,
    padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(
      color: BunyaColors.sand.withValues(alpha: .65),
      borderRadius: BorderRadius.circular(13),
      border: Border.all(color: BunyaColors.line),
    ),
    child: Text(
      text,
      style: const TextStyle(
        color: BunyaColors.muted,
        fontSize: 11,
        fontWeight: FontWeight.w700,
      ),
    ),
  );
}

class _SectionNote extends StatelessWidget {
  const _SectionNote({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) => Container(
    width: double.infinity,
    padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(
      color: BunyaColors.mint,
      borderRadius: BorderRadius.circular(13),
    ),
    child: Text(
      text,
      style: const TextStyle(
        color: BunyaColors.forest,
        height: 1.65,
        fontSize: 11,
        fontWeight: FontWeight.w700,
      ),
    ),
  );
}

String _number(double value) => value % 1 == 0
    ? value.toInt().toString()
    : value
          .toStringAsFixed(2)
          .replaceFirst(RegExp(r'0+$'), '')
          .replaceFirst(RegExp(r'\.$'), '');
