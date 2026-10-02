import 'package:bunya_app/src/app.dart';
import 'package:bunya_app/src/data.dart';
import 'package:bunya_app/src/product_details.dart';
import 'package:bunya_app/src/theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

Product product({
  required String id,
  required String name,
  required String category,
  String region = 'الرياض',
  bool isNew = false,
}) => Product(
  id: id,
  sku: id,
  name: name,
  category: category,
  unit: 'طن',
  shortDescription: 'مادة بناء معتمدة مناسبة للمشاريع السكنية والتجارية.',
  description: 'وصف المنتج',
  fullDescription: 'الوصف الكامل للمنتج',
  availability: 'available',
  availabilityStatus: 'متوفر',
  leadTime: 'يوم واحد',
  deliveryLabel: 'متاح',
  deliveryWindow: 'خلال 24 ساعة',
  deliveryNotes: 'يحدد حسب الموقع',
  offerType: 'بيع',
  minimumOrder: 1,
  stockQuantity: 50,
  rentalDuration: '',
  images: const [],
  units: const ['طن'],
  measurements: const [],
  variants: const [],
  specifications: const [],
  regions: [ProductRegion(city: region, scope: 'داخل المنطقة')],
  warranty: const ProductWarrantyInfo(
    label: 'ضمان المورد',
    duration: 'حسب العرض',
    details: 'تراجع مع المورد',
    available: true,
  ),
  delivery: ProductDeliveryInfo(
    available: true,
    maximumDuration: 'يومان',
    pricePerKm: null,
    maximumDistanceKm: null,
    regions: [region],
    notes: 'حسب الموقع',
  ),
  isNew: isNew,
);

Widget catalogHarness(List<Product> products) => MaterialApp(
  theme: bunyaTheme(),
  home: Scaffold(
    body: CatalogTab(
      catalog: Future.value(CatalogData(const ['أسمنت', 'حديد'], products)),
      onProduct: (_) {},
      onRefresh: () {},
    ),
  ),
);

void main() {
  testWidgets(
    'product detail explains quote-stage pricing without catalog tax claims',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(
        MaterialApp(
          theme: bunyaTheme(),
          home: Scaffold(
            body: ProductSheet(
              product: product(
                id: 'test',
                name: 'منتج تجريبي',
                category: 'أسمنت',
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(
        find.text('السعر والضريبة يُحدَّدان في عرض السعر'),
        findsOneWidget,
      );
      expect(find.text('السعر شامل الضريبة'), findsNothing);
      expect(find.text('الضريبة تضاف لاحقًا'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  final products = [
    product(id: 'cement', name: 'أسمنت مقاوم', category: 'أسمنت', isNew: true),
    product(
      id: 'steel',
      name: 'حديد تسليح',
      category: 'حديد',
      region: 'مكة المكرمة',
    ),
    product(id: 'steel-2', name: 'شبك حديد', category: 'حديد'),
    product(id: 'cement-2', name: 'أسمنت تشطيب', category: 'أسمنت'),
  ];

  testWidgets('catalog search and view controls update visible products', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(catalogHarness(products));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('catalog-list')), findsOneWidget);
    expect(find.byType(ProductListCard), findsAtLeastNWidgets(3));
    expect(
      tester
          .widget<Text>(find.text('كل احتياج مشروعك، في بحث واحد'))
          .style
          ?.fontSize,
      20,
    );

    await tester.enterText(
      find.byKey(const Key('catalog-search-field')),
      'حديد تسليح',
    );
    await tester.pump();
    expect(find.byType(ProductListCard), findsOneWidget);
    expect(
      find.descendant(
        of: find.byType(ProductListCard),
        matching: find.text('حديد تسليح'),
      ),
      findsOneWidget,
    );

    await tester.ensureVisible(find.byKey(const Key('catalog-view-toggle')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('catalog-view-toggle')));
    await tester.pump();
    expect(find.byKey(const Key('catalog-grid')), findsOneWidget);
    expect(find.byType(ProductCard), findsOneWidget);
  });

  testWidgets('region menu contains every Saudi region and filters products', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(catalogHarness(products));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('catalog-region-menu')));
    await tester.pumpAndSettle();
    expect(find.text('الرياض'), findsOneWidget);
    expect(find.text('مكة المكرمة'), findsOneWidget);
    expect(find.text('الجوف'), findsOneWidget);

    await tester.tap(find.text('مكة المكرمة'));
    await tester.pumpAndSettle();
    expect(find.byType(ProductListCard), findsOneWidget);
    expect(find.text('حديد تسليح'), findsOneWidget);

    await tester.tap(find.byKey(const Key('catalog-region-menu')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('كل المناطق').last);
    await tester.pumpAndSettle();
    expect(find.byType(ProductListCard), findsAtLeastNWidgets(3));
  });

  testWidgets('desktop catalog keeps cards at a readable maximum width', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1440, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(catalogHarness(products));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('catalog-grid-button')));
    await tester.pump();
    expect(tester.getSize(find.byType(ProductCard).first).width, lessThan(340));
    expect(find.text('كل احتياج مشروعك، في بحث واحد'), findsOneWidget);
  });
}
