# PWA icons

Two apps install from this origin, so this folder holds two sets.

**Tally** — referenced by the web app manifest declared in `vite.config.ts` and by the
`apple-touch-icon` link in `index.html`, generated from `public/favicon.svg`.

**The kiosk** — referenced by `public/kiosk.webmanifest` and by the `apple-touch-icon` link in
`kiosk.html`, generated from `public/kiosk-icon.svg`. Same mark, brand-blue surface: both tiles end
up on the same lobby home screen, and at 48 device pixels colour is what tells them apart.

The committed PNGs are generated from those SVGs so each mark has exactly one source of truth. If an
SVG changes, regenerate its three — do not hand-edit them:

| File | Used by |
| --- | --- |
| `icon-192.png`, `kiosk-icon-192.png` | Android install prompt, iOS home screen (`apple-touch-icon`) |
| `icon-512.png`, `kiosk-icon-512.png` | Splash screens, store listings, high-DPI launchers |
| `icon-512-maskable.png`, `kiosk-icon-512-maskable.png` | Android adaptive icons (`purpose: "maskable"`) |

## Generate them

With ImageMagick (`magick` on v7; use `convert` on v6):

```bash
cd "$(git rev-parse --show-toplevel)"

magick -background none public/favicon.svg -resize 192x192 public/icons/icon-192.png
magick -background none public/favicon.svg -resize 512x512 public/icons/icon-512.png

# Maskable icons are cropped to a circle or squircle by the launcher, so the mark
# has to survive losing the outer 20%: shrink it and let the dark surface bleed
# to the edges instead of relying on the rounded square in the SVG.
magick -background '#0f172a' public/favicon.svg -resize 320x320 \
  -gravity center -extent 512x512 public/icons/icon-512-maskable.png
```

The kiosk's three, identically. Its surface is a flat `brand-600` rather than a gradient precisely so
that `-background` below can name the same colour and the maskable variant shows no seam where the
shrunk mark meets the bleed:

```bash
magick -background none public/kiosk-icon.svg -resize 192x192 public/icons/kiosk-icon-192.png
magick -background none public/kiosk-icon.svg -resize 512x512 public/icons/kiosk-icon-512.png
magick -background '#0284c7' public/kiosk-icon.svg -resize 320x320 \
  -gravity center -extent 512x512 public/icons/kiosk-icon-512-maskable.png
```

Open the results before committing to a deploy. ImageMagick only renders SVG gradients faithfully
when the librsvg delegate is installed (`magick -list delegate | grep svg`); without it the
background can come out flat. Flat is acceptable — a smeared mark is not.

Zero-install alternative, using the asset generator from the same project as the `vite-plugin-pwa`
already in `devDependencies`:

```bash
npx --yes @vite-pwa/assets-generator --preset minimal-2023 public/favicon.svg
mv public/pwa-192x192.png            public/icons/icon-192.png
mv public/pwa-512x512.png            public/icons/icon-512.png
mv public/maskable-icon-512x512.png  public/icons/icon-512-maskable.png
rm -f public/pwa-64x64.png public/apple-touch-icon-180x180.png
```

## What happens if you skip this

For **Tally**, `npm run build` **succeeds**. Vite does not verify that the files a manifest points at
exist, and Workbox simply precaches whatever `**/*.png` it finds. Nothing fails, which is exactly why
this is easy to forget.

What breaks is only visible on a device: Chrome's "Add to Home screen" prompt falls back to a
screenshot-derived or generic icon, the installed app shows a blank tile in the launcher, and the
`apple-touch-icon` in `index.html` 404s so iOS renders a thumbnail of the page instead. Generate the
three files before any deploy that people will install.

For the **kiosk**, the build fails: `scripts/check-kiosk-budget.mjs` resolves every icon its manifest
names. The kiosk is the one people cannot check by looking — it is set up once, by whoever is holding
the pairing code, and then nobody opens it again for months.
