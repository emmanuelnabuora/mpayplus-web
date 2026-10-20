"use strict";
// The addresses the M-Pay+ website is served from. Browser requests (Origin header) and
// Cloudflare Turnstile checks (hostname) from anywhere else are refused.
// Turnstile must list the same hostnames: Cloudflare dashboard > Turnstile > the widget > Hostnames.
const SITE_HOSTS = ["m-pay-landing.web.app", "mpayplus.co.ke", "www.mpayplus.co.ke"];
const SITE_ORIGINS = SITE_HOSTS.map((h) => `https://${h}`);

module.exports = {
  SITE_HOSTS,
  SITE_ORIGINS,
  isSiteOrigin: (origin) => SITE_ORIGINS.includes(origin),
  isSiteHost: (hostname) => SITE_HOSTS.includes(hostname),
};
