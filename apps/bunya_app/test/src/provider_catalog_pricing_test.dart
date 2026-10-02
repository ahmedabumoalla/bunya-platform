import 'dart:convert';
import 'dart:typed_data';

import 'package:bunya_app/src/workspace.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test(
    'product creation omits catalog price and VAT without a zero price',
    () async {
      Map<String, dynamic>? inserted;
      var reviewed = false;
      final transport = MockClient((request) async {
        final path = request.url.path;
        if (path.endsWith('/token')) return sessionResponse();
        if (path.endsWith('/products') && request.method == 'POST') {
          inserted = jsonDecode(request.body) as Map<String, dynamic>;
          return jsonResponse({'id': 'test-product'}, request: request);
        }
        if (path.contains('/storage/v1/object/')) {
          return jsonResponse({
            'Key': 'provider-product-images/test',
            'Id': 'test-file',
          }, request: request);
        }
        if (path.endsWith('/product_images')) {
          return jsonResponse([], request: request);
        }
        if (path.endsWith('/rpc/submit_product_for_review')) {
          reviewed = true;
          return jsonResponse({'id': 'test-product'}, request: request);
        }
        fail('Unexpected request: ${request.method} $path');
      });
      final client = SupabaseClient(
        'https://test.invalid',
        'test-anon',
        httpClient: transport,
      );
      addTearDown(client.dispose);
      await client.auth.signInWithPassword(
        email: 'test@example.invalid',
        password: 'test',
      );
      await WorkspaceRepository(client).createProviderProduct(
        providerId: 'test-provider',
        name: 'Test product',
        categoryId: 'test-category',
        categoryTone: 'cement',
        baseUnit: 'unit',
        description: 'Product specification',
        sku: null,
        minimumOrder: 1,
        stockQuantity: null,
        availabilityStatus: 'available',
        leadTime: 'One day',
        deliveryWindow: 'Two days',
        deliveryNotes: 'Arrange delivery',
        offerType: 'sale',
        rentalDuration: null,
        rentalDurationUnit: null,
        measurements: [],
        variants: [],
        specifications: [],
        warrantyDuration: null,
        warrantyDetails: null,
        imageBytes: Uint8List.fromList([1, 2, 3]),
        imageName: 'fixture.jpg',
        imageMime: 'image/jpeg',
      );
      expect(inserted, isNotNull);
      expect(inserted!.containsKey('unit_price'), isFalse);
      expect(inserted!.containsKey('vat_inclusive'), isFalse);
      expect(inserted!['minimum_order'], 1);
      expect(inserted!['review_status'], 'draft');
      expect(reviewed, isTrue);
    },
  );

  test('product change multipart omits catalog money while preserving delivery configuration', () async {
    String? body;
    final transport = MockClient((request) async {
      if (request.url.path.endsWith('/token')) return sessionResponse();
      expect(
        request.url.path,
        '/api/provider/products/test-product/change-requests',
      );
      body = request.body;
      expect(request.headers['authorization'], startsWith('Bearer '));
      return jsonResponse({'id': 'test-change'});
    });
    final client = SupabaseClient(
      'https://test.invalid',
      'test-anon',
      httpClient: transport,
    );
    addTearDown(client.dispose);
    await client.auth.signInWithPassword(
      email: 'test@example.invalid',
      password: 'test',
    );
    await http.runWithClient(
      () => WorkspaceRepository(client).requestProductChange(
        product: {'id': 'test-product'},
        name: 'Revised product',
        categoryId: 'test-category',
        customCategory: null,
        baseUnit: 'unit',
        description: 'Product specification',
        sku: null,
        minimumOrder: 1,
        stockQuantity: null,
        availabilityStatus: 'available',
        leadTime: 'One day',
        deliveryWindow: 'Two days',
        deliveryNotes: 'Arrange delivery',
        offerType: 'sale',
        rentalDuration: null,
        rentalDurationUnit: null,
        measurements: [],
        variants: [],
        specifications: [],
        warrantyDuration: null,
        warrantyDetails: null,
        retainedImageIds: ['test-image'],
        availabilityRegions: [],
        deliveryRegions: [],
        deliveryAvailable: true,
        deliveryMaximumDuration: 2,
        deliveryDurationUnit: 'day',
        deliveryPricePerKm: 3,
        deliveryMaximumDistanceKm: 20,
        deliveryConfigNotes: null,
        requestNote: 'Updated description',
      ),
      () => transport,
    );
    expect(body, isNotNull);
    expect(body, isNot(contains('name="unit_price"')));
    expect(body, isNot(contains('name="vat_inclusive"')));
    expect(body, contains('name="delivery_price_per_km"'));
    expect(body, contains('name="retained_image_ids"'));
  });
}

http.Response jsonResponse(Object? value, {http.Request? request}) =>
    http.Response(
      jsonEncode(value),
      200,
      headers: {'content-type': 'application/json'},
      request: request,
    );
http.Response sessionResponse() {
  final expires =
      DateTime.now().add(const Duration(hours: 1)).millisecondsSinceEpoch ~/
      1000;
  final payload = base64Url
      .encode(utf8.encode(jsonEncode({'exp': expires, 'sub': 'test-user'})))
      .replaceAll('=', '');
  return jsonResponse({
    'access_token': 'eyJhbGciOiJub25lIn0.$payload.signature',
    'refresh_token': 'test-refresh',
    'token_type': 'bearer',
    'expires_in': 3600,
    'user': {
      'id': 'test-user',
      'aud': 'authenticated',
      'role': 'authenticated',
      'email': 'test@example.invalid',
      'created_at': '2026-10-01T00:00:00Z',
    },
  });
}
