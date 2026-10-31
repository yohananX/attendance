export default function OfflinePage() {
  return (
    <main className="app-shell app-shell--narrow offline-screen">
      <p className="eyebrow">Connection paused</p>
      <h1>You’re offline</h1>
      <p>If you have already signed in on this phone, return to today’s attendance. New records will be saved here and sync when you reconnect.</p>
      <a className="button button-primary" href="/dashboard">Return to attendance</a>
    </main>
  );
}
