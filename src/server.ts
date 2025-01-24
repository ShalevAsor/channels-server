/**
 * External dependencies for server functionality
 * - express: Web framework for handling HTTP requests
 * - http: Node.js HTTP server creation
 * - ws: WebSocket server implementation
 * - cors: Cross-Origin Resource Sharing middleware
 * - dotenv: Environment variable management
 */
import express, { Request, Response, RequestHandler } from "express";
import { createServer } from "http";
import { WebSocket, WebSocketServer } from "ws";
import cors from "cors";
import dotenv from "dotenv";

/**
 * Internal module imports
 * - handleConnection: WebSocket connection handler
 * - ChannelManager: Manages channel subscriptions and broadcasting
 * - Types: TypeScript interfaces and types
 * - logger: Custom logging utility
 */
import { handleConnection } from "./websocket";
import { ChannelManager } from "./channelManager";
import { BroadcastRequestBody, WSEventType, WebSocketAuthToken } from "./types";
import { logger } from "./utils/logger";
import { verify } from "jsonwebtoken";

/**
 * Initialize environment variables from .env file
 * This must be called before accessing any process.env values
 * Required environment variables:
 * - WS_JWT_SECRET: Secret key for JWT verification
 * - PORT: Server port (optional, defaults to 3001)
 */
dotenv.config();
logger.info("Environment variables loaded");
const WS_JWT_SECRET = process.env.WS_JWT_SECRET!;

/**
 * Define allowed origins for CORS
 */
const allowedOrigins = [
  "https://channels-livid.vercel.app",
  "http://localhost:3000",
];

/**
 * Express application initialization with middleware setup
 * - cors(): Enables Cross-Origin Resource Sharing for all routes
 * - express.json(): Parses incoming JSON payloads
 *
 * Security considerations:
 * - CORS is enabled for development, should be configured for specific origins in production
 * - JSON parser helps prevent invalid JSON payloads
 */
const app = express();
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true, // If you're using cookies or authentication headers
  })
);
app.use(express.json());
logger.debug("Express middleware configured", {
  middleware: ["cors", "json parser"],
});
/**
 * HTTP Server Configuration
 * Creates an HTTP server instance that will handle both regular HTTP requests
 * and serve as the foundation for WebSocket upgrades.
 *
 * By creating a server this way, we can:
 * 1. Handle HTTP and WebSocket traffic on the same port
 * 2. Share resources between HTTP and WebSocket servers
 * 3. Manage both servers with the same lifecycle
 */
const server = createServer(app);

/**
 * WebSocket Server Initialization
 * Creates a WebSocket server attached to our HTTP server.
 * This setup enables:
 * - Upgrade of HTTP connections to WebSocket protocol
 * - Real-time bidirectional communication
 * - Shared server configuration
 */
const wss = new WebSocketServer({ server });
logger.info("WebSocket server initialized");

/**
 * Channel Manager Instance
 * Creates a singleton instance of the ChannelManager class.
 *
 * The ChannelManager is responsible for:
 * - Managing channel subscriptions
 * - Handling message broadcasting to channels
 * - Tracking active channels and their subscribers
 * - Cleaning up inactive subscriptions
 */
const channelManager = new ChannelManager();
/**
 * Connection Statistics
 * Tracks the number of WebSocket connections for monitoring purposes
 *
 * totalConnections: Total number of connections ever established
 * activeConnections: Current number of open connections
 *
 * These metrics are useful for:
 * - Monitoring server load
 * - Debugging connection issues
 * - Health checking
 */
let totalConnections = 0;
let activeConnections = 0;
/**
 * WebSocket Connection Handler
 * Manages new WebSocket connection requests and their lifecycle
 *
 * Authentication flow:
 * 1. Extracts JWT token from URL parameters
 * 2. Verifies token authenticity
 * 3. Associates user data with WebSocket connection
 * 4. Sets up connection event handlers
 *
 * @param {WebSocket} ws - The WebSocket connection instance
 * @param {Request} req - The HTTP request that initiated the WebSocket connection
 */
wss.on("connection", (ws: WebSocket, req: Request) => {
  try {
    // Extract and validate authentication token from URL
    const url = new URL(req.url!, `ws://${req.headers.host}`);
    const token = url.searchParams.get("token");

    if (!token) {
      console.log("No authentication token provided");
      ws.close(1008, "Authentication required");
      return;
    }

    /**
     * JWT Verification
     * Validates the authentication token and extracts user information
     * Throws an error if token is invalid or expired
     */
    const decoded = verify(token, WS_JWT_SECRET) as WebSocketAuthToken;

    /**
     * User Context Association
     * Attaches user information to the WebSocket instance for future reference
     * This enables user-specific operations and logging
     */
    (ws as any).user = decoded;

    // Update connection statistics
    totalConnections++;
    activeConnections++;
    /**
     * Connection Logging
     * Records detailed information about new connections for monitoring
     * and debugging purposes
     */
    logger.info("New authenticated WebSocket connection established", {
      totalConnections,
      activeConnections,
      clientIp: req.socket.remoteAddress,
      userId: decoded.userId,
    });
    /**
     * Connection Handler Setup
     * Initializes the connection with channel manager and sets up event listeners
     */

    handleConnection(ws, channelManager);
    /**
     * Connection Cleanup
     * Handles WebSocket connection closure
     * Updates statistics and logs the event
     */
    ws.on("close", () => {
      activeConnections--;
      logger.info("WebSocket connection closed", {
        activeConnections,
        totalHistorical: totalConnections,
        userId: (ws as any).user?.id,
      });
    });
  } catch (error) {
    /**
     * Authentication Error Handling
     * Handles and logs authentication failures
     * Closes connection with appropriate error code
     */
    logger.error("WebSocket authentication failed", error);
    ws.close(1008, "Invalid authentication token");
  }
});

/**
 * Broadcast Message Handler
 * HTTP endpoint handler for broadcasting messages to WebSocket clients
 *
 * Responsibilities:
 * 1. Validates incoming broadcast requests
 * 2. Ensures message format compliance
 * 3. Broadcasts messages to appropriate channels
 * 4. Handles errors and provides appropriate responses
 *
 * @param {Request} req - The HTTP request containing broadcast details
 * @param {Response} res - The HTTP response object
 */
const broadcastHandler: RequestHandler<{}, any, BroadcastRequestBody> = (
  req,
  res
) => {
  const startTime = Date.now();

  try {
    const { type, channelName, message } = req.body;
    /**
     * Request Logging
     * Records incoming broadcast requests for monitoring and debugging
     */
    logger.debug("Received broadcast request", {
      channelName,
      type,
      messageId: message?.id,
      clientIp: req.ip,
    });

    /**
     * Event Type Validation
     * Ensures the broadcast event type is valid
     * Returns 400 error if type is invalid
     */
    if (!Object.values(WSEventType).includes(type)) {
      logger.warn("Invalid event type", { type });
      res.status(400).json({
        error: `Invalid event type. Must be one of: ${Object.values(
          WSEventType
        ).join(", ")}`,
      });
      return;
    }
    /**
     * Request Validation
     * Checks for required fields in broadcast request
     * Returns 400 error if any required field is missing
     */

    if (!type || !channelName || !message) {
      logger.warn("Invalid broadcast request", {
        type,
        channelName,
        hasMessage: !!message,
      });

      res.status(400).json({
        error: "Missing required fields: type, channelName, or message",
      });
      return;
    }
    /**
     * Message Broadcasting
     * Logs the broadcast action and sends message to channel subscribers
     */
    logger.info("Broadcasting message", {
      channelName,
      type,
      messageId: message.id,
      userId: message.userId,
    });

    // The event type is passed through to channelManager.broadcast
    channelManager.broadcast(channelName, type, message);
    /**
     * Response Handling
     * Records broadcast duration and sends success response
     */
    const duration = Date.now() - startTime;
    logger.debug("Broadcast completed", { duration });
    res.status(200).json({ success: true });
  } catch (error) {
    /**
     * Error Handling
     * Handles any errors during broadcast process
     * Records error details and duration
     * Returns 500 error response
     */
    const duration = Date.now() - startTime;
    logger.error("Broadcast failed", {
      error,
      duration,
      body: req.body,
    });

    res.status(500).json({
      error: "Failed to broadcast message",
    });
  }
};
/**
 * API Routes
 * Registers HTTP endpoints for system functionality
 */
app.post("/api/broadcast", broadcastHandler);
/**
 * Health Check Endpoint
 * Provides system status information including:
 * - Server status
 * - Connection statistics
 * - Channel information
 * - Timestamp
 *
 * Used for:
 * - Monitoring system health
 * - Load balancer checks
 * - Debugging
 */
app.get("/health", (req: Request, res: Response) => {
  const health = {
    status: "healthy",
    timestamp: new Date().toISOString(),
    activeConnections,
    totalConnections,
    channels: channelManager.getChannelStats(),
  };

  logger.debug("Health check requested", health);
  res.json(health);
});

/**
 * Connection Cleanup
 * Periodically removes inactive connections to prevent resource leaks
 * Runs every 5 minutes to maintain system health
 */
const CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes
setInterval(() => {
  logger.info("Starting periodic cleanup");
  channelManager.cleanupInactiveConnections();
}, CLEANUP_INTERVAL);

/**
 * Server Initialization
 * Starts the HTTP/WebSocket server on the specified port
 * Falls back to port 3001 if no port is specified in environment
 */
const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  logger.info("Server started");
});

/**
 * Graceful Shutdown Handler
 * Manages clean server shutdown on SIGTERM signal
 *
 * Process:
 * 1. Receives shutdown signal
 * 2. Stops accepting new connections
 * 3. Closes existing connections
 * 4. Exits process
 *
 * Includes forced shutdown after 10 seconds to prevent hanging
 */
process.on("SIGTERM", () => {
  logger.info("Received SIGTERM signal, initiating graceful shutdown");

  server.close(() => {
    logger.info("HTTP server closed");
    process.exit(0);
  });

  // Force exit if graceful shutdown takes too long
  setTimeout(() => {
    logger.warn("Forced shutdown due to timeout");
    process.exit(1);
  }, 10000);
});
