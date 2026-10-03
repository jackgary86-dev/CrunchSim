/* CrunchSim module: onboarding. Loaded after app.js; talks to the game only through CS.app (see the module interface in app.js). */
(function (G) {
  'use strict';
  const CS = G.CS; if (!CS || !CS.app) return;
  // implemented by ticket #25
})(typeof window !== 'undefined' ? window : globalThis);
