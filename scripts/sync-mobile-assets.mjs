import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const source = path.join(root, "public", "pwa", "icon-512.png");
const android = path.join(root, "android", "app", "src", "main", "res");
const densities = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };

await sharp(source).resize(1024, 1024).png().toFile(path.join(root, "ios", "App", "App", "Assets.xcassets", "AppIcon.appiconset", "AppIcon-512@2x.png"));
for (const [density, size] of Object.entries(densities)) {
  const directory = path.join(android, `mipmap-${density}`);
  await sharp(source).resize(size, size).png().toFile(path.join(directory, "ic_launcher.png"));
  await sharp(source).resize(size, size).png().toFile(path.join(directory, "ic_launcher_round.png"));
  await sharp(source).resize(Math.round(size * 1.5), Math.round(size * 1.5)).png().toFile(path.join(directory, "ic_launcher_foreground.png"));
}
