import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

abstract final class BunyaColors {
  static const ink = Color(0xFF18231F);
  static const forest = Color(0xFF123F33);
  static const copper = Color(0xFFB7603B);
  static const copperDark = Color(0xFF8E4329);
  static const sand = Color(0xFFF5EFE6);
  static const surface = Color(0xFFFFFCF7);
  static const mint = Color(0xFFDCEFE6);
  static const muted = Color(0xFF776B63);
  static const line = Color(0xFFE6DCD0);
  static const danger = Color(0xFFB33A3A);
}

ThemeData bunyaTheme() {
  final text = GoogleFonts.cairoTextTheme().apply(
    bodyColor: BunyaColors.ink,
    displayColor: BunyaColors.ink,
  );
  return ThemeData(
    useMaterial3: true,
    brightness: Brightness.light,
    scaffoldBackgroundColor: BunyaColors.sand,
    colorScheme: ColorScheme.fromSeed(
      seedColor: BunyaColors.copper,
      primary: BunyaColors.copper,
      secondary: BunyaColors.forest,
      surface: BunyaColors.surface,
      error: BunyaColors.danger,
    ),
    textTheme: text,
    appBarTheme: AppBarTheme(
      elevation: 0,
      scrolledUnderElevation: 0,
      backgroundColor: Colors.transparent,
      foregroundColor: BunyaColors.ink,
      centerTitle: false,
      titleTextStyle: text.titleLarge?.copyWith(fontWeight: FontWeight.w900),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Colors.white,
      contentPadding: const EdgeInsets.symmetric(horizontal: 18, vertical: 16),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(18),
        borderSide: BorderSide.none,
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(18),
        borderSide: const BorderSide(color: BunyaColors.line),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(18),
        borderSide: const BorderSide(color: BunyaColors.copper, width: 1.5),
      ),
      labelStyle: const TextStyle(color: BunyaColors.muted),
      hintStyle: const TextStyle(color: Color(0xFF9A8E86)),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size.fromHeight(54),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(17)),
        textStyle: text.labelLarge?.copyWith(fontWeight: FontWeight.w900),
      ),
    ),
    navigationBarTheme: NavigationBarThemeData(
      height: 72,
      elevation: 0,
      backgroundColor: BunyaColors.surface,
      indicatorColor: const Color(0xFFF0DDCF),
      labelTextStyle: WidgetStatePropertyAll(
        text.labelSmall?.copyWith(fontWeight: FontWeight.w800),
      ),
    ),
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      backgroundColor: BunyaColors.ink,
      contentTextStyle: text.bodyMedium?.copyWith(
        color: Colors.white,
        fontWeight: FontWeight.w700,
      ),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
    ),
  );
}
