'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Load credentials from a JSON file.
 * Returns empty object if file doesn't exist or is invalid.
 *
 * @param {string} filePath - Path to credentials JSON file
 * @returns {object} Parsed credentials object
 */
function loadCredentials(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * Save credentials to a JSON file.
 * Creates parent directory if it doesn't exist.
 *
 * @param {string} filePath - Path to credentials JSON file
 * @param {object} data - Credentials data to save
 * @returns {boolean} true if save succeeded
 */
function saveCredentials(filePath, data) {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (e) {
    console.error('[Credentials] Failed to save:', e.message);
    return false;
  }
}

/**
 * Get credentials for a specific key.
 *
 * @param {string} filePath - Path to credentials JSON file
 * @param {string} key - Credential key (e.g. "accountName:platform")
 * @returns {object|null} Credential data or null
 */
function getCredential(filePath, key) {
  const creds = loadCredentials(filePath);
  return creds[key] || null;
}

/**
 * Get all credentials.
 *
 * @param {string} filePath - Path to credentials JSON file
 * @returns {object} All credentials keyed by platform
 */
function getAllCredentials(filePath) {
  return loadCredentials(filePath);
}

/**
 * Insert or update credentials for a key.
 * Automatically sets key and updatedAt timestamp.
 *
 * @param {string} filePath - Path to credentials JSON file
 * @param {string} key - Credential key (e.g. "accountName:platform")
 * @param {object} data - Credential data to upsert
 * @returns {boolean} true if save succeeded
 */
function upsertCredential(filePath, key, data) {
  const creds = loadCredentials(filePath);
  creds[key] = {
    ...data,
    platform: key,
    updatedAt: new Date().toISOString(),
  };
  return saveCredentials(filePath, creds);
}

/**
 * Delete credentials for a platform.
 *
 * @param {string} filePath - Path to credentials JSON file
 * @param {string} platform - Platform name
 * @returns {boolean} true if platform was deleted, false if not found
 */
function deleteCredential(filePath, platform) {
  const creds = loadCredentials(filePath);
  if (!creds[platform]) {
    return false;
  }
  delete creds[platform];
  return saveCredentials(filePath, creds);
}

module.exports = {
  loadCredentials,
  saveCredentials,
  getCredential,
  getAllCredentials,
  upsertCredential,
  deleteCredential,
};
