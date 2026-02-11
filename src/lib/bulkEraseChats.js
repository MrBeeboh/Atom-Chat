/**
 * @file bulkEraseChats.js
 * @description Single export: bulkEraseChats(). Clears all conversations and messages, creates one new chat, sets it active.
 * Call only after user confirms (e.g. via confirm() in Sidebar/ConvoRail/CommandPalette).
 */
import { conversations, activeConversationId } from '$lib/stores.js';
import { deleteAllConversations, createConversation, listConversations, getMessageCount } from '$lib/db.js';

/**
 * Delete all conversations and messages, create one new conversation, and set it active.
 * Call after user confirms. Updates conversations and activeConversationId stores.
 */
export async function bulkEraseChats() {
  await deleteAllConversations();
  const id = await createConversation();
  let list = await listConversations();
  list = await Promise.all(list.map(async (c) => ({ ...c, messageCount: await getMessageCount(c.id) })));
  conversations.set(list);
  activeConversationId.set(id);
}
