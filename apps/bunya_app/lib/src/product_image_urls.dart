import 'package:supabase_flutter/supabase_flutter.dart';

class ProductImageUrls {
  ProductImageUrls._();

  static final Map<String, _CachedImageUrl> _thumbnailCache = {};

  static Future<Map<String, String>> thumbnails(
    SupabaseClient client,
    Iterable<String> sourcePaths,
  ) async {
    final now = DateTime.now();
    final paths = sourcePaths
        .map((path) => path.trim())
        .where((path) => path.isNotEmpty)
        .toSet();
    final urls = <String, String>{};
    final missing = <String>[];

    for (final path in paths) {
      final cached = _thumbnailCache[path];
      if (cached != null && cached.expiresAt.isAfter(now)) {
        urls[path] = cached.url;
      } else {
        missing.add(path);
      }
    }

    for (var offset = 0; offset < missing.length; offset += 8) {
      final end = offset + 8 < missing.length ? offset + 8 : missing.length;
      await Future.wait(
        missing.sublist(offset, end).map((path) async {
          try {
            final url = await client.storage
                .from('provider-product-images')
                .createSignedUrl(
                  path,
                  21600,
                  transform: const TransformOptions(
                    width: 640,
                    height: 640,
                    resize: ResizeMode.cover,
                    quality: 70,
                  ),
                );
            urls[path] = url;
            _thumbnailCache[path] = _CachedImageUrl(
              url,
              now.add(const Duration(hours: 5, minutes: 30)),
            );
          } catch (_) {
            // A missing or unauthorized image must not delay the whole catalog.
          }
        }),
      );
    }
    return urls;
  }
}

class _CachedImageUrl {
  const _CachedImageUrl(this.url, this.expiresAt);

  final String url;
  final DateTime expiresAt;
}
