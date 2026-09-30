import 'dart:convert';
import 'dart:typed_data';

import 'package:bunya_app/src/contractor_join_fields.dart';
import 'package:bunya_app/src/data.dart';
import 'package:bunya_app/src/join_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

const policy = ProviderJoinPolicy(
  id: 'contractor-policy',
  title: 'سياسة المقاولين',
  version: '3',
  body: ['سياسة انضمام المقاول المعتمدة'],
  updatedAt: '2026-10-01T00:00:00Z',
);
final pdf = JoinDocument(
  name: 'document.pdf',
  bytes: Uint8List.fromList([37, 80, 68, 70]),
  mimeType: 'application/pdf',
);
final video = JoinDocument(
  name: 'work.mov',
  bytes: Uint8List.fromList([1, 2, 3, 4]),
  mimeType: 'video/quicktime',
);

class _Repository extends Fake implements BunyaRepository {
  _Repository({this.published = true, this.conflict = false});
  final bool published, conflict;
  int loads = 0;
  Map<String, String>? submitted;
  Map<String, JoinDocument>? attachments;
  @override
  Future<ProviderJoinPolicy?> loadContractorJoinPolicy() async {
    loads++;
    return published ? policy : null;
  }

  @override
  Future<JoinSubmission> submitJoinApplication({
    required String kind,
    required Map<String, String> fields,
    required List<String> regions,
    List<String> categories = const [],
    List<String> specialties = const [],
    Map<String, JoinDocument> documents = const {},
    void Function(double progress)? onUploadProgress,
  }) async {
    expect(kind, 'contractor');
    submitted = fields;
    attachments = Map.of(documents);
    if (conflict) throw const JoinSubmissionException(409, 'تم تحديث السياسة');
    return const JoinSubmission(
      id: 'contractor-application',
      status: 'pending',
    );
  }
}

Future<void> showForm(WidgetTester tester, BunyaRepository repository) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Directionality(
        textDirection: TextDirection.rtl,
        child: JoinApplicationScreen(
          kind: JoinKind.contractor,
          repository: repository,
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

Future<void> fillForm(WidgetTester tester, {bool individual = false}) async {
  for (final entry in {
    individual ? 'الاسم بالعربية' : 'اسم الشركة بالعربية': '  مقاول   البناء  ',
    individual ? 'الاسم بالإنجليزية' : 'اسم الشركة بالإنجليزية':
        '  Example   Contractor  ',
    'رقم الجوال': '0501234567',
    'البريد الإلكتروني': 'contractor@example.test',
    'المدن التي يعمل بها المقاول': '  حفر   الباطن  ',
    'التخصصات': 'بناء عظم، ترميم',
  }.entries) {
    final field = find.widgetWithText(TextFormField, entry.key);
    await scrollTo(tester, field);
    await tester.enterText(field, entry.value);
    if (entry.key == 'المدن التي يعمل بها المقاول') {
      await tester.testTextInput.receiveAction(TextInputAction.done);
      await tester.pumpAndSettle();
    }
  }
}

void main() {
  test(
    'contractor document rules keep media type isolation and 20-file limit',
    () {
      final company = {
        for (final key in contractorCompanyDocuments.keys.where(
          (key) => key != 'company_profile',
        ))
          key: pdf,
      };
      expect(validateContractorDocuments('company', company), isNull);
      expect(
        validateContractorDocuments('company', {
          ...company,
          'company_profile': pdf,
        }),
        isNull,
      );
      expect(
        validateContractorDocuments('individual', {'national_id': pdf}),
        isNotNull,
      );
      final files = {
        'national_id': pdf,
        for (var i = 0; i < 20; i++) newContractorPortfolioKey(): video,
      };
      expect(validateContractorDocuments('individual', files), isNull);
      expect(
        validateContractorDocuments('individual', {
          ...files,
          newContractorPortfolioKey(): video,
        }),
        isNotNull,
      );
      expect(
        validateContractorDocuments('individual', {
          'national_id': video,
          newContractorPortfolioKey(): video,
        }),
        isNotNull,
      );
      expect(
        validateContractorDocuments('individual', {
          'national_id': pdf,
          newContractorPortfolioKey(): pdf,
        }),
        isNotNull,
      );
      expect(
        contractorFileMime('WORK.MOV', portfolio: true),
        'video/quicktime',
      );
      expect(contractorFileMime('WORK.MOV'), isNull);
      expect(contractorDocumentType(newContractorPortfolioKey()), 'portfolio');
    },
  );

  testWidgets(
    'company submission normalizes bilingual names and Enter cities with blank optional username',
    (tester) async {
      final repository = _Repository();
      await showForm(tester, repository);
      final dynamic state = tester.state(find.byType(JoinApplicationScreen));
      for (final key in contractorCompanyDocuments.keys.where(
        (key) => key != 'company_profile',
      )) {
        state.documents[key] = pdf;
      }
      await fillForm(tester);
      expect(state.serviceCities, ['حفر الباطن']);
      await scrollTo(tester, find.byType(Checkbox));
      await tester.tap(find.byType(Checkbox));
      await tester.pumpAndSettle();
      final submit = find.byType(FilledButton).last;
      await scrollTo(tester, submit);
      await tester.tap(submit);
      await tester.pumpAndSettle();
      expect(repository.submitted?['contractorType'], 'company');
      expect(repository.submitted?['contractorNameEn'], 'Example Contractor');
      expect(repository.submitted?['username'], '');
      expect(repository.submitted?['contactName'], '');
      expect(repository.submitted?['policyId'], policy.id);
      expect(repository.attachments?.length, 4);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'individual hides company contact, retires company documents and resets consent on conflict',
    (tester) async {
      final repository = _Repository(conflict: true);
      await showForm(tester, repository);
      final dynamic state = tester.state(find.byType(JoinApplicationScreen));
      state.documents['commercial_registration'] = pdf;
      await tester.tap(find.text('فرد'));
      await tester.pumpAndSettle();
      expect(state.documents, isEmpty);
      expect(
        find.widgetWithText(TextFormField, 'اسم المسؤول (اختياري)'),
        findsNothing,
      );
      state.documents['national_id'] = pdf;
      state.documents[newContractorPortfolioKey()] = video;
      await fillForm(tester, individual: true);
      final policyLink = find.widgetWithText(
        TextButton,
        'سياسة التقديم كمقاول في بنية',
      );
      await scrollTo(tester, policyLink);
      await tester.tap(policyLink);
      await tester.pumpAndSettle();
      expect(find.text('سياسة انضمام المقاول المعتمدة'), findsOneWidget);
      await tester.tap(find.text('إغلاق'));
      await tester.pumpAndSettle();
      await tester.tap(find.byType(Checkbox));
      await tester.pumpAndSettle();
      final submit = find.byType(FilledButton).last;
      await scrollTo(tester, submit);
      await tester.tap(submit);
      await tester.pumpAndSettle();
      expect(repository.submitted?['contractorType'], 'individual');
      expect(repository.attachments?.length, 2);
      expect(repository.loads, 2);
      expect(tester.widget<Checkbox>(find.byType(Checkbox)).value, isFalse);
      expect(tester.widget<FilledButton>(submit).onPressed, isNull);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'unpublished contractor policy blocks submission and offers retry',
    (tester) async {
      await showForm(tester, _Repository(published: false));
      await scrollTo(
        tester,
        find.widgetWithText(TextButton, 'إعادة تحميل السياسة'),
      );
      expect(find.byType(Checkbox), findsNothing);
      expect(
        tester.widget<FilledButton>(find.byType(FilledButton).last).onPressed,
        isNull,
      );
    },
  );

  test('contractor init matches portfolio grants by unique key and final request contains metadata only', () async {
    final portfolioKey = newContractorPortfolioKey();
    final secondPortfolioKey = newContractorPortfolioKey();
    final documents = {
      'national_id': pdf,
      portfolioKey: video,
      secondPortfolioKey: video,
    };
    String? idempotency;
    var uploaded = 0;
    var finalized = false;
    final client = MockClient((request) async {
      if (request.url.path.endsWith('/contractor/uploads')) {
        idempotency = request.headers['idempotency-key'];
        expect(request.body, contains('"documentType":"portfolio"'));
        expect(request.body, contains('"documentKey":"$portfolioKey"'));
        expect(request.body, isNot(contains('filename=')));
        return http.Response(
          jsonEncode({
            'uploadToken': 'contractor-token',
            'endpoint': 'https://storage.example/upload',
            'bucket': 'join-applications',
            'files': [
              for (final key in documents.keys)
                {
                  'documentKey': key,
                  'documentType': contractorDocumentType(key),
                  'path': '$key.dat',
                  'token': 'signed',
                },
            ],
          }),
          200,
        );
      }
      if (request.url.host == 'storage.example') {
        if (request.method == 'POST') {
          return http.Response(
            '',
            201,
            headers: {'location': '/upload/$uploaded'},
          );
        }
        uploaded++;
        return http.Response('', 204, headers: {'upload-offset': '4'});
      }
      expect(request.url.path, '/api/public/join/contractor');
      expect(uploaded, 3);
      expect(request.headers['idempotency-key'], idempotency);
      expect(request.body, contains('contractor-token'));
      expect(request.body, isNot(contains('filename=')));
      finalized = true;
      return http.Response(
        '{"applicationId":"application","status":"pending"}',
        200,
      );
    });
    final supabase = SupabaseClient('https://example.supabase.co', 'test-anon');
    await http.runWithClient(
      () => BunyaRepository(supabase).submitJoinApplication(
        kind: 'contractor',
        fields: {'contractorType': 'individual', 'policyAccepted': 'true'},
        regions: [],
        documents: documents,
      ),
      () => client,
    );
    expect(finalized, isTrue);
    await supabase.dispose();
  });
}
