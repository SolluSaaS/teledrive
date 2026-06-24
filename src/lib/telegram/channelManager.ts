import { Api } from "telegram";
import { getClient } from "./client";
import { getSecret, saveSecret, VAULT_KEY_CHANNEL_ID } from "../secure/vault";

/**
 * Ensures the TeleDrive Storage channel exists.
 * First checks the local vault for a channel ID, verifies it exists on Telegram,
 * then searches the user's dialogs, and finally creates a new private channel if not found.
 */
export async function ensureStorageChannel(): Promise<string> {
  const client = getClient();
  
  // 1. Try to read saved channel ID from vault
  let channelId = await getSecret(VAULT_KEY_CHANNEL_ID);
  
  if (channelId) {
    try {
      // Verify access to the channel
      // GramJS client.getEntity accepts channel ID
      // BigInt conversions are handled internally by client.getEntity if passed as string or BigInt
      const peer = await client.getEntity(channelId);
      if (peer) {
        return channelId;
      }
    } catch (err) {
      console.warn(`Saved channel ID ${channelId} could not be resolved, searching dialogs...`, err);
    }
  }

  // 2. Search dialogs for "TeleDrive Storage"
  try {
    // getDialogs returns a list of Dialog objects
    const dialogs = await client.getDialogs({});
    for (const dialog of dialogs) {
      // dialog.entity holds the chat/channel info
      if (dialog.title === "TeleDrive Storage" && (dialog.isChannel || dialog.entity?.className === "Channel") && dialog.id) {
        const idStr = String(dialog.id);
        await saveSecret(VAULT_KEY_CHANNEL_ID, idStr);
        return idStr;
      }
    }
  } catch (err) {
    console.warn("Failed to search dialogs:", err);
  }

  // 3. Create a new private channel if it doesn't exist
  try {
    const result = await client.invoke(
      new Api.channels.CreateChannel({
        title: "TeleDrive Storage",
        about: "Private storage channel managed by TeleDrive. Do not delete or modify pinned messages.",
        broadcast: true, // Creates a channel (broadcast=true, megagroup=false)
      })
    );

    const chats = (result as any).chats || [];
    const channel = chats[0];
    if (!channel) {
      throw new Error("Failed to create storage channel: channel info is missing in updates");
    }

    const idStr = String(channel.id);
    await saveSecret(VAULT_KEY_CHANNEL_ID, idStr);
    return idStr;
  } catch (err) {
    console.error("Failed to create storage channel:", err);
    throw err;
  }
}
