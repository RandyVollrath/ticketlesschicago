#!/usr/bin/env node

/**
 * Icon Generation Script for Ticketless Chicago Mobile
 *
 * This script generates app icons and splash screens from source images.
 *
 * Prerequisites:
 *   npm install sharp
 *
 * Usage:
 *   1. Place your source icon at: assets/icon-source.png (1024x1024 recommended)
 *   2. Place your source splash at: assets/splash-source.png (2048x2048 recommended)
 *   3. Run: node scripts/generate-icons.js
 *
 * Or use online tools:
 *   - App Icon Generator: https://appicon.co/
 *   - Make App Icon: https://makeappicon.com/
 *   - Icon Kitchen: https://icon.kitchen/
 */

const fs = require('fs');
const path = require('path');

// Check if sharp is available
let sharp;
try {
  sharp = require('sharp');
} catch (e) {
  console.log('Sharp not installed. Installing...');
  console.log('Run: npm install --save-dev sharp');
  console.log('Then run this script again.');
  process.exit(1);
}

const ASSETS_DIR = path.join(__dirname, '..', 'assets');
const ANDROID_RES_DIR = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'res');
const IOS_ASSETS_DIR = path.join(__dirname, '..', 'ios', 'TicketlessChicagoMobile', 'Images.xcassets');

// Icon sizes for different platforms
const ICON_SIZES = {
  expo: [
    { name: 'icon.png', size: 1024 },
    { name: 'adaptive-icon.png', size: 1024 },
  ],
  android: [
    { folder: 'mipmap-mdpi', size: 48 },
    { folder: 'mipmap-hdpi', size: 72 },
    { folder: 'mipmap-xhdpi', size: 96 },
    { folder: 'mipmap-xxhdpi', size: 144 },
    { folder: 'mipmap-xxxhdpi', size: 192 },
  ],
  androidNotification: [
    { folder: 'drawable-mdpi', size: 24 },
    { folder: 'drawable-hdpi', size: 36 },
    { folder: 'drawable-xhdpi', size: 48 },
    { folder: 'drawable-xxhdpi', size: 72 },
    { folder: 'drawable-xxxhdpi', size: 96 },
  ],
  ios: [
    { scale: '1x', size: 20 },
    { scale: '2x', size: 40 },
    { scale: '3x', size: 60 },
    { scale: '1x', size: 29 },
    { scale: '2x', size: 58 },
    { scale: '3x', size: 87 },
    { scale: '2x', size: 80 },
    { scale: '3x', size: 120 },
    { scale: '2x', size: 120 },
    { scale: '3x', size: 180 },
    { scale: '1x', size: 1024 },
  ],
};

// Brand colors
const PRIMARY_COLOR = '#007AFF';
const BACKGROUND_COLOR = '#007AFF';

async function generatePlaceholderIcon(outputPath, size, text = 'TC') {
  // Create a simple placeholder icon with brand colors
  const svg = `
    <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="${PRIMARY_COLOR}"/>
      <text
        x="50%"
        y="55%"
        font-family="Arial, sans-serif"
        font-size="${size * 0.4}px"
        font-weight="bold"
        fill="white"
        text-anchor="middle"
        dominant-baseline="middle"
      >${text}</text>
    </svg>
  `;

  await sharp(Buffer.from(svg))
    .resize(size, size)
    .png()
    .toFile(outputPath);

  console.log(`  Created: ${path.basename(outputPath)} (${size}x${size})`);
}

async function generateSplashScreen(outputPath, width, height) {
  // Create a simple splash screen
  const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="${BACKGROUND_COLOR}"/>
      <text
        x="50%"
        y="45%"
        font-family="Arial, sans-serif"
        font-size="${Math.min(width, height) * 0.08}px"
        font-weight="bold"
        fill="white"
        text-anchor="middle"
      >TICKETLESS</text>
      <text
        x="50%"
        y="55%"
        font-family="Arial, sans-serif"
        font-size="${Math.min(width, height) * 0.05}px"
        fill="white"
        text-anchor="middle"
      >CHICAGO</text>
    </svg>
  `;

  await sharp(Buffer.from(svg))
    .resize(width, height)
    .png()
    .toFile(outputPath);

  console.log(`  Created: ${path.basename(outputPath)} (${width}x${height})`);
}

async function main() {
  console.log('Ticketless Chicago Icon Generator\n');

  // Ensure directories exist
  if (!fs.existsSync(ASSETS_DIR)) {
    fs.mkdirSync(ASSETS_DIR, { recursive: true });
  }

  // Check for source images
  const iconSource = path.join(ASSETS_DIR, 'icon-source.png');
  const splashSource = path.join(ASSETS_DIR, 'splash-source.png');
  const useSource = fs.existsSync(iconSource);

  if (useSource) {
    console.log('Found source images - generating from source...\n');
  } else {
    console.log('No source images found - generating placeholder icons...\n');
    console.log('Tip: Add icon-source.png (1024x1024) to assets/ for custom icons\n');
  }

  // Generate Expo assets
  console.log('Generating Expo assets...');
  for (const icon of ICON_SIZES.expo) {
    const outputPath = path.join(ASSETS_DIR, icon.name);
    if (useSource) {
      await sharp(iconSource)
        .resize(icon.size, icon.size)
        .png()
        .toFile(outputPath);
      console.log(`  Created: ${icon.name} (${icon.size}x${icon.size})`);
    } else {
      await generatePlaceholderIcon(outputPath, icon.size);
    }
  }

  // Generate splash screen
  const splashPath = path.join(ASSETS_DIR, 'splash.png');
  if (fs.existsSync(splashSource)) {
    await sharp(splashSource)
      .resize(1242, 2436)
      .png()
      .toFile(splashPath);
    console.log(`  Created: splash.png (1242x2436)`);
  } else {
    await generateSplashScreen(splashPath, 1242, 2436);
  }

  // Generate Android notification icons
  console.log('\nGenerating Android notification icons...');
  for (const icon of ICON_SIZES.androidNotification) {
    const folderPath = path.join(ANDROID_RES_DIR, icon.folder);
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }
    const outputPath = path.join(folderPath, 'ic_notification.png');

    // Notification icons should be simple white icons
    const svg = `
      <svg width="${icon.size}" height="${icon.size}" xmlns="http://www.w3.org/2000/svg">
        <circle cx="50%" cy="50%" r="40%" fill="white"/>
        <text
          x="50%"
          y="57%"
          font-family="Arial, sans-serif"
          font-size="${icon.size * 0.5}px"
          font-weight="bold"
          fill="${PRIMARY_COLOR}"
          text-anchor="middle"
          dominant-baseline="middle"
        >P</text>
      </svg>
    `;

    await sharp(Buffer.from(svg))
      .resize(icon.size, icon.size)
      .png()
      .toFile(outputPath);

    console.log(`  Created: ${icon.folder}/ic_notification.png (${icon.size}x${icon.size})`);
  }

  console.log('\n✅ Icon generation complete!\n');
  console.log('Next steps:');
  console.log('1. Review generated icons in assets/ directory');
  console.log('2. For custom branding, replace with your actual icon designs');
  console.log('3. Run: npx react-native run-ios or npx react-native run-android');
}

main().catch(console.error);
