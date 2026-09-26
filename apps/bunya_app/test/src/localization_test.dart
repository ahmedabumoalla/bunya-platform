import 'package:bunya_app/src/localization.dart';
import 'package:bunya_app/src/theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';

Widget localizedHarness({
  required Locale locale,
  required WidgetBuilder builder,
}) {
  return MaterialApp(
    locale: locale,
    supportedLocales: supportedBunyaLocales,
    localizationsDelegates: const [
      GlobalMaterialLocalizations.delegate,
      GlobalWidgetsLocalizations.delegate,
      GlobalCupertinoLocalizations.delegate,
    ],
    home: Builder(builder: builder),
  );
}

void main() {
  group('Bunya localization contract', () {
    test('exposes every supported store locale with a visible label', () {
      expect(
        supportedBunyaLocales.map((locale) => locale.languageCode),
        orderedEquals(const ['ar', 'en', 'ur', 'hi', 'bn', 'fil']),
      );
      for (final locale in supportedBunyaLocales) {
        expect(bunyaLanguageNames[locale.languageCode], isNotEmpty);
      }
    });

    testWidgets(
      'renders English messages and statuses without Arabic fallback',
      (tester) async {
        await tester.pumpWidget(
          localizedHarness(
            locale: const Locale('en'),
            builder: (context) => Scaffold(
              body: Column(
                children: [
                  Text(context.tr('home')),
                  Text(context.localizedStatus('delivered')),
                ],
              ),
            ),
          ),
        );

        expect(find.text('Home'), findsOneWidget);
        expect(find.text('Delivered'), findsOneWidget);
      },
    );

    testWidgets('uses RTL for Arabic and Urdu and LTR for English', (
      tester,
    ) async {
      for (final entry in const [
        (Locale('ar'), TextDirection.rtl),
        (Locale('ur'), TextDirection.rtl),
        (Locale('en'), TextDirection.ltr),
      ]) {
        await tester.pumpWidget(
          localizedHarness(
            locale: entry.$1,
            builder: (context) => Text(Directionality.of(context).name),
          ),
        );
        expect(find.text(entry.$2.name), findsOneWidget);
      }
    });

    testWidgets('language control is discoverable and lists all locales', (
      tester,
    ) async {
      await tester.pumpWidget(
        localizedHarness(
          locale: const Locale('en'),
          builder: (_) => const Scaffold(body: BunyaLanguageButton()),
        ),
      );

      expect(find.byTooltip('Choose language'), findsOneWidget);
      await tester.tap(find.byTooltip('Choose language'));
      await tester.pumpAndSettle();

      expect(find.text('English'), findsOneWidget);
      await tester.scrollUntilVisible(
        find.text('Filipino'),
        120,
        scrollable: find.byType(Scrollable).last,
      );
      expect(find.text('Filipino'), findsOneWidget);
    });
  });

  test('theme preserves the Bunya brand and readable control sizing', () {
    final theme = bunyaTheme(locale: const Locale('en'));
    expect(theme.colorScheme.primary, BunyaColors.copper);
    expect(theme.colorScheme.secondary, BunyaColors.forest);
    expect(
      theme.filledButtonTheme.style?.minimumSize?.resolve({}),
      const Size.fromHeight(54),
    );
    expect(theme.navigationBarTheme.height, greaterThanOrEqualTo(48));
  });
}
