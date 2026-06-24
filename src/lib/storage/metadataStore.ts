import { Api } from "telegram";
import { getClient } from "../telegram/client";
import { TeleFile } from "../types";

/**
 * Loads the virtual file metadata index from the Telegram channel's pinned messages.
 */
export async function loadIndex(channelId: string): Promise<TeleFile[]> {
  const client = getClient();
  
  try {
    // Get all pinned messages in the channel
    const messages = await client.getMessages(channelId, {
      filter: new Api.InputMessagesFilterPinned(),
      limit: 100,
    });
    
    let allFiles: TeleFile[] = [];
    
    // Filter out messages that contain the teledrive_index indicator
    const indexMessages = messages
      .filter((m) => m.text && m.text.includes("teledrive_index"))
      // Sort in ascending order by message ID so that chunk sequence is preserved
      .sort((a: any, b: any) => a.id - b.id);
      
    for (const msg of indexMessages) {
      try {
        const data = JSON.parse(msg.text || "");
        if (data && Array.isArray(data.files)) {
          allFiles = allFiles.concat(data.files);
        }
      } catch (e) {
        console.warn(`Failed to parse index message ${msg.id}:`, e);
      }
    }
    
    return allFiles;
  } catch (error) {
    console.error("Failed to load metadata index:", error);
    throw error;
  }
}

/**
 * Saves the virtual file metadata index to the Telegram channel, chunking it across pinned messages.
 */
export async function saveIndex(channelId: string, files: TeleFile[]): Promise<void> {
  const client = getClient();
  
  try {
    // 1. Fetch current pinned index messages
    const messages = await client.getMessages(channelId, {
      filter: new Api.InputMessagesFilterPinned(),
      limit: 100,
    });
    
    const currentIndexMessages = messages
      .filter((m) => m.text && m.text.includes("teledrive_index"))
      .sort((a: any, b: any) => a.id - b.id);
      
    // 2. Chunk files (safely keep chunks under 4000 characters)
    const chunks: TeleFile[][] = [];
    const CHUNK_SIZE = 15;
    for (let i = 0; i < files.length; i += CHUNK_SIZE) {
      chunks.push(files.slice(i, i + CHUNK_SIZE));
    }
    
    // Ensure we have at least one chunk even if empty
    if (chunks.length === 0) {
      chunks.push([]);
    }
    
    // 3. Write or edit messages
    for (let i = 0; i < chunks.length; i++) {
      const chunkFiles = chunks[i];
      const payload = {
        teledrive_index: true,
        version: 1,
        chunkIndex: i,
        totalChunks: chunks.length,
        files: chunkFiles,
      };
      const text = JSON.stringify(payload);
      
      if (i < currentIndexMessages.length) {
        // Edit existing pinned message
        const msg = currentIndexMessages[i];
        await client.editMessage(channelId, {
          message: msg.id,
          text: text,
        });
      } else {
        // Send a new message
        const result = await client.sendMessage(channelId, {
          message: text,
        });
        // Pin the new message
        await client.invoke(
          new Api.messages.UpdatePinnedMessage({
            peer: channelId,
            id: result.id,
            unpin: false,
          })
        );
      }
    }
    
    // 4. Clean up any extra pinned messages if we now have fewer chunks
    if (currentIndexMessages.length > chunks.length) {
      const extraMessages = currentIndexMessages.slice(chunks.length);
      for (const msg of extraMessages) {
        try {
          // Unpin message
          await client.invoke(
            new Api.messages.UpdatePinnedMessage({
              peer: channelId,
              id: msg.id,
              unpin: true,
            })
          );
          // Delete message
          await client.deleteMessages(channelId, [msg.id], { revoke: true });
        } catch (e) {
          console.warn(`Failed to clean up extra index message ${msg.id}:`, e);
        }
      }
    }
  } catch (error) {
    console.error("Failed to save metadata index:", error);
    throw error;
  }
}

/**
 * Adds a file virtual entry to the index.
 */
export async function addFile(channelId: string, file: TeleFile): Promise<TeleFile[]> {
  const files = await loadIndex(channelId);
  // Ensure we don't have duplicate IDs
  const updatedFiles = [...files.filter((f) => f.id !== file.id), file];
  await saveIndex(channelId, updatedFiles);
  return updatedFiles;
}

/**
 * Removes a file virtual entry from the index by ID.
 */
export async function removeFile(channelId: string, fileId: string): Promise<TeleFile[]> {
  const files = await loadIndex(channelId);
  const updatedFiles = files.filter((f) => f.id !== fileId);
  await saveIndex(channelId, updatedFiles);
  return updatedFiles;
}

/**
 * Updates a file virtual entry in the index.
 */
export async function updateFile(
  channelId: string,
  fileId: string,
  patch: Partial<TeleFile>
): Promise<TeleFile[]> {
  const files = await loadIndex(channelId);
  const updatedFiles = files.map((f) =>
    f.id === fileId ? { ...f, ...patch } : f
  );
  await saveIndex(channelId, updatedFiles);
  return updatedFiles;
}
