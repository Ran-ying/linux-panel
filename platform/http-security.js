/**
 * CSP shared between platform Web routes and OAuth consent.
 * For the consent document only, the one registered callback origin may
 * participate in form redirects. Other routes stay strictly same-origin.
 */
export function panelContentSecurityPolicy(registeredCallbackOrigin = null) {
  let formAction = "form-action 'self'";
  if (registeredCallbackOrigin !== null) {
    if (typeof registeredCallbackOrigin !== 'string')
      throw new Error('Invalid OAuth callback origin');
    const parsed = new URL(registeredCallbackOrigin);
    if (parsed.origin !== registeredCallbackOrigin ||
        !['https:', 'http:'].includes(parsed.protocol) ||
        (parsed.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)))
      throw new Error('Invalid OAuth callback origin');
    formAction += ' ' + parsed.origin;
  }
  return "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; " +
    formAction + "; script-src 'self'; style-src 'self'; " +
    "img-src 'self' data:; font-src 'self'; connect-src 'self'";
}
