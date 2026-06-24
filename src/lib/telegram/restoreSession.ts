import { initClient, getClient } from "./client";
import { useAuthStore } from "../../stores/authStore";
import {
  getSecret,
  VAULT_KEY_API_ID,
  VAULT_KEY_API_HASH,
  VAULT_KEY_SESSION,
  VAULT_KEY_PHONE,
} from "../secure/vault";
import { DEFAULT_API_ID, DEFAULT_API_HASH } from "./config";

export async function restoreSession(): Promise<boolean> {
  try {
    const apiIdStr = await getSecret(VAULT_KEY_API_ID);
    const storedApiHash = await getSecret(VAULT_KEY_API_HASH);
    const sessionString = await getSecret(VAULT_KEY_SESSION);
    const phoneNumber = await getSecret(VAULT_KEY_PHONE) || "";

    // Use stored custom credentials if available, otherwise fall back to defaults.
    // Default credentials allow any user to log in via their phone number without
    // needing to create their own Telegram Developer application.
    const apiHash = storedApiHash || DEFAULT_API_HASH;
    const apiId = apiIdStr ? parseInt(apiIdStr, 10) : DEFAULT_API_ID;

    if (isNaN(apiId)) {
      return false;
    }

    // Set credentials in Zustand store (custom or default)
    useAuthStore.getState().setCredentials(apiId, apiHash);

    if (!sessionString) {
      // Credentials are ready but no session string yet (user hasn't logged in)
      return false;
    }

    // Initialize the client with the saved session string
    await initClient(apiId, apiHash, sessionString);
    const client = getClient();

    // Check if the session is still valid/authorized
    const isAuthorized = await client.isUserAuthorized();
    if (isAuthorized) {
      // Update auth store to mark as authenticated
      useAuthStore.getState().setSession(sessionString, phoneNumber);
      return true;
    } else {
      // Session is invalid/expired
      useAuthStore.getState().logout();
      return false;
    }
  } catch (error) {
    console.error("Failed to restore Telegram session:", error);
    useAuthStore.getState().logout();
    return false;
  }
}
