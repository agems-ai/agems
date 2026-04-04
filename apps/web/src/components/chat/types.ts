export interface ChatInstance {
  channelId: string;
  name: string;
  avatar: string | null;
  peerType: 'agent' | 'human';
  peerId: string;
  /** Cannot be closed */
  isGemma: boolean;
}

export interface ChatManagerContextValue {
  openChats: ChatInstance[];
  minimized: Set<string>;
  unreadCounts: Map<string, number>;
  currentUserId: string;
  openChat: (chat: ChatInstance) => void;
  closeChat: (channelId: string) => void;
  toggleMinimize: (channelId: string) => void;
  clearUnread: (channelId: string) => void;
}
