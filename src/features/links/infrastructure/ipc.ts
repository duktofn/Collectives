import { invokeCommand } from "../../../shared/ipc/client";

export const linksIpcAdapter = {
  resolveWikilink: (collectionId: string, noteName: string, sourcePath?: string) => invokeCommand("resolve_wikilink", { collectionId, noteName, sourcePath }),
  searchLinkIndex: (collectionId: string, query: string, limit?: number) => invokeCommand("search_link_index", { collectionId, query, limit }),
  searchNoteContent: (collectionId: string, query: string, offset?: number, limit?: number) => invokeCommand("search_note_content", { collectionId, query, offset, limit }),
};
