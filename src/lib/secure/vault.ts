import { Stronghold } from "@tauri-apps/plugin-stronghold";
import { appDataDir } from "@tauri-apps/api/path";
import { invoke } from "@tauri-apps/api/core";

export const VAULT_KEY_API_ID      = 'telegram_api_id';
export const VAULT_KEY_API_HASH    = 'telegram_api_hash';
export const VAULT_KEY_SESSION     = 'telegram_session';
export const VAULT_KEY_PHONE       = 'telegram_phone';
export const VAULT_KEY_CHANNEL_ID  = 'telegram_channel_id';

let strongholdInstance: Stronghold | null = null;
let clientInstance: any = null;
let initPromise: Promise<void> | null = null;

const VAULT_PASSWORD = "teledrive-vault-key";
const CLIENT_NAME = "teledrive-client";

export function initVault(): Promise<void> {
  if (initPromise) return initPromise;

  initPromise = new Promise<void>(async (resolve, reject) => {
    // 5-second timeout safeguard to prevent hanging the app indefinitely
    const timeoutId = setTimeout(async () => {
      console.error("vault.ts: Stronghold vault initialization timed out.");
      initPromise = null; // reset to allow retries
      reject(new Error("Vault initialization timed out after 5000ms"));
    }, 5000);

    try {
      console.log("vault.ts: Starting vault initialization...");
      const dataDir = await appDataDir();
      const vaultPath = `${dataDir}/teledrive.hold`;
      
      try {
        // Load or create the stronghold vault
        strongholdInstance = await Stronghold.load(vaultPath, VAULT_PASSWORD);
      } catch (loadErr) {
        console.warn("vault.ts: Stronghold load failed (potentially corrupted file). Resetting vault file...", loadErr);
        // Call Rust backend to delete the corrupted database file
        await invoke("delete_file", { path: vaultPath }).catch(e => console.error("vault.ts: Failed to delete file:", e));
        // Retry loading which will create a fresh database file
        strongholdInstance = await Stronghold.load(vaultPath, VAULT_PASSWORD);
      }
      
      try {
        clientInstance = await strongholdInstance.loadClient(CLIENT_NAME);
      } catch {
        clientInstance = await strongholdInstance.createClient(CLIENT_NAME);
      }
      
      clearTimeout(timeoutId);
      console.log("vault.ts: Vault initialized successfully.");
      resolve();
    } catch (error) {
      clearTimeout(timeoutId);
      console.error("vault.ts: Failed to initialize Stronghold vault:", error);
      initPromise = null; // reset to allow retries
      reject(error);
    }
  });

  return initPromise;
}

export async function saveSecret(key: string, value: string): Promise<void> {
  if (!strongholdInstance || !clientInstance) {
    await initVault();
  }

  try {
    const store = clientInstance.getStore();
    const bytes = new TextEncoder().encode(value);
    await store.insert(key, Array.from(bytes));
    await strongholdInstance!.save();
  } catch (error) {
    console.error(`Failed to save secret for key ${key}:`, error);
    throw error;
  }
}

export async function getSecret(key: string): Promise<string | null> {
  if (!strongholdInstance || !clientInstance) {
    await initVault();
  }

  try {
    const store = clientInstance.getStore();
    const bytes = await store.get(key);
    if (!bytes || bytes.length === 0) return null;
    return new TextDecoder().decode(new Uint8Array(bytes));
  } catch (error) {
    console.warn(`Failed to get secret for key ${key}:`, error);
    return null;
  }
}

export async function deleteSecret(key: string): Promise<void> {
  if (!strongholdInstance || !clientInstance) {
    await initVault();
  }

  try {
    const store = clientInstance.getStore();
    await store.remove(key);
    await strongholdInstance!.save();
  } catch (error) {
    console.error(`Failed to delete secret for key ${key}:`, error);
    throw error;
  }
}
