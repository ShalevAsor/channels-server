// src/utils/logger.ts

/**
 * Log levels enum for type safety
 */
export enum LogLevel {
  INFO = "INFO",
  WARN = "WARN",
  ERROR = "ERROR",
  DEBUG = "DEBUG",
}

/**
 * Enhanced logger with additional features
 */
export const logger = {
  /**
   * Log informational messages
   */
  info: (message: string, ...args: any[]) => {
    logMessage(LogLevel.INFO, message, args);
  },

  /**
   * Log error messages with error object support
   */
  error: (message: string, error?: any) => {
    logMessage(LogLevel.ERROR, message, [error]);
    if (error?.stack) {
      console.error(error.stack);
    }
  },

  /**
   * Log warning messages
   */
  warn: (message: string, ...args: any[]) => {
    logMessage(LogLevel.WARN, message, args);
  },

  /**
   * Log debug messages (only in development)
   */
  debug: (message: string, ...args: any[]) => {
    if (process.env.NODE_ENV !== "production") {
      logMessage(LogLevel.DEBUG, message, args);
    }
  },
};

/**
 * Helper function to format and output log messages
 */
function logMessage(level: LogLevel, message: string, args: any[]) {
  const timestamp = new Date().toISOString();
  const formattedArgs = args.filter((arg) => arg !== undefined);

  switch (level) {
    case LogLevel.ERROR:
      console.error(`[${timestamp}] ${level}: ${message}`, ...formattedArgs);
      break;
    case LogLevel.WARN:
      console.warn(`[${timestamp}] ${level}: ${message}`, ...formattedArgs);
      break;
    case LogLevel.DEBUG:
      console.debug(`[${timestamp}] ${level}: ${message}`, ...formattedArgs);
      break;
    default:
      console.log(`[${timestamp}] ${level}: ${message}`, ...formattedArgs);
  }
}
