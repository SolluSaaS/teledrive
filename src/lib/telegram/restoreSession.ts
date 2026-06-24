import { initClient, getClient } from "./client";
import { useAuthStore } from "../../stores/authStore";
import {
  getSecret,
  VAULT_KEY_API_ID,
  VAULT_KEY_API_HASH,
  VAULT_KEY_SESSION,
  VAULT_KEY_PHONE,
} from "../secure/vault";

export async function restoreSession(): Promise<boolean> {
  try {
    const apiIdStr = await getSecret(VAULT_KEY_API_ID);
    const apiHash = await getSecret(VAULT_KEY_API_HASH);
    const sessionString = await getSecret(VAULT_KEY_SESSION);
    const phoneNumber = await getSecret(VAULT_KEY_PHONE) || "";

    if (!apiIdStr || !apiHash) {
      // Credentials not configured yet
      return false;
    }

    const apiId = parseInt(apiIdStr, 10);
    if (isNaN(apiId)) {
      return false;
    }

    // Set credentials in Zustand store
    useAuthStore.getState().setCredentials(apiId, apiHash);

    if (!sessionString) {
      // Credentials exist but no session string yet (not logged in)
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
