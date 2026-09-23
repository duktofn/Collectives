import { invokeCommand } from "../../../shared/ipc/client";

export const linksIpcAdapter = {
  resolveWikilink: (collectionId: string, noteName: string) => invokeCommand("resolve_wikilink", { collectionId, noteName }),
  searchLinkIndex: (collectionId: string, query: string, limit?: number) => invokeCommand("search_link_index", { collectionId, query, limit }),
};
