var plugin = (() => {
  const storage = bunny.plugin.createStorage();
  let unpatch = null;
  let React = null;
  let RN = null;

  const offlineStatuses = new Set(['offline', 'unknown', 'invisible']);
  const visibleStatuses = new Set(['online', 'idle', 'dnd', 'mobile', 'streaming']);

  function ensureState() {
    storage.lastSeenByUserId ??= {};
    return storage.lastSeenByUserId;
  }

  function pickName(update) {
    return update?.user?.global_name
      || update?.user?.globalName
      || update?.user?.display_name
      || update?.user?.username
      || update?.global_name
      || update?.globalName
      || update?.display_name
      || update?.username
      || update?.nick
      || update?.nickname
      || null;
  }

  function pickUserId(update) {
    return update?.user_id
      || update?.userId
      || update?.user?.id
      || update?.id
      || null;
  }

  function pickStatus(update) {
    const raw = update?.status
      || update?.client_status?.desktop
      || update?.clientStatus?.desktop
      || update?.client_status
      || update?.clientStatus
      || null;

    return typeof raw === 'string' ? raw.toLowerCase() : null;
  }

  function flattenUpdates(payload) {
    const out = [];
    if (!payload || typeof payload !== 'object') return out;

    if (Array.isArray(payload.updates)) out.push(...payload.updates);
    if (Array.isArray(payload.presences)) out.push(...payload.presences);
    if (Array.isArray(payload.users)) out.push(...payload.users);
    if (payload.presence && typeof payload.presence === 'object') out.push(payload.presence);
    if (payload.user && typeof payload.user === 'object') out.push(payload);
    if (payload.user_id || payload.userId || payload.id) out.push(payload);

    return out;
  }

  function record(update) {
    const userId = pickUserId(update);
    if (!userId) return;

    const status = pickStatus(update);
    if (!status) return;

    const state = ensureState();
    const previous = state[userId] || {};
    const previousStatus = previous.status || null;
    const next = {
      userId,
      name: pickName(update) || previous.name || null,
      status,
      updatedAt: Date.now(),
      lastSeenAt: previous.lastSeenAt || null,
    };

    if ((previousStatus && visibleStatuses.has(previousStatus) && offlineStatuses.has(status)) || (previousStatus === null && offlineStatuses.has(status) && previous.lastSeenAt)) {
      next.lastSeenAt = Date.now();
    }

    state[userId] = next;
  }

  function onFlux(payload) {
    if (!payload || typeof payload !== 'object') return;
    const type = String(payload.type || '');
    if (!type.includes('PRESENCE') && !type.includes('STATUS')) return;

    const updates = flattenUpdates(payload);
    for (const update of updates) record(update);
  }

  function formatDate(ts) {
    if (!ts) return 'never seen online';
    try {
      return new Date(ts).toLocaleString(undefined, {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return String(ts);
    }
  }

  function getDisplayLabel(entry) {
    return entry?.name || entry?.userId || 'unknown user';
  }

  function ensureUi() {
    if (!React) React = bunny.metro.findExports(m => m?.createElement && m?.useMemo && m?.Fragment);
    if (!RN) RN = bunny.metro.findExports(m => m?.View && m?.Text && m?.ScrollView && m?.StyleSheet);
    return Boolean(React && RN);
  }

  function SettingsComponent() {
    if (!ensureUi()) {
      return null;
    }

    const { View, Text, ScrollView, StyleSheet } = RN;
    const styles = StyleSheet.create({
      container: { flex: 1, padding: 16 },
      section: { marginBottom: 16 },
      heading: { fontSize: 18, fontWeight: '700', marginBottom: 8 },
      body: { fontSize: 14, opacity: 0.9, marginBottom: 8 },
      row: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.12)' },
      name: { fontSize: 15, fontWeight: '600' },
      meta: { fontSize: 13, opacity: 0.8, marginTop: 4 },
      empty: { fontSize: 14, opacity: 0.7, fontStyle: 'italic' },
    });

    const entries = Object.values(ensureState()).sort((a, b) => (b.lastSeenAt || 0) - (a.lastSeenAt || 0));

    return React.createElement(
      ScrollView,
      { style: styles.container },
      React.createElement(
        View,
        { style: styles.section },
        React.createElement(Text, { style: styles.heading }, 'Revenge Last Seen'),
        React.createElement(Text, { style: styles.body }, 'Tracks the last observed online-to-offline transition for users the client has seen while this plugin is active.'),
        React.createElement(Text, { style: styles.body }, 'This is a local cache only; it cannot reconstruct history from before installation.'),
      ),
      React.createElement(
        View,
        { style: styles.section },
        React.createElement(Text, { style: styles.heading }, 'Tracked users (' + entries.length + ')'),
        entries.length === 0
          ? React.createElement(Text, { style: styles.empty }, 'No presence changes captured yet.')
          : entries.map(entry => React.createElement(
              View,
              { key: entry.userId, style: styles.row },
              React.createElement(Text, { style: styles.name }, getDisplayLabel(entry)),
              React.createElement(Text, { style: styles.meta }, 'user id: ' + entry.userId),
              React.createElement(Text, { style: styles.meta }, 'status: ' + (entry.status || 'unknown')),
              React.createElement(Text, { style: styles.meta }, entry.lastSeenAt ? ('last seen: ' + formatDate(entry.lastSeenAt)) : 'last seen: never observed online -> offline'),
            )),
      ),
    );
  }

  return {
    start() {
      ensureState();
      unpatch = bunny.api.flux.intercept(onFlux);
      bunny.plugin.logger.log('Revenge Last Seen started');
    },
    stop() {
      if (unpatch) unpatch();
      unpatch = null;
      bunny.plugin.logger.log('Revenge Last Seen stopped');
    },
    SettingsComponent,
  };
})();
