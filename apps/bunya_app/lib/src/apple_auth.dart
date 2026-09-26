import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';
import 'package:sign_in_with_apple/sign_in_with_apple.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

const _appleSignInEnabled = bool.fromEnvironment(
  'APPLE_SIGN_IN_ENABLED',
  defaultValue: false,
);

bool get supportsNativeAppleSignIn =>
    _appleSignInEnabled &&
    !kIsWeb &&
    (defaultTargetPlatform == TargetPlatform.iOS ||
        defaultTargetPlatform == TargetPlatform.macOS);

class AppleAuthService {
  const AppleAuthService(this.client);

  final SupabaseClient client;

  Future<AuthResponse> signIn() async {
    if (!supportsNativeAppleSignIn) {
      throw const AuthException('Apple sign-in is not enabled for this build.');
    }

    final rawNonce = client.auth.generateRawNonce();
    final hashedNonce = sha256.convert(utf8.encode(rawNonce)).toString();
    final credential = await SignInWithApple.getAppleIDCredential(
      scopes: const [
        AppleIDAuthorizationScopes.email,
        AppleIDAuthorizationScopes.fullName,
      ],
      nonce: hashedNonce,
    );
    final idToken = credential.identityToken;
    if (idToken == null || idToken.isEmpty) {
      throw const AuthException('Apple did not return an identity token.');
    }

    final response = await client.auth.signInWithIdToken(
      provider: OAuthProvider.apple,
      idToken: idToken,
      nonce: rawNonce,
    );

    final givenName = credential.givenName?.trim() ?? '';
    final familyName = credential.familyName?.trim() ?? '';
    final fullName = [
      givenName,
      familyName,
    ].where((part) => part.isNotEmpty).join(' ');
    if (fullName.isNotEmpty) {
      await client.auth.updateUser(
        UserAttributes(
          data: {
            'full_name': fullName,
            if (givenName.isNotEmpty) 'given_name': givenName,
            if (familyName.isNotEmpty) 'family_name': familyName,
          },
        ),
      );
    }
    return response;
  }
}
