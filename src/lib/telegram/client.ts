import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";

let clientInstance: TelegramClient | null = null;
let isConnectedStatus = false;

export async function initClient(
  apiId: number,
  apiHash: string,
  sessionString: string = ""
): Promise<void> {
  if (clientInstance) {
    if (isConnectedStatus) return;
    await clientInstance.connect();
    isConnectedStatus = true;
    return;
  }

  const stringSession = new StringSession(sessionString);
  
  clientInstance = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
    useWSS: true,
  });

  // Set the log level to warn
  clientInstance.setLogLevel("warn" as any);

  await clientInstance.connect();
  isConnectedStatus = true;
}

export function getClient(): TelegramClient {
  if (!clientInstance) {
    throw new Error("TelegramClient not initialized. Call initClient first.");
  }
  return clientInstance;
}

export async function disconnectClient(): Promise<void> {
  if (clientInstance) {
    try {
      await clientInstance.disconnect();
    } catch (err) {
      console.warn("Error during TelegramClient disconnect:", err);
    }
    clientInstance = null;
    isConnectedStatus = false;
  }
}

export function isClientConnected(): boolean {
  return isConnectedStatus && clientInstance !== null;
}
