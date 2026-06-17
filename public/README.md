# Static assets

Files here are served from the site root (e.g. `public/x.png` → `/x.png`).

## Brand logo

The login screen and the app sidebar render the brand mark from
**`public/seneschal-logo.png`** via `src/components/Logo.tsx`.

Drop the logo in as `seneschal-logo.png`. Recommended:

- **Square** (e.g. 512×512 or 1024×1024) — `Logo` renders it square, so a square
  source avoids distortion.
- **Transparent background** (just the gold mark, no navy fill) so it sits cleanly
  on both the ivory login screen and the navy sidebar. A navy-background image will
  read as a navy tile on the ivory login.

To use a different filename or format, change the `src` in `src/components/Logo.tsx`
(the single source of truth for the asset).
