# GlowTrack Web

This is the Windows-friendly version of GlowTrack. It is a browser app with no build step and no Node requirement.

## Run it

Open `index.html` in your browser.

If your browser blocks some local features, use a tiny local server instead:

```powershell
cd webapp
python -m http.server 8080
```

Then open `http://localhost:8080`.

## What it does

- Tracks skincare inventory
- Manages reusable product categories
- Manages reusable ingredient records and links them to products
- Builds routines by day
- Logs journal entries
- Shows lightweight analytics
- Supports barcode-based stock tracking with scan-in and scan-out flow
- Turns routine steps into phone-friendly tick boxes with daily progress
- Saves everything in browser local storage
- Exports and imports JSON backups
- Adds safer imports and a stricter browser security policy

## iPhone use

1. Open the hosted site in Safari.
2. Tap Share.
3. Tap `Add to Home Screen`.
4. Open GlowTrack from your home screen like an app.

Routine progress is stored per day on that device, so you can tick each step off as you go.

Camera barcode scanning works best once the app is hosted over `https://` or run on `localhost`. On iPhone Safari, GlowTrack now falls back to a Safari-friendly scanner library when the native browser barcode API is unavailable. If the browser still cannot access live scanning, you can type or paste the barcode manually.

Categories and ingredients are managed in the Library tab. Products use the category picker from that list, and ingredients can be linked from existing records or added by pasting ingredient names while editing a product.

## Security notes

- Import now validates backup structure before replacing your data.
- The app uses a stricter browser security policy and disables unnecessary browser permissions.
- Protection now relies on your device and browser security rather than an in-app passphrase.

## Good next steps

- Add product photos
- Add recurring reminders
- Add cloud sync or sign-in
- Later wrap this in a mobile shell if you want an installable app
