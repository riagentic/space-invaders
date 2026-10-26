/** The arcade face, with a fallback that keeps canvas text legible before the
 *  webfont finishes loading. Always use this, never a bare '"Press Start 2P"'. */
export const ARCADE_FONT = '"Press Start 2P", "Courier New", monospace'

/** The page loads nothing from anywhere else: the font is embedded in
 *  style.css as a data URL, so every build carries it. Saying so is one CSP
 *  meta tag — a remote script could not run even if one ever appeared.
 *  `unsafe-inline` is the one concession: aio's shell inlines its title bar
 *  and config scripts. */
const CSP = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

/** `<head>` content, passed to aio via `ui.head`. */
export const HEAD_TAGS = `<meta http-equiv="Content-Security-Policy" content="${CSP}">`
