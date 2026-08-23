import 'dart:async';
import 'dart:io';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

abstract final class PushService {
  static bool _ready = false;
  static StreamSubscription<String>? _refresh;

  static Future<void> initialize() async {
    if (kIsWeb) return;
    try {
      await Firebase.initializeApp();
      _ready = true;
      await registerForCurrentUser();
      _refresh ??= FirebaseMessaging.instance.onTokenRefresh.listen(_saveToken);
    } catch (_) {
      _ready = false;
    }
  }

  static Future<void> registerForCurrentUser() async {
    if (!_ready || Supabase.instance.client.auth.currentUser == null) return;
    final settings = await FirebaseMessaging.instance.requestPermission(
      alert: true,
      badge: true,
      sound: true,
    );
    if (settings.authorizationStatus == AuthorizationStatus.denied) return;
    final token = await FirebaseMessaging.instance.getToken();
    if (token != null) await _saveToken(token);
  }

  static Future<void> _saveToken(String token) async {
    final user = Supabase.instance.client.auth.currentUser;
    if (user == null) return;
    await Supabase.instance.client.from('push_subscriptions').upsert({
      'profile_id': user.id,
      'platform': Platform.isIOS ? 'ios' : 'android',
      'token': token,
      'active': true,
      'last_seen_at': DateTime.now().toUtc().toIso8601String(),
    }, onConflict: 'token');
  }
}
