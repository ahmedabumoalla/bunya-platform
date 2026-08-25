import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

class ProductImageUrls {
  ProductImageUrls._();

  static final Map<String, _CachedImageUrl> _thumbnailCache = {};
  static final Map<String, _CachedImageUrl> _originalCache = {};

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

  static Future<Map<String, String>> originals(
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
      final cached = _originalCache[path];
      if (cached != null && cached.expiresAt.isAfter(now)) {
        urls[path] = cached.url;
      } else {
        missing.add(path);
      }
    }
    if (missing.isNotEmpty) {
      try {
        final signed = await client.storage
            .from('provider-product-images')
            .createSignedUrls(missing, 21600);
        for (final item in signed) {
          urls[item.path] = item.signedUrl;
          _originalCache[item.path] = _CachedImageUrl(
            item.signedUrl,
            now.add(const Duration(hours: 5, minutes: 30)),
          );
        }
      } catch (_) {
        // Keep the product usable even when media signing is unavailable.
      }
    }
    return urls;
  }
}

class FastProductImage extends StatelessWidget {
  const FastProductImage({
    super.key,
    required this.imageUrl,
    this.fallbackUrl,
    this.cacheKey,
    this.fit = BoxFit.cover,
    this.memoryWidth = 640,
  });

  final String imageUrl;
  final String? fallbackUrl;
  final String? cacheKey;
  final BoxFit fit;
  final int memoryWidth;

  @override
  Widget build(BuildContext context) {
    Widget empty() => const ColoredBox(
      color: Color(0xFFF0E9E0),
      child: Center(
        child: Icon(
          Icons.inventory_2_outlined,
          size: 34,
          color: Color(0xFFB45B37),
        ),
      ),
    );

    final originalUrl = fallbackUrl?.trim() ?? '';
    // Avoid stale decoded thumbnails in Flutter Web. Native clients keep the
    // bandwidth-saving transform and both platforms retain a reciprocal
    // fallback when either source is unavailable.
    final primaryUrl = kIsWeb && originalUrl.isNotEmpty
        ? originalUrl
        : imageUrl;
    final secondaryUrl = primaryUrl == imageUrl ? originalUrl : imageUrl;

    if (primaryUrl.isEmpty) return empty();
    return CachedNetworkImage(
      imageUrl: primaryUrl,
      cacheKey: cacheKey == null ? null : '$cacheKey-primary-v2',
      fit: fit,
      memCacheWidth: memoryWidth,
      maxWidthDiskCache: 640,
      fadeInDuration: Duration.zero,
      placeholder: (_, _) => const ColoredBox(color: Color(0xFFF0E9E0)),
      errorWidget: (_, _, _) {
        if (secondaryUrl.isEmpty || secondaryUrl == primaryUrl) return empty();
        return CachedNetworkImage(
          imageUrl: secondaryUrl,
          cacheKey: cacheKey == null ? null : '$cacheKey-secondary-v2',
          fit: fit,
          memCacheWidth: memoryWidth,
          maxWidthDiskCache: 640,
          fadeInDuration: Duration.zero,
          placeholder: (_, _) => const ColoredBox(color: Color(0xFFF0E9E0)),
          errorWidget: (_, _, _) => empty(),
        );
      },
    );
  }
}

class _CachedImageUrl {
  const _CachedImageUrl(this.url, this.expiresAt);

  final String url;
  final DateTime expiresAt;
}
