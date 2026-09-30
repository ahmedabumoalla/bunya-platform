import 'dart:async';
import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';

import 'package:http/http.dart' as http;

import 'join_document.dart';

const providerUploadChunkSize = 6 * 1024 * 1024;

Future<http.Response> _sendSigned(
  http.Client client,
  String method,
  Uri url,
  Map<String, String> headers, {
  List<int>? body,
}) async {
  final request = http.Request(method, url)
    ..followRedirects = false
    ..headers.addAll(headers);
  if (body != null) request.bodyBytes = body;
  return http.Response.fromStream(await client.send(request));
}

/// Sends signed, sequential TUS chunks directly to private Storage.
Future<void> uploadProviderDocument({
  required http.Client client,
  required Uri endpoint,
  required String bucket,
  required String path,
  required String token,
  required JoinDocument document,
  void Function(int uploaded)? onProgress,
}) async {
  if (document.size <= 0) throw Exception('اختر مستندًا غير فارغ');
  final headers = {'Tus-Resumable': '1.0.0', 'x-signature': token};
  final metadata = {
    'bucketName': bucket,
    'objectName': path,
    'contentType': document.mimeType,
    'cacheControl': '3600',
  };
  final created = await _sendSigned(client, 'POST', endpoint, {
    ...headers,
    'Upload-Length': '${document.size}',
    'Upload-Metadata': metadata.entries
        .map(
          (entry) => '${entry.key} ${base64Encode(utf8.encode(entry.value))}',
        )
        .join(','),
  }).timeout(const Duration(minutes: 2));
  final location = created.headers['location'];
  if (created.statusCode != 201 || location == null) {
    throw Exception('تعذر بدء رفع المستند. أعد المحاولة.');
  }
  final uploadUrl = endpoint.resolve(location);
  if (uploadUrl.origin != endpoint.origin) {
    throw Exception('عنوان رفع المستند غير صالح');
  }
  var offset = 0;
  var failures = 0;
  while (offset < document.size) {
    final end = min(offset + providerUploadChunkSize, document.size);
    try {
      final bytes = BytesBuilder(copy: false);
      await for (final part in document.openRead(offset, end)) {
        bytes.add(part);
      }
      if (bytes.length != end - offset) {
        throw StateError('تغير الملف المحدد. أعد اختياره.');
      }
      final response = await _sendSigned(client, 'PATCH', uploadUrl, {
        ...headers,
        'Content-Type': 'application/offset+octet-stream',
        'Upload-Offset': '$offset',
      }, body: bytes.takeBytes()).timeout(const Duration(minutes: 3));
      if (response.statusCode == 204 &&
          int.tryParse(response.headers['upload-offset'] ?? '') == end) {
        offset = end;
        failures = 0;
        onProgress?.call(offset);
        continue;
      }
      if ([400, 401, 403, 404, 410, 413, 415].contains(response.statusCode)) {
        throw StateError('تعذر رفع المستند. أعد المحاولة.');
      }
    } on StateError {
      rethrow;
    } catch (_) {
      // A lost response may follow a committed chunk. HEAD supplies the truth.
    }
    var recovered = false;
    while (!recovered) {
      if (++failures > 3) {
        throw Exception('انقطع رفع المستند. تحقق من الاتصال وأعد المحاولة.');
      }
      await Future<void>.delayed(Duration(milliseconds: 500 * failures));
      try {
        final response = await _sendSigned(
          client,
          'HEAD',
          uploadUrl,
          headers,
        ).timeout(const Duration(seconds: 30));
        final confirmed = int.tryParse(response.headers['upload-offset'] ?? '');
        if (response.statusCode != 200 && response.statusCode != 204) continue;
        if (confirmed == null || confirmed < offset || confirmed > end) {
          throw StateError('تعذر التحقق من اكتمال المستند. أعد المحاولة.');
        }
        if (confirmed > offset) failures = 0;
        offset = confirmed;
        onProgress?.call(offset);
        recovered = true;
      } on StateError {
        rethrow;
      } catch (_) {
        // Retry HEAD, never blindly replay bytes whose result is unknown.
      }
    }
  }
}
