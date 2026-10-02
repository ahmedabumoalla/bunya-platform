import 'dart:convert';

import 'package:bunya_app/src/data.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  Profile profile(
    String role, {
    List<String> roles = const [],
    bool active = true,
    bool passwordChange = false,
  }) => Profile(
    name: 'Test',
    email: 'test@example.invalid',
    mobile: '',
    role: role,
    mustChangePassword: passwordChange,
    activeRoles: roles,
    isActive: active,
  );
  test('customer switch requires active customer capability and a ready professional account', () {
    for (final role in ['provider', 'contractor']) {
      expect(
        profile(role, roles: [role, 'customer']).canSwitchToCustomer,
        isTrue,
      );
      expect(profile(role, roles: [role]).canSwitchToCustomer, isFalse);
      expect(
        profile(role, roles: ['customer'], active: false).canSwitchToCustomer,
        isFalse,
      );
      expect(
        profile(
          role,
          roles: ['customer'],
          passwordChange: true,
        ).canSwitchToCustomer,
        isFalse,
      );
    }
    for (final role in ['admin', 'driver', 'customer']) {
      expect(profile(role, roles: ['customer']).canSwitchToCustomer, isFalse);
    }
  });
  for (final role in ['provider', 'contractor']) {
    for (final customerActive in [true, false]) {
      test(
        '$role preserves primary identity and reads nonrevoked owned roles ($customerActive)',
        () async {
          final seen = <Uri>[];
          final client = await authenticatedClient(role, (request) {
            seen.add(request.url);
            return response(request, [
              {'role': role},
              if (customerActive) {'role': 'customer'},
            ]);
          });
          addTearDown(client.dispose);
          final value = await BunyaRepository(client).loadProfile();
          expect(value!.role, role);
          expect(value.canSwitchToCustomer, customerActive);
          expect(seen.single.queryParameters['profile_id'], 'eq.test-user');
          expect(seen.single.queryParameters['revoked_at'], 'is.null');
          expect(seen.single.queryParameters['select'], 'role');
        },
      );
    }
  }
  test('role lookup failure preserves primary workspace without granting customer access', () async {
    final client = await authenticatedClient(
      'contractor',
      (request) => response(request, {
        'code': '42501',
        'message': 'role lookup denied',
        'details': null,
        'hint': null,
      }, status: 403),
    );
    addTearDown(client.dispose);
    final value = await BunyaRepository(client).loadProfile();
    expect(value!.role, 'contractor');
    expect(value.activeRoles, isEmpty);
    expect(value.canSwitchToCustomer, isFalse);
  });
}

http.Response response(
  http.Request request,
  Object value, {
  int status = 200,
}) => http.Response(
  jsonEncode(value),
  status,
  headers: {'content-type': 'application/json'},
  request: request,
);
Future<SupabaseClient> authenticatedClient(
  String role,
  http.Response Function(http.Request) roleResponse,
) async {
  final transport = MockClient((request) async {
    if (request.url.path.endsWith('/token')) {
      final expires =
          DateTime.now().add(const Duration(hours: 1)).millisecondsSinceEpoch ~/
          1000;
      final payload = base64Url
          .encode(utf8.encode(jsonEncode({'exp': expires, 'sub': 'test-user'})))
          .replaceAll('=', '');
      return response(request, {
        'access_token': 'eyJhbGciOiJub25lIn0.$payload.signature',
        'refresh_token': 'test-refresh',
        'token_type': 'bearer',
        'expires_in': 3600,
        'user': {
          'id': 'test-user',
          'aud': 'authenticated',
          'role': 'authenticated',
          'email': 'test@example.invalid',
          'created_at': '2026-10-03T00:00:00Z',
        },
      });
    }
    if (request.url.path.endsWith('/profiles')) {
      return response(request, [
        {
          'full_name': 'Test professional',
          'role': role,
          'must_change_password': false,
          'is_active': true,
        },
      ]);
    }
    if (request.url.path.endsWith('/user_roles')) return roleResponse(request);
    fail('Unexpected request: ${request.method} ${request.url.path}');
  });
  final client = SupabaseClient(
    'https://test.invalid',
    'test-anon',
    httpClient: transport,
  );
  await client.auth.signInWithPassword(
    email: 'test@example.invalid',
    password: 'test',
  );
  return client;
}
