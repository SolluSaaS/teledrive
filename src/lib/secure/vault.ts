import { Stronghold } from "@tauri-apps/plugin-stronghold";
import { appDataDir } from "@tauri-apps/api/path";

export const VAULT_KEY_API_ID      = 'telegram_api_id';
export const VAULT_KEY_API_HASH    = 'telegram_api_hash';
export const VAULT_KEY_SESSION     = 'telegram_session';
export const VAULT_KEY_PHONE       = 'telegram_phone';
export const VAULT_KEY_CHANNEL_ID  = 'telegram_channel_id';

let strongholdInstance: Stronghold | null = null;
let clientInstance: any = null;

const VAULT_PASSWORD = "teledrive-vault-key";
const CLIENT_NAME = "teledrive-client";

export async function initVault(): Promise<void> {
  if (strongholdInstance) return;

  try {
    const dataDir = await appDataDir();
    const vaultPath = `${dataDir}/teledrive.hold`;
    
    // Load or create the stronghold vault
    strongholdInstance = await Stronghold.load(vaultPath, VAULT_PASSWORD);
    
    try {
      clientInstance = await strongholdInstance.loadClient(CLIENT_NAME);
    } catch {
      clientInstance = await strongholdInstance.createClient(CLIENT_NAME);
    }
  } catch (error) {
    console.error("Failed to initialize Stronghold vault:", error);
    throw error;
  }
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
