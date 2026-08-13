/*
 * KidLedger cloud sync — Google Drive.
 *
 * Stores the whole ledger as a single private JSON file ("kidledger.json") in
 * the user's Google Drive, using the `drive.file` scope so the app can only ever
 * see the file it created — never the rest of your Drive.
 *
 * Auth is client-side only (Google Identity Services token model); there is no
 * server and no stored secret. The OAuth Client ID is public and is entered by
 * the user in Settings.
 *
 * The sync DECISION is a pure function (planSync) so it can be unit-tested in
 * Node; everything that touches the network or `window` is guarded and only runs
 * in the browser.
 */
(function (global) {
  'use strict';

  var FILE_NAME = 'parity.json';
  var LEGACY_FILE_NAME = 'kidledger.json'; // pre-rebrand; still found and adopted
  var SCOPE = 'https://www.googleapis.com/auth/drive.file';
  var META_KEY = 'parity.sync';
  var LEGACY_META_KEY = 'kidledger.sync';
  var PRESYNC_KEY = 'parity.presync';

  /**
   * Decide what a sync should do, given four timestamps (ms; 0 if unknown).
   *   remoteExists     — is there a file in Drive yet?
   *   localUpdatedAt   — this device's document timestamp
   *   remoteUpdatedAt  — the Drive document's timestamp (embedded in its content)
   *   baseUpdatedAt    — the timestamp we last reconciled with Drive
   * Returns: 'create' | 'in-sync' | 'push' | 'pull' | 'conflict'.
   */
  function planSync(o) {
    if (!o.remoteExists) return 'create';
    var localChanged = (o.localUpdatedAt || 0) !== (o.baseUpdatedAt || 0);
    var remoteChanged = (o.remoteUpdatedAt || 0) !== (o.baseUpdatedAt || 0);
    if (!localChanged && !remoteChanged) return 'in-sync';
    if (localChanged && !remoteChanged) return 'push';
    if (!localChanged && remoteChanged) return 'pull';
    return 'conflict';
  }

  // ----- Browser-only controller ------------------------------------------
  var KidLedgerSync = {
    planSync: planSync,
    _cfg: null,
    meta: { clientId: '', fileId: '', base: 0, connected: false, autosync: true, lastSyncAt: 0 },
    _token: '',
    _tokenExp: 0,
    _tokenClient: null,
    _pendingConflict: null,

    init: function (cfg) {
      this._cfg = cfg; // { getState, applyRemote, onStatus }
      this._loadMeta();
      this._status(this.meta.connected ? 'idle' : 'disconnected');
      return this;
    },

    // ---- persistence of sync metadata (not the ledger itself) ----
    _loadMeta: function () {
      try {
        var raw = localStorage.getItem(META_KEY) || localStorage.getItem(LEGACY_META_KEY);
        if (raw) this.meta = Object.assign(this.meta, JSON.parse(raw));
      } catch (e) { /* ignore */ }
    },
    _persist: function () {
      try { localStorage.setItem(META_KEY, JSON.stringify(this.meta)); } catch (e) { /* ignore */ }
    },
    _status: function (state, msg) {
      if (this._cfg && this._cfg.onStatus) this._cfg.onStatus(state, msg || '', this.meta);
    },
    _snapshot: function (obj) {
      try { localStorage.setItem(PRESYNC_KEY, JSON.stringify({ at: Date.now(), state: obj })); } catch (e) { /* ignore */ }
    },

    setClientId: function (id) { this.meta.clientId = (id || '').trim(); this._persist(); },
    setAutoSync: function (on) { this.meta.autosync = !!on; this._persist(); },
    isConfigured: function () { return !!this.meta.clientId; },
    isConnected: function () { return !!this.meta.connected; },

    // ---- OAuth token (Google Identity Services) ----
    _getToken: function (interactive) {
      var self = this;
      return new Promise(function (resolve, reject) {
        if (!global.google || !global.google.accounts || !global.google.accounts.oauth2) {
          return reject(new Error('Google sign-in is not available. Make sure you are online and running the hosted (https) version.'));
        }
        if (!self.meta.clientId) return reject(new Error('Add your Google Client ID first.'));
        if (self._token && Date.now() < self._tokenExp) return resolve(self._token);

        if (!self._tokenClient) {
          self._tokenClient = global.google.accounts.oauth2.initTokenClient({
            client_id: self.meta.clientId,
            scope: SCOPE,
            callback: function (resp) {
              if (resp && resp.error) { if (self._tokenReject) self._tokenReject(new Error(resp.error)); return; }
              self._token = resp.access_token;
              self._tokenExp = Date.now() + ((resp.expires_in ? resp.expires_in * 1000 : 3600000) - 60000);
              if (self._tokenResolve) self._tokenResolve(self._token);
            },
          });
        }
        self._tokenResolve = resolve;
        self._tokenReject = reject;
        try {
          self._tokenClient.requestAccessToken({ prompt: interactive ? 'consent' : '' });
        } catch (e) { reject(e); }
      });
    },

    _api: function (token, url, opts) {
      opts = opts || {};
      opts.headers = Object.assign({ Authorization: 'Bearer ' + token }, opts.headers || {});
      return fetch(url, opts).then(function (res) {
        if (!res.ok) return res.text().then(function (t) { throw new Error('Drive error ' + res.status + ': ' + t.slice(0, 200)); });
        return res;
      });
    },

    _find: function (token) {
      var url = 'https://www.googleapis.com/drive/v3/files?q=' +
        encodeURIComponent("(name='" + FILE_NAME + "' or name='" + LEGACY_FILE_NAME + "') and trashed=false") +
        '&spaces=drive&fields=' + encodeURIComponent('files(id,modifiedTime,name)') + '&pageSize=5';
      return this._api(token, url).then(function (r) { return r.json(); }).then(function (j) {
        if (!j.files || !j.files.length) return null;
        // Prefer the current filename; otherwise adopt the legacy file.
        for (var i = 0; i < j.files.length; i++) if (j.files[i].name === FILE_NAME) return j.files[i];
        return j.files[0];
      });
    },
    _download: function (token, id) {
      return this._api(token, 'https://www.googleapis.com/drive/v3/files/' + id + '?alt=media')
        .then(function (r) { return r.json(); });
    },
    _create: function (token, obj) {
      var boundary = 'kidledger' + Date.now();
      var meta = { name: FILE_NAME, mimeType: 'application/json' };
      var body = '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
        JSON.stringify(meta) + '\r\n--' + boundary +
        '\r\nContent-Type: application/json\r\n\r\n' + JSON.stringify(obj) + '\r\n--' + boundary + '--';
      return this._api(token, 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,modifiedTime', {
        method: 'POST',
        headers: { 'Content-Type': 'multipart/related; boundary=' + boundary },
        body: body,
      }).then(function (r) { return r.json(); });
    },
    _update: function (token, id, obj) {
      return this._api(token, 'https://www.googleapis.com/upload/drive/v3/files/' + id + '?uploadType=media&fields=id,modifiedTime', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(obj),
      }).then(function (r) { return r.json(); });
    },

    // ---- high-level flows ----
    connect: function () {
      this.meta.connected = true;
      this._persist();
      return this.syncNow(true);
    },
    disconnect: function () {
      if (this._token && global.google && global.google.accounts && global.google.accounts.oauth2) {
        try { global.google.accounts.oauth2.revoke(this._token, function () {}); } catch (e) { /* ignore */ }
      }
      this._token = ''; this._tokenExp = 0;
      this.meta.connected = false;
      this._persist();
      this._status('disconnected');
    },

    syncNow: function (interactive) {
      var self = this;
      self._status('syncing');
      return self._getToken(interactive).then(function (token) {
        return self._find(token).then(function (file) {
          var local = self._cfg.getState();
          if (!file) {
            return self._create(token, local).then(function (created) {
              self.meta.fileId = created.id;
              self.meta.base = local.updatedAt || 0;
              self.meta.lastSyncAt = Date.now();
              self._persist();
              self._status('synced');
              return { action: 'create' };
            });
          }
          self.meta.fileId = file.id;
          return self._download(token, file.id).then(function (remote) {
            var plan = planSync({
              remoteExists: true,
              remoteUpdatedAt: (remote && remote.updatedAt) || 0,
              localUpdatedAt: local.updatedAt || 0,
              baseUpdatedAt: self.meta.base || 0,
            });
            if (plan === 'in-sync') {
              self.meta.lastSyncAt = Date.now(); self._persist(); self._status('synced');
              return { action: 'in-sync' };
            }
            if (plan === 'push') {
              return self._update(token, file.id, local).then(function () {
                self.meta.base = local.updatedAt || 0; self.meta.lastSyncAt = Date.now();
                self._persist(); self._status('synced');
                return { action: 'push' };
              });
            }
            if (plan === 'pull') {
              self._snapshot(local);
              self._cfg.applyRemote(remote);
              self.meta.base = remote.updatedAt || 0; self.meta.lastSyncAt = Date.now();
              self._persist(); self._status('synced');
              return { action: 'pull' };
            }
            // conflict
            self._pendingConflict = { remote: remote, fileId: file.id };
            self._status('conflict');
            return { action: 'conflict', remote: remote };
          });
        });
      }).catch(function (e) {
        self._status('error', e.message);
        throw e;
      });
    },

    resolveConflict: function (choice) {
      var self = this;
      var c = self._pendingConflict;
      if (!c) return Promise.resolve();
      return self._getToken(true).then(function (token) {
        if (choice === 'local') {
          var local = self._cfg.getState();
          return self._update(token, c.fileId, local).then(function () {
            self.meta.base = local.updatedAt || 0;
          });
        }
        self._snapshot(self._cfg.getState());
        self._cfg.applyRemote(c.remote);
        self.meta.base = c.remote.updatedAt || 0;
        return null;
      }).then(function () {
        self._pendingConflict = null;
        self.meta.lastSyncAt = Date.now();
        self._persist();
        self._status('synced');
      });
    },
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { planSync: planSync, KidLedgerSync: KidLedgerSync };
  } else {
    global.KidLedgerSync = KidLedgerSync;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
