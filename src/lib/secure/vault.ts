import { invoke } from "@tauri-apps/api/core";

export const VAULT_KEY_API_ID      = 'telegram_api_id';
export const VAULT_KEY_API_HASH    = 'telegram_api_hash';
export const VAULT_KEY_SESSION     = 'telegram_session';
export const VAULT_KEY_PHONE       = 'telegram_phone';
export const VAULT_KEY_CHANNEL_ID  = 'telegram_channel_id';

/**
 * Mock initVault function to maintain backwards compatibility with existing callers.
 * Because we use the reliable Rust file-backed key-value store, no initialisation is needed.
 */
export async function initVault(): Promise<void> {
  // Safe no-op
  return Promise.resolve();
}

/**
 * Saves a secret key-value pair to the local file-backed JSON store.
 */
export async function saveSecret(key: string, value: string): Promise<void> {
  try {
    await invoke("save_vault_value", { key, value });
  } catch (error) {
    console.error(`Failed to save secret for key ${key}:`, error);
    throw error;
  }
}

/**
 * Gets a secret value for a key from the local file-backed JSON store.
 */
export async function getSecret(key: string): Promise<string | null> {
  try {
    const val = await invoke<string | null>("load_vault_value", { key });
    return val;
  } catch (error) {
    console.warn(`Failed to get secret for key ${key}:`, error);
    return null;
  }
}

/**
 * Deletes a secret key-value pair from the local file-backed JSON store.
 */
export async function deleteSecret(key: string): Promise<void> {
  try {
    await invoke("delete_vault_value", { key });
  } catch (error) {
    console.error(`Failed to delete secret for key ${key}:`, error);
    throw error;
  }
}
