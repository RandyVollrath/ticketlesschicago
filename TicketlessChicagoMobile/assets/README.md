# App Assets

This directory should contain the app icons and splash screen images.

## Required Assets

### App Icon (icon.png)
- Size: 1024x1024px
- Format: PNG
- No transparency for iOS
- Used for app store listings

### Adaptive Icon (adaptive-icon.png) - Android
- Size: 1024x1024px
- Format: PNG
- Should have padding for safe area

### Splash Screen (splash.png)
- Size: 1242x2436px (or larger)
- Format: PNG
- Background color: #007AFF

## Icon Design Guidelines

The Ticketless Chicago app icon should:
1. Feature a car or parking symbol
2. Use the primary brand color (#007AFF)
3. Be recognizable at small sizes
4. Follow iOS Human Interface Guidelines and Android Material Design guidelines

## Generating Icons

Use a tool like:
- [App Icon Generator](https://appicon.co/)
- [Make App Icon](https://makeappicon.com/)
- [Icon Kitchen](https://icon.kitchen/)

After generating, place the iOS icons in:
`ios/TicketlessChicagoMobile/Images.xcassets/AppIcon.appiconset/`

And Android icons in:
`android/app/src/main/res/mipmap-*/`
