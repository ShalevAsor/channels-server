import { Request } from "express";
export interface User {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
}

export interface Member {
  id: string;
  userId: string;
  user?: User;
}

export interface Channel {
  id: string;
  name: string;
}

export interface Message {
  id: string;
  content: string;
  fileUrl: string | null;
  fileType: string | null;
  fileName: string | null;
  memberId: string;
  member?: Member;
  deleted: boolean;
  edited: boolean;
  createdAt: string;
  updatedAt: string;
}
// server/src/types.ts
export enum WSEventType {
  SUBSCRIBE = "subscribe",
  NEW_MESSAGE = "new-message",
  MESSAGE_UPDATE = "message-update",
  MESSAGE_DELETE = "message-delete",
  MEMBER_TYPING = "member-typing",
  MEMBER_STOP_TYPING = "member-stop-typing",
  MEMBER_STATUS_UPDATE = "MEMBER_STATUS_UPDATE",
}
export interface WebSocketAuthToken {
  userId: string;
  name: string | null;
  image: string | null;
  exp: number;
}
/**
 * Type for the broadcast request body
 */
export interface BroadcastRequestBody {
  type: WSEventType;
  channelName: string;
  message: {
    id: string;
    content: string;
    fileUrl?: string | null;
    fileType?: string | null;
    fileName?: string | null;
    memberId: string;
    userId: string;
    username: string;
    userImage?: string | null;
    timestamp: string;
    member: {
      id: string;
      role: string;
      userId: string;
      user: {
        id: string;
        name: string | null;
        image: string | null;
      };
    };
  };
}

/**
 * Type for the broadcast request
 */
export type BroadcastRequest = Request<{}, any, BroadcastRequestBody>;
