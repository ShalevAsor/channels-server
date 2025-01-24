import { WebSocket } from "ws";
import { ChannelManager } from "./channelManager";
import { logger } from "./utils/logger";

/**
 * Handles new WebSocket connections and sets up event listeners.
 * Manages the lifecycle of a WebSocket connection including:
 * - Message processing
 * - Subscription handling
 * - Error handling
 * - Connection cleanup
 * @param ws The WebSocket connection (like a dedicated phone line for each person)
 * @param channelManager The system that manages all the meeting rooms and their participants
 */
export function handleConnection(
  ws: WebSocket,
  channelManager: ChannelManager
) {
  logger.info("New client connected");

  /**
   * Message Handler
   * Currently, it only handles one type of request: "subscribe" (joining a meeting room)
   *
   * When a message comes in, we:
   * 1. Parse the message to understand what the client wants
   * 2. If they want to join a channel, we handle that request
   * 3. Log any errors that might occur during this process
   */
  ws.on("message", (message: string) => {
    try {
      const data = JSON.parse(message.toString());

      // Only handle subscriptions through WebSocket
      if (data.type === "subscribe") {
        const { channelName, userId, userInfo } = data;
        logger.info("Client subscribing to channel", {
          channelName,
          userId,
          userInfo,
        });
        channelManager.subscribe(channelName, { ws, userId, userInfo });
      }
    } catch (error) {
      logger.error("Failed to process WebSocket message", error);
    }
  });

  /**
   * Connection Closure Handler
   * This is like handling what happens when someone hangs up their phone.
   * We need to:
   * - Remove them from all meeting rooms they were in
   * - Clean up any resources they were using
   * - Log that they've left
   */
  ws.on("close", () => {
    logger.info("Client disconnected");
    channelManager.handleWebSocketClosure(ws);
  });

  /**
   * Handle WebSocket errors
   */
  ws.on("error", (error) => {
    logger.error("WebSocket connection error", error);
  });
}
