# TTAutomator visual assets

The repository uses a dark product presentation: authentic interface screenshots, a compact wordmark and a simple three-device illustration.

- **Audience:** Android automation users and developers; clear, practical and inspectable.
- **Direction:** dark product stage, with the application as the visual evidence.
- **Typography:** the existing Inter/Segoe UI sans-serif family, with stronger weight reserved for the wordmark.
- **Surfaces:** charcoal `#111115`, subtle gray borders, white text; turquoise `#00f2ea` and pink `#ff0050` match the application.
- **Visual device:** two T-shaped marks and three connected Android outlines.

## Screenshots

Run `npm run docs:screenshots` to render the production HTML and renderer in an isolated Electron window. The documentation preload supplies three demo devices and a sample video queue. Counters start at zero. No credentials, personal configuration, real device IDs, ADB commands or AI requests are used.

`dashboard.png` and `publishing.png` capture the application window. `device-settings.png` captures the real settings dialog. The screenshots document the existing interface; they are not design mockups.

## Files

- `assets/logo.svg`: vector monogram.
- `assets/banner.svg`: README banner.
- `assets/social-preview.png`: 1280 × 640 repository social image.
- `assets/social-preview.svg`: editable source for the social image. Export it to PNG with `sharp` or an SVG editor.
- `assets/dashboard.png`, `assets/device-settings.png`, `assets/publishing.png`: application screenshots.

Brand assets use the project's ISC license. The mark is independent of TikTok's own branding.
