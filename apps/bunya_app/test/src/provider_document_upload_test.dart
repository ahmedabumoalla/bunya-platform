import 'dart:convert';
import 'dart:typed_data';

import 'package:bunya_app/src/data.dart';
import 'package:bunya_app/src/provider_document_upload.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

class _RangeDocument extends JoinDocument {
  _RangeDocument(this.documentLength)
    : super(name: 'scan.pdf', bytes: Uint8List(0), mimeType: 'application/pdf');

  final int documentLength;
  final ranges = <(int, int)>[];

  @override
  int get size => documentLength;

  @override
  Stream<List<int>> openRead([int start = 0, int? end]) {
    expect(end, isNotNull, reason: 'No whole-document reads');
    expect(end! - start, lessThanOrEqualTo(providerUploadChunkSize));
    ranges.add((start, end));
    return Stream.value(Uint8List(end - start));
  }
}

void main() {
  test(
    '13MiB document uploads in bounded chunks and recovers a lost response',
    () async {
      final document = _RangeDocument(13 * 1024 * 1024);
      var uploaded = 0;
      var headRequests = 0;
      var lostResponse = true;
      final progress = <int>[];
      final client = MockClient((request) async {
        expect(request.headers['x-signature'], 'signed-only');
        expect(request.headers['tus-resumable'], '1.0.0');
        if (request.method == 'POST') {
          expect(request.headers['upload-length'], '${document.size}');
          expect(request.headers['upload-metadata'], contains('bucketName '));
          return http.Response('', 201, headers: {'location': '/upload/one'});
        }
        if (request.method == 'HEAD') {
          headRequests++;
          return http.Response(
            '',
            200,
            headers: {'upload-offset': '$uploaded'},
          );
        }
        expect(request.headers['upload-offset'], '$uploaded');
        expect(
          request.bodyBytes.length,
          lessThanOrEqualTo(providerUploadChunkSize),
        );
        uploaded += request.bodyBytes.length;
        if (lostResponse) {
          lostResponse = false;
          throw http.ClientException('Connection dropped after commit');
        }
        return http.Response('', 204, headers: {'upload-offset': '$uploaded'});
      });
      await uploadProviderDocument(
        client: client,
        endpoint: Uri.parse('https://storage.example/upload'),
        bucket: 'join-applications',
        path: 'provider/one/scan.pdf',
        token: 'signed-only',
        document: document,
        onProgress: progress.add,
      );
      expect(uploaded, document.size);
      expect(headRequests, 1);
      expect(document.ranges, [
        (0, 6291456),
        (6291456, 12582912),
        (12582912, 13631488),
      ]);
      expect(progress.last, document.size);
    },
  );

  test('empty documents fail before any storage request', () async {
    await expectLater(
      uploadProviderDocument(
        client: MockClient((_) async => fail('Unexpected request')),
        endpoint: Uri.parse('https://storage.example/upload'),
        bucket: 'join-applications',
        path: 'scan.pdf',
        token: 'token',
        document: _RangeDocument(0),
      ),
      throwsException,
    );
  });

  test('signed token is never sent to a different Location origin', () async {
    var requests = 0;
    await expectLater(
      uploadProviderDocument(
        client: MockClient((_) async {
          requests++;
          return http.Response(
            '',
            201,
            headers: {'location': 'https://other.example/upload'},
          );
        }),
        endpoint: Uri.parse('https://storage.example/upload'),
        bucket: 'join-applications',
        path: 'scan.pdf',
        token: 'token',
        document: _RangeDocument(1),
      ),
      throwsException,
    );
    expect(requests, 1);
  });

  test(
    'provider init and final carry metadata only with matching idempotency',
    () async {
      final documents = {
        for (final type in [
          'commercial_registration',
          'municipal_license',
          'national_address',
          'vat_certificate',
        ])
          type: JoinDocument(
            name: '$type.pdf',
            bytes: Uint8List.fromList([37, 80, 68, 70]),
            mimeType: 'application/pdf',
          ),
      };
      String? key;
      var completed = 0;
      var finalized = false;
      final client = MockClient((request) async {
        if (request.url.path.endsWith('/provider/uploads')) {
          key = request.headers['idempotency-key'];
          expect(key, isNotEmpty);
          expect(request.body, contains('name="documents"'));
          expect(request.body, contains('"size":4'));
          expect(request.body, isNot(contains('filename=')));
          return http.Response(
            jsonEncode({
              'uploadToken': 'application-token',
              'endpoint': 'https://storage.example/upload',
              'bucket': 'join-applications',
              'files': [
                for (final type in documents.keys)
                  {
                    'documentType': type,
                    'path': '$type.pdf',
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
              headers: {'location': '/upload/$completed'},
            );
          }
          completed++;
          return http.Response('', 204, headers: {'upload-offset': '4'});
        }
        expect(request.url.path, '/api/public/join/provider');
        expect(completed, 4);
        expect(request.headers['idempotency-key'], key);
        expect(request.body, contains('application-token'));
        expect(request.body, isNot(contains('filename=')));
        finalized = true;
        return http.Response(
          '{"applicationId":"application","status":"pending"}',
          200,
        );
      });
      final supabase = SupabaseClient(
        'https://example.supabase.co',
        'test-anon',
      );
      final result = await http.runWithClient(
        () => BunyaRepository(supabase).submitJoinApplication(
          kind: 'provider',
          fields: {'policyAccepted': 'true'},
          regions: [],
          documents: documents,
        ),
        () => client,
      );
      expect(result.id, 'application');
      expect(finalized, isTrue);
      await supabase.dispose();
    },
  );
}
