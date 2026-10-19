/* Retire only the old game scopes. Saved data stays in origin-private storage. */
if (typeof ServiceWorkerGlobalScope !== "undefined" && self instanceof ServiceWorkerGlobalScope) {
  const retiredPaths = ["/halo", "/halo-preview"];
  const scope = new URL(self.registration.scope);

  if (retiredPaths.some(path => scope.pathname === `${path}/`)) {
    self.addEventListener("install", event => event.waitUntil(self.skipWaiting()));
    self.addEventListener("activate", event => {
      event.waitUntil((async () => {
        await self.registration.unregister();
        const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        await Promise.allSettled(windows.map(client => {
          const current = new URL(client.url);
          if (current.origin !== scope.origin || !retiredPaths.some(path =>
            current.pathname === path || current.pathname.startsWith(`${path}/`))) {
            return undefined;
          }
          const destination = new URL("/combat-lab/", scope.origin);
          destination.search = current.search;
          destination.hash = current.hash;
          return client.navigate(destination.href);
        }));
      })());
    });
  }
}
