import 'dart:typed_data';

import 'package:bunya_app/src/data.dart';
import 'package:bunya_app/src/join_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

class _JoinRepository extends Fake implements BunyaRepository {
  _JoinRepository(this.policy);
  final ProviderJoinPolicy? policy;
  int policyLoads = 0;

  @override
  Future<CatalogData> loadCatalog({bool forceRefresh = false}) async =>
      const CatalogData(['الأسمنت'], []);

  @override
  Future<ProviderJoinPolicy?> loadProviderJoinPolicy() async {
    policyLoads += 1;
    return policy;
  }

  @override
  Future<JoinSubmission> submitJoinApplication({
    required String kind,
    required Map<String, String> fields,
    required List<String> regions,
    List<String> categories = const [],
    List<String> specialties = const [],
    Map<String, JoinDocument> documents = const {},
  }) async =>
      throw const JoinSubmissionException(409, 'تم تحديث سياسة الانضمام');
}

const _policy = ProviderJoinPolicy(
  id: 'policy-test',
  title: 'سياسة انضمام مزود الخدمات أو المورد',
  version: '2',
  body: ['نص السياسة المعتمدة'],
  updatedAt: '2026-09-30T12:00:00.000Z',
);

Future<void> showForm(WidgetTester tester, ProviderJoinPolicy? policy) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Directionality(
        textDirection: TextDirection.rtl,
        child: JoinApplicationScreen(
          kind: JoinKind.provider,
          repository: _JoinRepository(policy),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> scrollTo(WidgetTester tester, Finder finder) async {
  await tester.scrollUntilVisible(
    finder,
    300,
    scrollable: find.byType(Scrollable).first,
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('policy conflict refreshes policy and clears existing consent', (
    tester,
  ) async {
    await showForm(tester, _policy);
    // Supply already-selected document fixtures; this regression exercises
    // policy re-consent, not the native operating-system file picker.
    final dynamic state = tester.state(find.byType(JoinApplicationScreen));
    final fixture = JoinDocument(
      name: 'document.pdf',
      bytes: Uint8List.fromList([1]),
      mimeType: 'application/pdf',
    );
    for (final key in [
      'commercial_registration',
      'municipal_license',
      'national_address',
      'vat_certificate',
    ]) {
      state.documents[key] = fixture;
    }
    for (final entry in {
      'اسم الشركة بالعربية': 'شركة مواد البناء',
      'اسم الشركة بالإنجليزية': 'Building Materials Company',
      'رقم الجوال': '0501234567',
      'البريد الإلكتروني': 'provider@example.test',
      'المدن التي يخدمها المزود': 'حفر الباطن',
      'رابط موقع المنشأة في Google Maps': 'https://maps.google.com/?q=24,46',
    }.entries) {
      final field = find.widgetWithText(TextFormField, entry.key);
      await scrollTo(tester, field);
      await tester.enterText(field, entry.value);
    }
    await tester.testTextInput.receiveAction(TextInputAction.done);
    final category = find.widgetWithText(FilterChip, 'الأسمنت');
    await scrollTo(tester, category);
    await tester.tap(category);
    await scrollTo(tester, find.byType(Checkbox));
    await tester.tap(find.byType(Checkbox));
    await tester.pumpAndSettle();
    final submit = find.byType(FilledButton).last;
    await scrollTo(tester, submit);
    await tester.tap(submit);
    await tester.pumpAndSettle();
    final repository =
        tester
                .widget<JoinApplicationScreen>(
                  find.byType(JoinApplicationScreen),
                )
                .repository
            as _JoinRepository;
    expect(repository.policyLoads, 2);
    expect(tester.widget<Checkbox>(find.byType(Checkbox)).value, isFalse);
    expect(tester.widget<FilledButton>(submit).onPressed, isNull);
    expect(find.text('تم تحديث سياسة الانضمام'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'city Enter preserves multiword names, clears input and deduplicates',
    (tester) async {
      await showForm(tester, _policy);
      final city = find.widgetWithText(
        TextFormField,
        'المدن التي يخدمها المزود',
      );
      await scrollTo(tester, city);
      await tester.enterText(city, '  حفر   الباطن  ');
      await tester.testTextInput.receiveAction(TextInputAction.done);
      await tester.pumpAndSettle();
      expect(find.widgetWithText(InputChip, 'حفر الباطن'), findsOneWidget);
      expect(tester.widget<TextFormField>(city).controller!.text, isEmpty);
      await tester.enterText(city, 'حفر الباطن');
      await tester.testTextInput.receiveAction(TextInputAction.done);
      await tester.pumpAndSettle();
      expect(find.widgetWithText(InputChip, 'حفر الباطن'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('published policy opens modal and consent starts unchecked', (
    tester,
  ) async {
    await showForm(tester, _policy);
    final policyLink = find.widgetWithText(
      TextButton,
      'سياسة التقديم كمزود خدمة في بنية',
    );
    await scrollTo(tester, policyLink);
    final checkbox = tester.widget<Checkbox>(find.byType(Checkbox));
    expect(checkbox.value, isFalse);
    expect(
      tester.widget<FilledButton>(find.byType(FilledButton).last).onPressed,
      isNull,
    );
    await tester.tap(policyLink);
    await tester.pumpAndSettle();
    expect(find.byType(AlertDialog), findsOneWidget);
    expect(find.text('نص السياسة المعتمدة'), findsOneWidget);
    await tester.tap(find.text('إغلاق'));
    await tester.pumpAndSettle();
    expect(tester.widget<Checkbox>(find.byType(Checkbox)).value, isFalse);
    expect(tester.takeException(), isNull);
  });

  testWidgets('no published policy blocks submission and offers retry', (
    tester,
  ) async {
    await showForm(tester, null);
    final retry = find.widgetWithText(TextButton, 'إعادة تحميل السياسة');
    await scrollTo(tester, retry);
    expect(
      find.text('سياسة الانضمام غير منشورة حاليًا. يرجى المحاولة لاحقًا.'),
      findsOneWidget,
    );
    expect(find.byType(Checkbox), findsNothing);
    expect(
      tester.widget<FilledButton>(find.byType(FilledButton).last).onPressed,
      isNull,
    );
    expect(tester.takeException(), isNull);
  });
}
