import 'dart:io';

import 'package:flutter_image_compress/flutter_image_compress.dart';

import 'join_document.dart';

Future<JoinDocument> prepareJoinDocument(XFile file, String mimeType) async {
  final size = await file.length();
  final original = JoinDocument.fromFile(
    name: file.name,
    file: file,
    length: size,
    mimeType: mimeType,
  );
  if (!mimeType.startsWith('image/') ||
      !(Platform.isAndroid || Platform.isIOS || Platform.isMacOS)) {
    return original;
  }
  Directory? temporary;
  try {
    temporary = await Directory.systemTemp.createTemp('bunya-join-');
    final format = switch (mimeType) {
      'image/png' => CompressFormat.png,
      'image/webp' => CompressFormat.webp,
      _ => CompressFormat.jpeg,
    };
    final extension = switch (format) {
      CompressFormat.png => 'png',
      CompressFormat.webp => 'webp',
      _ => 'jpg',
    };
    final compressed = await FlutterImageCompress.compressAndGetFile(
      file.path,
      '${temporary.path}/document.$extension',
      format: format,
      quality: 94,
      // Preserve document resolution and small text; do not downscale scans.
      minWidth: 100000,
      minHeight: 100000,
    );
    final compressedSize = await compressed?.length() ?? 0;
    if (compressed != null && compressedSize > 0 && compressedSize < size) {
      final directory = temporary;
      return JoinDocument.fromFile(
        name: file.name,
        file: compressed,
        length: compressedSize,
        mimeType: mimeType,
        cleanup: () async {
          if (await directory.exists()) await directory.delete(recursive: true);
        },
      );
    }
  } catch (_) {
    // Unsupported codecs or compression failures keep the selected original.
  }
  if (temporary != null && await temporary.exists()) {
    await temporary.delete(recursive: true);
  }
  return original;
}
