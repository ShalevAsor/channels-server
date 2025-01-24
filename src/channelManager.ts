import { WebSocket } from "ws";
import { logger } from "./utils/logger";
import { WebSocketAuthToken, WSEventType } from "./types";

/**
 * Defines the structure of a channel subscription.
 * Each subscription represents a single WebSocket connection to a channel
 * and contains the connection instance, user ID, and additional user information.
 */
interface ChannelSubscription {
  ws: WebSocket & { user?: WebSocketAuthToken };
  userId: string;
  userInfo: any;
}
/**
 * Defines the structure for tracking a user's typing status.
 * Includes user identification and timestamp for cleanup purposes.
 */
interface TypingUser {
  userId: string;
  username: string;
  timestamp: number;
}
/**
 * ChannelManager class handles all real-time communication aspects of the chat application.
 * It manages WebSocket connections, handles message broadcasting, tracks user presence,
 * and maintains typing indicators. The class provides functionality for:
 * - Channel subscription management
 * - Real-time message broadcasting
 * - Typing indicator handling
 * - Online status tracking
 * - Connection cleanup
 */
export class ChannelManager {
  /**
   * Stores all subscriptions for each channel
   */
  private channels: Map<string, Set<ChannelSubscription>>;

  /**
   * Maps each WebSocket to its subscribed channels for efficient cleanup
   */
  private wsToChannels: Map<WebSocket, Set<string>>;
  /**
   * Tracks which users are currently typing in each channel
   */
  private typingUsers: Map<string, Map<string, TypingUser>>;
  /**
   * Maps WebSocket connections to user IDs for quick lookup
   */
  private wsToUser: Map<WebSocket, string>;
  /**
   * Tracks online user presence in each server/channel
   */
  private onlineUsers: Map<string, Set<string>>;

  constructor() {
    this.channels = new Map();
    this.wsToChannels = new Map();
    this.typingUsers = new Map();
    this.wsToUser = new Map();
    this.onlineUsers = new Map();

    this.startTypingCleanup();
    logger.info("ChannelManager initialized");
  }
  /**
   * Updates and broadcasts user online status within a server/channel.
   * When a user's status changes, all other users in the channel are notified.
   *
   * @param serverId - The server or channel identifier
   * @param userId - The user whose status is being updated
   * @param isOnline - The new online status of the user
   */
  private updateOnlineStatus(
    serverId: string,
    userId: string,
    isOnline: boolean
  ) {
    if (!this.onlineUsers.has(serverId)) {
      this.onlineUsers.set(serverId, new Set());
    }

    const serverUsers = this.onlineUsers.get(serverId)!;

    if (isOnline) {
      serverUsers.add(userId);
    } else {
      serverUsers.delete(userId);
    }

    // Broadcast online status update to all users in the server
    this.broadcast(serverId, WSEventType.MEMBER_STATUS_UPDATE, {
      userId,
      isOnline,
      onlineUsers: Array.from(serverUsers),
    });

    logger.debug("Updated online status", {
      serverId,
      userId,
      isOnline,
      onlineUsersCount: serverUsers.size,
    });
  }
  /**
   * Manages user typing status and broadcasts updates to channel members.
   * Handles both start and stop typing events, maintaining a list of currently typing users.
   *
   * @param channelName - The channel where the typing event occurred
   * @param userId - The user who is typing
   * @param username - The display name of the typing user
   * @param isTyping - Whether the user started or stopped typing
   */
  handleTyping(
    channelName: string,
    userId: string,
    username: string,
    isTyping: boolean
  ) {
    logger.debug("Handling typing event", {
      channelName,
      userId,
      username,
      isTyping,
      // Log current typing users before update
      currentTypingUsers: Array.from(
        this.typingUsers.get(channelName)?.values() || []
      ),
    });

    if (!this.typingUsers.has(channelName)) {
      this.typingUsers.set(channelName, new Map());
      logger.debug("Created new typing map for channel", { channelName });
    }

    const channelTyping = this.typingUsers.get(channelName)!;

    if (isTyping) {
      channelTyping.set(userId, {
        userId,
        username,
        timestamp: Date.now(),
      });

      // Log all typing users after update
      logger.debug("Updated typing users", {
        channelName,
        typingUsers: Array.from(channelTyping.values()),
      });

      // Broadcast typing status with all currently typing users
      this.broadcast(channelName, WSEventType.MEMBER_TYPING, {
        typingUsers: Array.from(channelTyping.values()),
      });
    } else {
      channelTyping.delete(userId);

      logger.debug("User stopped typing", {
        channelName,
        userId,
        remainingTypingUsers: Array.from(channelTyping.values()),
      });

      // Broadcast stop typing with updated list
      this.broadcast(channelName, WSEventType.MEMBER_STOP_TYPING, {
        userId,
        username,
        remainingTypingUsers: Array.from(channelTyping.values()),
      });
    }
  }

  /**
   * Initiates periodic cleanup of stale typing indicators.
   * Removes typing status for users who haven't sent updates within the timeout period.
   */
  private startTypingCleanup() {
    const TYPING_TIMEOUT = 3000; // 3 seconds

    setInterval(() => {
      const now = Date.now();

      this.typingUsers.forEach((typingMap, channelName) => {
        typingMap.forEach((user, userId) => {
          if (now - user.timestamp > TYPING_TIMEOUT) {
            typingMap.delete(userId);

            // Broadcast stop typing
            this.broadcast(channelName, WSEventType.MEMBER_STOP_TYPING, {
              userId,
              username: user.username,
            });
          }
        });

        // Remove empty channels
        if (typingMap.size === 0) {
          this.typingUsers.delete(channelName);
        }
      });
    }, 1000); // Check every second
  }

  /**
   * Processes new channel subscriptions, handling authentication and duplicate prevention.
   * Maintains mapping between WebSocket connections and channels for efficient management.
   *
   * @param channelName - The channel to subscribe to
   * @param subscription - The subscription details including WebSocket and user info
   */
  subscribe(channelName: string, subscription: ChannelSubscription) {
    // Verify that the userId matches the authenticated user
    if (
      subscription.ws.user &&
      subscription.ws.user.userId !== subscription.userId
    ) {
      logger.warn("User ID mismatch in subscription request", {
        tokenUserId: subscription.ws.user.userId,
        requestUserId: subscription.userId,
      });
      return;
    }
    if (!this.channels.has(channelName)) {
      this.channels.set(channelName, new Set());
    }

    // Check for existing subscription from this client
    const channel = this.channels.get(channelName)!;
    const existingSubscription = Array.from(channel).find(
      (sub) => sub.ws === subscription.ws && sub.userId === subscription.userId
    );

    if (existingSubscription) {
      logger.debug("Skipping duplicate subscription", {
        channelName,
        userId: subscription.userId,
      });
      return;
    }
    // Store the WebSocket to user mapping
    this.wsToUser.set(subscription.ws, subscription.userId);
    // Add subscription to channel
    channel.add(subscription);

    // Track channels for this WebSocket
    if (!this.wsToChannels.has(subscription.ws)) {
      this.wsToChannels.set(subscription.ws, new Set());
    }
    this.wsToChannels.get(subscription.ws)!.add(channelName);
    // Update online status
    this.updateOnlineStatus(channelName, subscription.userId, true);
    logger.info("New subscription added", {
      channelName,
      subscriberCount: channel.size,
    });
  }

  /**
   * Removes a WebSocket subscription from a channel and updates all related mappings.
   *
   * @param channelName - The channel to unsubscribe from
   * @param ws - The WebSocket connection to remove
   */
  unsubscribe(channelName: string, ws: WebSocket) {
    try {
      const channel = this.channels.get(channelName);
      if (!channel) {
        logger.warn("Attempted to unsubscribe from non-existent channel", {
          channelName,
        });
        return;
      }

      let unsubscribedUser: string | undefined;
      for (const sub of channel) {
        if (sub.ws === ws) {
          unsubscribedUser = sub.userId;
          channel.delete(sub);
          break;
        }
      }

      // Update WebSocket to channel mapping
      if (this.wsToChannels.has(ws)) {
        this.wsToChannels.get(ws)!.delete(channelName);
        if (this.wsToChannels.get(ws)!.size === 0) {
          this.wsToChannels.delete(ws);
          this.wsToUser.delete(ws); // Clean up the user mapping
        }
      }

      if (unsubscribedUser) {
        logger.info("Client unsubscribed from channel", {
          channelName,
          userId: unsubscribedUser,
          remainingSubscribers: channel.size,
        });
      }

      if (channel.size === 0) {
        this.channels.delete(channelName);
        logger.debug("Removed empty channel", { channelName });
      }
    } catch (error) {
      logger.error(`Failed to unsubscribe from channel ${channelName}`, error);
    }
  }

  /**
   * Handles WebSocket connection closures by cleaning up all associated subscriptions
   * and updating online status for affected channels.
   *
   * @param ws - The WebSocket connection that closed
   */
  handleWebSocketClosure(ws: WebSocket) {
    const subscribedChannels = this.wsToChannels.get(ws);
    const userId = this.wsToUser.get(ws); // Get the userId associated with this WebSocket

    if (subscribedChannels && userId) {
      [...subscribedChannels].forEach((channelName) => {
        // Update online status for each channel (server)
        this.updateOnlineStatus(channelName, userId, false);
        // Find and remove typing indicators for disconnected users
        const typingMap = this.typingUsers.get(channelName);
        if (typingMap) {
          const user = typingMap.get(userId);
          if (user) {
            typingMap.delete(userId);
            this.broadcast(channelName, WSEventType.MEMBER_STOP_TYPING, {
              userId,
              username: user.username,
              remainingTypingUsers: Array.from(typingMap.values()),
            });
            logger.debug("Removed typing indicator for disconnected user", {
              channelName,
              userId,
              username: user.username,
            });
          }
        }
        this.unsubscribe(channelName, ws);
      });

      // Clean up the WebSocket mappings
      this.wsToChannels.delete(ws);
      this.wsToUser.delete(ws);

      logger.info("Cleaned up disconnected user", {
        userId,
        channelCount: subscribedChannels.size,
      });
    }
  }

  /**
   * Broadcasts a message to all subscribers in a channel.
   * Tracks delivery statistics and handles connection states.
   *
   * @param channelName - The channel to broadcast to
   * @param event - The type of event being broadcast
   * @param data - The message data to send
   * @param excludeWs - Optional WebSocket to exclude from broadcast
   */
  broadcast(
    channelName: string,
    event: WSEventType,
    data: any,
    excludeWs?: WebSocket
  ) {
    try {
      const channel = this.channels.get(channelName);
      if (!channel) {
        logger.warn("Attempted to broadcast to non-existent channel", {
          channelName,
          event,
        });
        return;
      }

      // Create message with explicit event type
      const message = JSON.stringify({
        event,
        data,
      });

      let sentCount = 0;
      let excludedCount = 0;
      let closedCount = 0;

      channel.forEach((sub) => {
        if (sub.ws === excludeWs) {
          excludedCount++;
        } else if (sub.ws.readyState === WebSocket.OPEN) {
          sub.ws.send(message);
          sentCount++;
        } else {
          closedCount++;
        }
      });

      logger.debug("Message broadcast complete", {
        channelName,
        event,
        messageId: data?.id,
        stats: {
          totalSubscribers: channel.size,
          messageSent: sentCount,
          excluded: excludedCount,
          closedConnections: closedCount,
        },
      });
    } catch (error) {
      logger.error(
        `Failed to broadcast message to channel ${channelName}`,
        error
      );
    }
  }

  /**
   * Returns statistics about current channel subscriptions and activity.
   * Used for monitoring and debugging purposes.
   */
  getChannelStats() {
    const stats = {
      totalChannels: this.channels.size,
      channels: Array.from(this.channels.entries()).map(([name, subs]) => ({
        name,
        subscribers: subs.size,
      })),
    };
    logger.debug("Channel statistics", stats);
    return stats;
  }

  /**
   * Performs periodic cleanup of inactive connections and empty channels.
   * Maintains system health by removing stale data.
   */
  cleanupInactiveConnections() {
    logger.info("Starting cleanup of inactive connections");
    let cleanupCount = 0;

    for (const [channelName, subscribers] of this.channels.entries()) {
      const initialSize = subscribers.size;

      // Remove subscribers with closed connections
      for (const sub of subscribers) {
        if (sub.ws.readyState !== WebSocket.OPEN) {
          subscribers.delete(sub);
          // Clean up the wsToChannels mapping
          if (this.wsToChannels.has(sub.ws)) {
            this.wsToChannels.get(sub.ws)!.delete(channelName);
            if (this.wsToChannels.get(sub.ws)!.size === 0) {
              this.wsToChannels.delete(sub.ws);
            }
          }
          cleanupCount++;
        }
      }

      // Remove empty channels
      if (subscribers.size === 0) {
        this.channels.delete(channelName);
        logger.debug("Removed empty channel during cleanup", { channelName });
      } else if (subscribers.size !== initialSize) {
        logger.debug("Cleaned up inactive connections in channel", {
          channelName,
          removed: initialSize - subscribers.size,
          remaining: subscribers.size,
        });
      }
    }

    logger.info("Inactive connection cleanup complete", {
      connectionsRemoved: cleanupCount,
      remainingChannels: this.channels.size,
    });
  }
}
