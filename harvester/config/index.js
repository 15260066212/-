/**
 * Shared configuration and state for the harvester service.
 * All modules import from here to avoid circular dependencies.
 */

const fs = require('fs');
const path = require('path');
const { FingerprintGenerator } = require('fingerprint-generator');
const { FingerprintInjector } = require('fingerprint-injector');
const { sessions: remoteSessions } = require('../remote-browser');

const PORT = process.env.PORT || 3003;
const NOVNC_BASE = process.env.NOVNC_BASE_URL || '/novnc';
const CREDENTIALS_DIR = process.env.CREDENTIALS_DIR || path.join(__dirname, '..', 'data');
const CREDENTIALS_FILE = path.join(CREDENTIALS_DIR, 'credentials.json');
const MAIN_SERVER_URL = process.env.MAIN_SERVER_URL || 'http://localhost:3000';
const SESSION_TIMEOUT = 10 * 60 * 1000;

// 节点标识：用于多机部署时隔离凭证，避免互相覆盖
// 优先级: NODE_ID > HARVESTER_NODE_NAME > 'default'
const NODE_ID = process.env.NODE_ID || process.env.HARVESTER_NODE_NAME || 'default';
const NODE_NAME = process.env.NODE_NAME || NODE_ID;

try {
  if (!fs.existsSync(CREDENTIALS_DIR)) {
    fs.mkdirSync(CREDENTIALS_DIR, { recursive: true });
  }
  if (!fs.existsSync(CREDENTIALS_FILE)) {
    fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify({}), 'utf-8');
  }

  // Clean up any leftover temporary session profile directories from previous runs.
  // Each session gets its own profile dir under browser-profiles/sessions/ to allow
  // unlimited concurrent sessions per platform. They should be cleaned up on close,
  // but if the process crashed, some may be left behind.
  const sessionsProfileDir = path.join(CREDENTIALS_DIR, 'browser-profiles', 'sessions');
  if (fs.existsSync(sessionsProfileDir)) {
    try {
      const entries = fs.readdirSync(sessionsProfileDir);
      let cleaned = 0;
      for (const entry of entries) {
        const entryPath = path.join(sessionsProfileDir, entry);
        try {
          fs.rmSync(entryPath, { recursive: true, force: true });
          cleaned++;
        } catch { /* skip */ }
      }
      if (cleaned > 0) {
        console.log(`[Config] Cleaned up ${cleaned} leftover session profile directories`);
      }
    } catch (e) {
      console.warn('[Config] Failed to clean session profiles:', e.message);
    }
  }
} catch (e) {
  console.error('[Credentials] Failed to initialize storage:', e.message);
}

const fingerprintGenerator = new FingerprintGenerator({
  devices: ['desktop'],
  operatingSystems: ['windows'],
  browsers: [{ name: 'chrome', minVersion: 120 }],
  locales: ['zh-CN'],
  screen: { minWidth: 1366, maxWidth: 1920, minHeight: 768, maxHeight: 1080 },
});
const fingerprintInjector = new FingerprintInjector();

const sessions = new Map();

const {
  loadCredentials: loadCredentialsFromFile,
  saveCredentials: saveCredentialsToFile,
  getCredential: getCredentialFromFile,
  getAllCredentials: getAllCredentialsFromFile,
  upsertCredential: upsertCredentialToFile,
  deleteCredential: deleteCredentialFromFile,
} = require('../lib/credentials-store');

function loadCredentials() {
  return loadCredentialsFromFile(CREDENTIALS_FILE);
}

function saveCredentials(creds) {
  return saveCredentialsToFile(CREDENTIALS_FILE, creds);
}

function upsertCredential(key, data) {
  return upsertCredentialToFile(CREDENTIALS_FILE, key, data);
}

function getCredential(platform) {
  return getCredentialFromFile(CREDENTIALS_FILE, platform);
}

function getAllCredentials() {
  return getAllCredentialsFromFile(CREDENTIALS_FILE);
}

function deleteCredential(platform) {
  return deleteCredentialFromFile(CREDENTIALS_FILE, platform);
}

async function closeSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return;

  const userDataDir = session.userDataDir;
  const platform = session.platform;
  const accountName = session.accountName || 'default';
  const loggedIn = session.loggedIn || false;

  try {
    if (session.page) await session.page.close().catch(() => {});
    if (session.context) await session.context.close().catch(() => {});
    if (session.browser) await session.browser.close().catch(() => {});
  } catch (e) {
    console.error(`Error closing browser for session ${sessionId}:`, e.message);
  } finally {
    sessions.delete(sessionId);
    remoteSessions.delete(sessionId);

    // Handle session profile directory
    if (userDataDir && fs.existsSync(userDataDir)) {
      // Only handle if it's under the sessions/ directory (temp profiles)
      // Don't touch base profiles (chrome-{account}-{platform})
      if (userDataDir.includes(path.join('browser-profiles', 'sessions'))) {
        if (loggedIn && platform) {
          // If user logged in, save as persistent profile instead of deleting
          const profilesDir = path.join(CREDENTIALS_DIR, 'browser-profiles');
          const targetDirName = `chrome-${accountName}-${platform}`;
          const targetDir = path.join(profilesDir, targetDirName);

          try {
            // If target already exists, back it up first
            if (fs.existsSync(targetDir)) {
              const backupDir = `${targetDir}.bak.${Date.now()}`;
              fs.renameSync(targetDir, backupDir);
              console.log(`[Profile] Backed up old profile: ${targetDirName}`);
            }

            // Move temp session profile to persistent location
            fs.renameSync(userDataDir, targetDir);
            console.log(`[Profile] Saved persistent profile: ${targetDirName}`);
          } catch (e) {
            console.warn(`[Profile] Failed to save profile: ${e.message}`);
            // Fallback: try to clean up temp dir
            try {
              fs.rmSync(userDataDir, { recursive: true, force: true });
            } catch {}
          }
        } else {
          // Not logged in — clean up temporary directory to prevent disk bloat
          try {
            fs.rmSync(userDataDir, { recursive: true, force: true });
            console.log(`[Session] Cleaned up profile dir for ${sessionId}`);
          } catch (e) {
            console.warn(`[Session] Failed to clean up profile dir: ${e.message}`);
          }
        }
      }
    }
  }
}

function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.createdAt.getTime() > SESSION_TIMEOUT) {
      console.log(`[Cleanup] Session ${id} expired, closing...`);
      closeSession(id).catch((e) => console.error(`Error closing session ${id}:`, e.message));
    }
  }
}

setInterval(cleanupExpiredSessions, 60 * 1000);

module.exports = {
  PORT,
  NOVNC_BASE,
  CREDENTIALS_DIR,
  CREDENTIALS_FILE,
  MAIN_SERVER_URL,
  SESSION_TIMEOUT,
  NODE_ID,
  NODE_NAME,
  fingerprintGenerator,
  fingerprintInjector,
  sessions,
  remoteSessions,
  loadCredentials,
  saveCredentials,
  upsertCredential,
  getCredential,
  getAllCredentials,
  deleteCredential,
  closeSession,
  cleanupExpiredSessions,
};
