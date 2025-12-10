/**
 * Logger utility for the mobile app
 *
 * Provides a centralized logging system that:
 * - Only logs in development mode by default
 * - Can be configured for production error reporting
 * - Supports different log levels
 * - Formats messages consistently
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LoggerConfig {
  enableInProduction: boolean;
  minLevel: LogLevel;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const config: LoggerConfig = {
  enableInProduction: false,
  minLevel: __DEV__ ? 'debug' : 'error',
};

const shouldLog = (level: LogLevel): boolean => {
  if (!__DEV__ && !config.enableInProduction) {
    return false;
  }
  return LOG_LEVELS[level] >= LOG_LEVELS[config.minLevel];
};

const formatMessage = (tag: string, message: string): string => {
  const timestamp = new Date().toISOString().split('T')[1].slice(0, 12);
  return `[${timestamp}] [${tag}] ${message}`;
};

const Logger = {
  /**
   * Configure the logger
   */
  configure(options: Partial<LoggerConfig>): void {
    Object.assign(config, options);
  },

  /**
   * Debug level logging - for development only
   */
  debug(tag: string, message: string, ...data: any[]): void {
    if (shouldLog('debug')) {
      console.log(formatMessage(tag, message), ...data);
    }
  },

  /**
   * Info level logging - general information
   */
  info(tag: string, message: string, ...data: any[]): void {
    if (shouldLog('info')) {
      console.info(formatMessage(tag, message), ...data);
    }
  },

  /**
   * Warning level logging - potential issues
   */
  warn(tag: string, message: string, ...data: any[]): void {
    if (shouldLog('warn')) {
      console.warn(formatMessage(tag, message), ...data);
    }
  },

  /**
   * Error level logging - errors and exceptions
   * In production, this could be sent to a crash reporting service
   */
  error(tag: string, message: string, error?: Error | any): void {
    if (shouldLog('error')) {
      console.error(formatMessage(tag, message), error);
    }

    // TODO: In production, send to crash reporting service
    // if (!__DEV__ && config.enableInProduction) {
    //   CrashReporting.recordError(error, { tag, message });
    // }
  },

  /**
   * Create a tagged logger for a specific module
   */
  createLogger(tag: string) {
    return {
      debug: (message: string, ...data: any[]) => Logger.debug(tag, message, ...data),
      info: (message: string, ...data: any[]) => Logger.info(tag, message, ...data),
      warn: (message: string, ...data: any[]) => Logger.warn(tag, message, ...data),
      error: (message: string, error?: Error | any) => Logger.error(tag, message, error),
    };
  },
};

export default Logger;
