import 'package:flutter/material.dart';

/// Uses the transparent brand artwork without its empty outer canvas.
class BunyaBrandLogo extends StatelessWidget {
  const BunyaBrandLogo({super.key, this.width = 152, this.height = 44});

  final double width;
  final double height;

  @override
  Widget build(BuildContext context) => Semantics(
    label: 'بُنية',
    image: true,
    child: SizedBox(
      width: width,
      height: height,
      child: FittedBox(
        fit: BoxFit.contain,
        child: SizedBox(
          // Alpha bounds plus a small safety margin; preserve the full tagline.
          width: 4129,
          height: 1199,
          child: Stack(
            clipBehavior: Clip.hardEdge,
            children: [
              Positioned(
                left: -254,
                top: -1150,
                width: 4525,
                height: 3394,
                child: Image.asset(
                  'assets/brand/bunya-mark.png',
                  excludeFromSemantics: true,
                  filterQuality: FilterQuality.high,
                ),
              ),
            ],
          ),
        ),
      ),
    ),
  );
}
