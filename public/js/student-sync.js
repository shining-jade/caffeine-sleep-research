(function () {
  'use strict';
  const actions = new Set(['saveCaffeineData', 'saveSleepData', 'saveInitialSetup']);
  const ownerKey = s => JSON.stringify([s.studentId, s.name]);
  const clone = v => JSON.parse(JSON.stringify(v));
  function error(code) { return Object.assign(new Error(code), { code }); }
  function indexedStore() {
    let database;
    function open() {
      if (!database) database = new Promise((resolve, reject) => {
        const req = indexedDB.open('student-records-v1', 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          db.createObjectStore('records', { keyPath: 'mutationId' }).createIndex('owner', 'owner');
          db.createObjectStore('snapshots'); db.createObjectStore('leases');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => { database = null; reject(error('DEVICE_STORAGE_FAILED')); };
        req.onblocked = () => { database = null; reject(error('DEVICE_STORAGE_BLOCKED')); };
      });
      return database;
    }
    async function transaction(name, mode, run) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(name, mode); let result;
        tx.oncomplete = () => resolve(result);
        tx.onerror = tx.onabort = () => reject(error('DEVICE_STORAGE_FAILED'));
        run(tx.objectStore(name), v => { result = v; });
      });
    }
    return {
      put: row => transaction('records', 'readwrite', s => s.put(row)),
      list: owner => transaction('records', 'readonly', (s, done) => { const req = s.index('owner').getAll(owner); req.onsuccess = () => done(req.result); }),
      snapshot: (key, value) => transaction('snapshots', value === undefined ? 'readonly' : 'readwrite', (s, done) => {
        const req = value === undefined ? s.get(key) : s.put(value, key); req.onsuccess = () => done(req.result);
      }),
      mutateSnapshot: (key, apply) => transaction('snapshots', 'readwrite', (s, done) => {
        const req = s.get(key); req.onsuccess = () => {
          const value = apply(req.result);
          if (value !== undefined) s.put(value, key);
          done(value);
        };
      }),
      lease: (key, token) => transaction('leases', 'readwrite', (s, done) => {
        const req = s.get(key); req.onsuccess = () => {
          const old = req.result;
          if (old && old.token !== token && old.until > Date.now()) return done(false);
          s.put({ token, until: Date.now() + 90000 }, key); done(true);
        };
      }),
      release: (key, token) => transaction('leases', 'readwrite', s => {
        const req = s.get(key); req.onsuccess = () => { if (req.result?.token === token) s.delete(key); };
      }),
    };
  }
  function create({ store = indexedStore(), send, onChange = () => {}, online = () => true }) {
    let subject = null, generation = 0, running = null, retryTimer = null, enqueued = 0;
    const token = crypto.randomUUID();
    let snapshotQueue = Promise.resolve();
    function serializeSnapshot(work) {
      const g = generation;
      const pending = snapshotQueue.then(() => {
        if (g !== generation) throw error('SESSION_CHANGED');
        return work();
      });
      snapshotQueue = pending.catch(() => {});
      return pending;
    }
    const instance = { store, setSubject, enqueue, flush, list, capture, read, editPending, cancelPending, forgetRecord, confirmRecordMutation };
    function setSubject(value) { subject = value ? clone(value) : null; generation++; clearTimeout(retryTimer); }
    async function list() { return subject ? store.list(ownerKey(subject)) : []; }
    async function changed() { try { await onChange(await list()); } catch (_) {} }
    async function enqueue(action, payload) {
      if (!subject || !actions.has(action)) throw error('SESSION_REQUIRED');
      const g = generation, who = clone(subject), owner = ownerKey(who);
      const data = clone(payload);
      delete data.id; delete data._sync;
      if (action === 'saveInitialSetup') {
        const profile = await store.snapshot(owner + ':getWeightData');
        if (typeof profile?.syncVersion !== 'string') throw error('SYNC_PROFILE_REQUIRED');
        data._sync = { baseVersion: profile.syncVersion };
      }
      const row = { schema: 1, mutationId: crypto.randomUUID(), owner, subject: who, action, payload: data,
        createdAt: Date.now(), state: 'pending', attempts: 0, nextAt: 0 };
      if (g !== generation) throw error('SESSION_CHANGED');
      await store.put(row);
      enqueued++;
      if (g !== generation) throw error('SESSION_CHANGED');
      await changed();
      // Fire the initial attempt immediately, without delaying the local-save callback.
      void flush();
      return { success: true, localSaved: true, queued: true, mutationId: row.mutationId,
        record: localRecord(row) };
    }
    function flush(force = false) {
      if (running) return running;
      const g = generation, who = subject && clone(subject), queuedAtStart = enqueued;
      running = (async () => {
        if (!who || !online()) return;
        const owner = ownerKey(who);
        if (!await store.lease(owner, token)) return;
        try {
          const rows = (await store.list(owner)).sort((a, b) => a.createdAt - b.createdAt);
          let version;
          for (const row of rows) {
            if (g !== generation || !online()) break;
            if (row.state === 'synced' || row.state === 'cancelled') continue;
            if (row.state === 'needsAttention') continue;
            if (!force && row.nextAt > Date.now()) break;
            if (!await store.lease(owner, token) || g !== generation) break;
            row.state = 'sending'; row.attempts++;
            if (row.action === 'saveInitialSetup' && version) row.payload._sync.baseVersion = version;
            await store.put(row); await changed();
            try {
              const payload = clone(row.payload);
              payload._sync = { ...payload._sync, mutationId: row.mutationId };
              if (g !== generation) break;
              const receipt = await send(row.action, payload, who);
              if (receipt?.success !== true || receipt.mutationId !== row.mutationId || !receipt.committedAt) {
                throw error(receipt?.error || 'SYNC_UNCONFIRMED');
              }
              row.state = 'synced'; row.receipt = receipt; row.nextAt = 0; row.lastError = null;
              await store.put(row);
              if (receipt.version) {
                version = receipt.version;
                await store.snapshot(owner + ':getWeightData', { success: true, ...row.payload, syncVersion: version });
                // Persist the next queued profile baseline before the next network call.
                for (const next of rows) if (next.createdAt >= row.createdAt && next.mutationId !== row.mutationId && next.action === 'saveInitialSetup' && next.state === 'pending' && next.attempts === 0) {
                  next.payload._sync.baseVersion = version; await store.put(next);
                }
                for (const old of rows) if (old.createdAt <= row.createdAt && old.mutationId !== row.mutationId && old.action === 'saveInitialSetup' && old.state === 'needsAttention') {
                  old.state = 'cancelled'; await store.put(old);
                }
              }
            } catch (e) {
              const code = e.code || 'NETWORK_ERROR';
              row.lastError = code;
              row.state = ['SYNC_CONFLICT', 'SYNC_PROFILE_REQUIRED', 'ACTION_NOT_ALLOWED', 'REQUEST_REJECTED'].includes(code) || (e.status >= 400 && e.status < 500 && ![401, 409, 429].includes(e.status)) ? 'needsAttention' : 'pending';
              row.nextAt = Date.now() + Math.min(60000, 2000 * Math.pow(2, Math.min(row.attempts, 5)));
              await store.put(row); await changed();
              if (e.status === 401 || code === 'SESSION_CHANGED') break;
              if (g === generation && row.state === 'pending') retryTimer = setTimeout(() => { void flush(); }, Math.max(1000, row.nextAt - Date.now()));
              break;
            }
            await changed();
          }
        } finally { await store.release(owner, token); }
      })().catch(() => {}).finally(() => {
        running = null;
        if (g === generation && enqueued > queuedAtStart) void flush();
      });
      return running;
    }
    function snapshotAction(action, params) {
      // Older action-only filtered snapshots have no trustworthy period and are intentionally unused.
      return action === 'getFilteredStats' ? action + ':' + String(params?.[1] || '') : action;
    }
    function capture(action, value, params) {
      return serializeSnapshot(() => captureSnapshot(action, value, params));
    }
    async function captureSnapshot(action, value, params) {
      if (!subject) return value;
      const g = generation, key = ownerKey(subject);
      try {
        if (action === 'getStudentBootstrap') {
          await store.snapshot(key + ':getWeightData', value.weight);
          await store.snapshot(key + ':getCaffeineLogs', value.caffeineLogs);
          await store.snapshot(key + ':getSleepLogs', value.sleepLogs);
        }
        await store.snapshot(key + ':' + snapshotAction(action, params), value);
        const histories = action === 'getStudentBootstrap' ? [value.caffeineLogs, value.sleepLogs] : [value];
        for (const records of histories) if (Array.isArray(records)) {
          for (const row of await store.list(key)) if (row.state === 'synced' && records.some(r => String(r.id) === String(row.receipt?.recordId))) {
            row.serverObserved = true; await store.put(row);
          }
        }
      } catch (_) {}
      if (g !== generation) return value;
      const merged = await read(action, value, params);
      if (action === 'getWeightData') window.studentSyncProfile = merged;
      if (action === 'getStudentBootstrap') window.studentSyncProfile = merged.weight;
      await changed();
      return merged;
    }
    async function read(action, supplied, params) {
      if (!subject) throw error('SESSION_REQUIRED');
      const g = generation, owner = ownerKey(subject);
      const value = supplied === undefined ? await store.snapshot(owner + ':' + snapshotAction(action, params)) : supplied;
      if (g !== generation) throw error('SESSION_CHANGED');
      const rows = (await store.list(owner)).filter(r => r.state !== 'cancelled');
      if (g !== generation) throw error('SESSION_CHANGED');
      if (action === 'getStudentBootstrap') {
        if (!value) throw error('OFFLINE_CACHE_MISSING');
        return { ...value, weight: await read('getWeightData', supplied === undefined ? undefined : value.weight), caffeineLogs: await read('getCaffeineLogs', supplied === undefined ? undefined : value.caffeineLogs), sleepLogs: await read('getSleepLogs', supplied === undefined ? undefined : value.sleepLogs) };
      }
      if (action === 'getWeightData') {
        const latest = rows.filter(r => r.action === 'saveInitialSetup' && r.state !== 'synced').sort((a, b) => b.createdAt - a.createdAt)[0];
        if (latest) return { ...value, success: true, ...latest.payload, localPending: true, syncVersion: value?.syncVersion };
      }
      if (action === 'getCaffeineLogs' || action === 'getSleepLogs') {
        const matching = rows.filter(r => r.action === (action === 'getCaffeineLogs' ? 'saveCaffeineData' : 'saveSleepData') && (r.state !== 'synced' || (supplied === undefined && !r.serverObserved)));
        const records = Array.isArray(value) ? clone(value) : [];
        for (const row of matching) {
          const record = localRecord(row);
          if (action === 'getSleepLogs') {
            for (let i = records.length - 1; i >= 0; i--) if (records[i].date === record.date && records[i].id !== record.id) records.splice(i, 1);
          }
          if (!records.some(r => String(r.id) === String(record.id))) records.push(record);
        }
        return records;
      }
      if (value === undefined || value === null) throw error('OFFLINE_CACHE_MISSING');
      return value;
    }
    async function editPending(mutationId, patch) {
      const row = (await list()).find(r => r.mutationId === mutationId);
      // Once attempted, an uncertain server commit makes edits unsafe; keep immutable identity.
      if (!row || row.attempts > 0 || row.state !== 'pending') throw error('SYNC_EDIT_REQUIRES_CONNECTION');
      row.payload = { ...row.payload, ...clone(patch) }; await store.put(row); await changed(); void flush();
    }
    async function forgetRecord(id) {
      for (const row of await list()) if (row.state === 'synced' && String(row.receipt?.recordId) === String(id)) {
        row.serverObserved = true; await store.put(row);
      }
    }
    function confirmRecordMutation(action, params) {
      return serializeSnapshot(() => applyConfirmedRecordMutation(action, params));
    }
    async function applyConfirmedRecordMutation(action, params) {
      if (!subject || !['updateCaffeineData','updateSleepData','deleteCaffeineData','deleteSleepData'].includes(action)) return;
      const g = generation, owner = ownerKey(subject), updating = action.startsWith('update');
      const patch = updating ? clone(params[0]) : null, id = String(updating ? patch.id : params[0]);
      const caffeine = action.endsWith('CaffeineData'), history = caffeine ? 'getCaffeineLogs' : 'getSleepLogs';
      function apply(records) {
        if (!Array.isArray(records)) return records;
        if (!updating) return records.filter(record => String(record.id) !== id);
        return records.map(record => String(record.id) !== id ? record : caffeine
          ? { ...record, name: patch.drink, amount: patch.mg, time: patch.time, reason: patch.reason || '', symptom: patch.symptom || '' }
          : { ...record, ...patch, start: patch.sleepTime, end: patch.wakeTime });
      }
      async function mutate(key, transform) {
        if (g !== generation) throw error('SESSION_CHANGED');
        if (store.mutateSnapshot) return store.mutateSnapshot(key, transform);
        const saved = await store.snapshot(key);
        if (g !== generation) throw error('SESSION_CHANGED');
        const next = transform(saved);
        if (next !== undefined) await store.snapshot(key, next);
      }
      await mutate(owner + ':' + history, apply);
      await mutate(owner + ':getStudentBootstrap', bootstrap => {
        const field = caffeine ? 'caffeineLogs' : 'sleepLogs';
        return bootstrap ? { ...bootstrap, [field]: apply(bootstrap[field]) } : bootstrap;
      });
      if (g !== generation) throw error('SESSION_CHANGED');
      await forgetRecord(id);
      await changed();
    }
    async function cancelPending(mutationId) {
      const row = (await list()).find(r => r.mutationId === mutationId);
      if (!row || row.attempts > 0 || row.state !== 'pending') throw error('SYNC_EDIT_REQUIRES_CONNECTION');
      row.state = 'cancelled'; await store.put(row); await changed();
    }
    return instance;
  }
  function localRecord(row) {
    const p = row.payload;
    const common = { id: row.receipt?.recordId || 'local_' + row.mutationId, localMutationId: row.mutationId, localPending: row.state !== 'synced', syncState: row.state };
    if (row.action === 'saveCaffeineData') return { ...common, name: p.drink, company: p.company || '', foodName: p.foodName || '', amount: Number(p.mg), time: p.time, reason: p.reason || '', symptom: p.symptom || '' };
    if (row.action === 'saveSleepData') return { ...p, ...common, date: p.date, start: p.sleepTime, end: p.wakeTime, wakeDate: p.wakeDate, hours: p.hours, condition: p.condition, memo: p.memo };
    return null;
  }
  window.StudentSync = { create, indexedStore, localRecord, actions };
}());
