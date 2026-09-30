import 'dart:typed_data';

import 'package:file_selector/file_selector.dart';

/// Reopens only the range needed by each upload chunk, keeping PDFs off heap.
class JoinDocument {
  const JoinDocument({
    required this.name,
    required this.bytes,
    required this.mimeType,
  }) : file = null,
       length = null,
       cleanup = null;

  const JoinDocument.fromFile({
    required this.name,
    required this.file,
    required this.length,
    required this.mimeType,
    this.cleanup,
  }) : bytes = null;

  final String name, mimeType;
  final Uint8List? bytes;
  final XFile? file;
  final int? length;
  final Future<void> Function()? cleanup;

  int get size => length ?? bytes!.length;

  Stream<List<int>> openRead([int start = 0, int? end]) =>
      file?.openRead(start, end) ??
      Stream.value(Uint8List.sublistView(bytes!, start, end ?? size));
}
