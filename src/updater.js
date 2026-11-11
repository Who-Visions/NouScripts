'use strict';
// Auto-updates via Electron's autoUpdater (Squirrel.Mac on macOS, Squirrel.Windows on Windows).
//
// It does nothing unless two things are true: the app is packaged (app.isPackaged) and a feed URL is configured
// (NOU_UPDATE_URL). Electron requires a signed app on macOS for updates to install, so until a signed build and
// a feed exist, the status reads "disabled" with the reason. An update is never installed by itself: when one
// is downloaded the window shows it, and the user chooses when to restart, and only while no job is running.
//
// autoUpdater is injected so the state machine can be tested without Electron.

const STATES = ['disabled', 'idle', 'checking', 'available', 'not-available', 'downloading', 'ready', 'error'];
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

function createUpdater({ autoUpdater, isPackaged, feedUrl, version, platform, arch, send, isBusy = () => false, setTimer = setInterval, clearTimer = clearInterval }) {
  let status = { state: 'idle', text: '' };
  let timer = null;
  let bound = false;

  const set = (state, text = '', extra = {}) => {
    status = { state, text, ...extra };
    if (send) send(status);
    return status;
  };

  function start() {
    if (!isPackaged) return set('disabled', 'Updates run in packaged builds only.');
    if (!feedUrl) return set('disabled', 'No update feed is configured (set NOU_UPDATE_URL).');
    if (!bound) bind();
    // Squirrel.Mac and Squirrel.Windows read the feed from here; the platform and version are part of the URL.
    const url = `${feedUrl.replace(/\/+$/, '')}/${platform}-${arch}/${version}`;
    autoUpdater.setFeedURL({ url });
    check();
    timer = setTimer(check, CHECK_EVERY_MS);
    return status;
  }

  function bind() {
    bound = true;
    autoUpdater.on('checking-for-update', () => set('checking', 'Checking for updates…'));
    autoUpdater.on('update-available', () => set('available', 'An update is available; downloading it.'));
    autoUpdater.on('update-not-available', () => set('not-available', 'You have the latest version.'));
    autoUpdater.on('download-progress', (p) => set('downloading', `Downloading update… ${Math.round(p.percent || 0)}%`, { percent: p.percent || 0 }));
    autoUpdater.on('update-downloaded', (_e, releaseNotes, releaseName) => set('ready', `${releaseName || 'A new version'} is ready. Restart to install it.`, { version: releaseName || '' }));
    autoUpdater.on('error', (err) => set('error', `Update check failed: ${err && err.message ? err.message : err}`));
  }

  function check() {
    if (status.state === 'disabled') return status;
    try { autoUpdater.checkForUpdates(); }
    catch (err) { set('error', `Update check failed: ${err.message}`); }
    return status;
  }

  // Restart only when the download is ready and no job is streaming (quitAndInstall would cut it off).
  function install() {
    if (status.state !== 'ready') return { ok: false, reason: 'No update is ready to install.' };
    if (isBusy()) return { ok: false, reason: 'A job is still running. Stop it or wait for it to finish, then try again.' };
    autoUpdater.quitAndInstall();
    return { ok: true };
  }

  function stop() { if (timer) clearTimer(timer); timer = null; }

  return { start, check, install, stop, status: () => status, STATES };
}

module.exports = { createUpdater, STATES, CHECK_EVERY_MS };
