import 'package:bunya_app/src/app.dart';
import 'package:bunya_app/src/localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

Future<void> pumpUntilFound(
  WidgetTester tester,
  Finder finder, {
  Duration timeout = const Duration(seconds: 15),
}) async {
  final deadline = DateTime.now().add(timeout);
  while (finder.evaluate().isEmpty && DateTime.now().isBefore(deadline)) {
    await tester.pump(const Duration(milliseconds: 250));
  }
  expect(finder, findsWidgets);
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('Android public and provider surfaces remain usable', (
    tester,
  ) async {
    const supabaseUrl = String.fromEnvironment('SUPABASE_URL');
    const supabaseKey = String.fromEnvironment('SUPABASE_ANON_KEY');
    expect(supabaseUrl, isNotEmpty);
    expect(supabaseKey, isNotEmpty);
    await BunyaLocaleController.initialize();
    await Supabase.initialize(url: supabaseUrl, publishableKey: supabaseKey);
    await tester.pumpWidget(const BunyaApp());
    BunyaLocaleController.locale.value = const Locale('ar');
    await pumpUntilFound(tester, find.textContaining('اطلب احتياجك'));
    expect(tester.takeException(), isNull);

    final languageButton = find.byTooltip('اختر اللغة');
    expect(languageButton, findsOneWidget);
    await tester.tap(languageButton);
    await tester.pump(const Duration(milliseconds: 500));
    for (final language in bunyaLanguageNames.values) {
      expect(find.text(language), findsOneWidget);
    }
    await tester.pageBack();
    await tester.pump(const Duration(milliseconds: 300));

    await tester.tap(find.text('المقاولون'));
    await pumpUntilFound(tester, find.text('دليل المقاولين'));
    await pumpUntilFound(tester, find.textContaining('مؤسسة الأجباري'));
    final contractorSearch = find.byType(TextField);
    expect(contractorSearch, findsOneWidget);
    await tester.tap(contractorSearch);
    await tester.enterText(contractorSearch, 'خميس');
    await tester.pump(const Duration(milliseconds: 500));
    expect(find.textContaining('مؤسسة الأجباري'), findsWidgets);
    tester.testTextInput.hide();
    await tester.pageBack();
    await pumpUntilFound(tester, find.textContaining('اطلب احتياجك'));

    final pricingTab = find.bySemanticsLabel(RegExp('التسعير'));
    if (pricingTab.evaluate().isNotEmpty) {
      await tester.tap(pricingTab.last);
      await pumpUntilFound(tester, find.text('طلبات التسعير'));
      expect(tester.takeException(), isNull);

      final servicesTab = find.bySemanticsLabel(RegExp('الخدمات'));
      await tester.tap(servicesTab.last);
      await pumpUntilFound(tester, find.text('الخدمات والعمليات'));

      final notificationsTab = find.bySemanticsLabel(RegExp('التنبيهات'));
      await tester.tap(notificationsTab.last);
      await pumpUntilFound(tester, find.text('الإشعارات'));

      final accountTab = find.bySemanticsLabel(RegExp('الحساب'));
      await tester.tap(accountTab.last);
      await pumpUntilFound(tester, find.text('إعادة تعيين كلمة المرور'));

      final email = find.byWidgetPredicate(
        (widget) => widget is Text && (widget.data?.contains('@') ?? false),
        description: 'account email text',
      );
      expect(email, findsOneWidget);
      final emailWidget = tester.widget<Text>(email);
      final emailParagraph = tester.renderObject<RenderParagraph>(email);
      expect(emailWidget.textDirection, TextDirection.ltr);
      expect(emailParagraph.didExceedMaxLines, isFalse);

      final phone = find.byWidgetPredicate(
        (widget) =>
            widget is Text &&
            RegExp(r'^\+?[0-9][0-9\s().-]+$')
                .hasMatch(widget.data?.trim() ?? ''),
        description: 'account mobile text',
      );
      expect(phone, findsOneWidget);
      expect(tester.widget<Text>(phone).textDirection, TextDirection.ltr);
    }

    expect(tester.takeException(), isNull);
  });
}
