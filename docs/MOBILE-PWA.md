# Mobile Web & PWA

Linux Panel works as a responsive Web interface and as a standalone home-screen
app on current iOS/iPadOS Safari and Android Chrome on a trusted HTTPS origin.

## Install

- **iPhone/iPad:** open the panel over HTTPS in Safari, choose **Share → Add to Home Screen**, then open Linux Panel from its home-screen icon.
- **Android:** open the HTTPS panel in Chrome and use **Install app** / **Add to Home screen** when offered.
- On narrow screens, the sidebar becomes a compact top navigation area. The panel name and appearance controls precede horizontally scrollable module navigation; account/logout controls follow Settings.
- Appearance remains browser-local: check Follow system to disable the manual moon/sun capsule; uncheck it to choose dark/light. The PWA uses the same authenticated backend as the normal website.

## Offline and privacy boundaries

The `/sw.js` Service Worker is intentionally *not* an offline administration
system. Offline start displays a static reconnect explanation. It never stores
HTML pages from live sessions, OAuth/MCP responses, `/api/**` responses, access
tokens, private data or Action output. Only the packaged offline explanation,
public icons and Vite's content-hashed JS/CSS assets are cached. Every normal
page navigation still attempts the server first. Privileged operations
continue to require a live authorized connection.

The app manifest starts at `/`, uses standalone display and includes local
192×192 and 512×512 PNG icons. Vite copies `apps/web/public/` to
`apps/web/dist/` during `npm run build:web`; the current Fastify static
route serves the files on the same origin.

## Zoom and accessibility caveat

As expressly requested, the viewport meta sets
`maximum-scale=1, user-scalable=no, viewport-fit=cover`. This disables pinch
zoom in some mobile browsers and **reduces accessibility**, although modern
browsers and operating systems may override it. The mobile UI also uses
16px text inputs to avoid Safari focus auto-zoom, 44px touch targets and safe
area padding. The implementation does not block OS text-size/assistive
features with JavaScript gesture handlers.

## Acceptance

Automated: `npm test`, `npm run build:web`, and the browser/PWA source,
icon, SW cache isolation, and responsive viewport tests.

Manual: test iOS Safari Add to Home Screen and Android installation, launch
in standalone mode, log in and out, switch modules and themes, scroll tables,
use TOTP input, restart the app, disable network to confirm no private status
is presented offline, then reconnect. Verify that browser updates refresh the
app shell while keeping sign-in enforced.
