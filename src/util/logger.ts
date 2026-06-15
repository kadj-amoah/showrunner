type LogLevel = 'debug' | 'info' | 'warn' | 'error';

type EventListener = (e: Record<string, unknown>) => void;
const eventListeners = new Set<EventListener>();

/** Subscribe to all `logger.event(...)` calls. Returns an unsubscribe function. */
export function onEvent(listener: EventListener): () => void {
  eventListeners.add(listener);
  return () => { eventListeners.delete(listener); };
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

interface LoggerState {
  level: LogLevel;
  json: boolean;
}

const state: LoggerState = {
  level: (process.env['SHOWRUNNER_LOG_LEVEL'] as LogLevel) ?? 'info',
  json: false,
};

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[state.level];
}

function emit(level: LogLevel, message: string, fields?: Record<string, unknown>): void {
  if (!shouldLog(level)) return;
  if (state.json) {
    const payload = { level, msg: message, ts: new Date().toISOString(), ...fields };
    process.stdout.write(JSON.stringify(payload) + '\n');
  } else {
    const prefix = `[showrunner] `;
    const suffix = fields ? ' ' + JSON.stringify(fields) : '';
    const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
    stream.write(prefix + message + suffix + '\n');
  }
}

export const logger = {
  setLevel(level: LogLevel): void {
    state.level = level;
  },
  setJson(json: boolean): void {
    state.json = json;
  },
  isJson(): boolean {
    return state.json;
  },
  debug(message: string, fields?: Record<string, unknown>): void {
    emit('debug', message, fields);
  },
  info(message: string, fields?: Record<string, unknown>): void {
    emit('info', message, fields);
  },
  warn(message: string, fields?: Record<string, unknown>): void {
    emit('warn', message, fields);
  },
  error(message: string, fields?: Record<string, unknown>): void {
    emit('error', message, fields);
  },
  event(payload: Record<string, unknown>): void {
    // Notify all registered subscribers first (used by SSE and other listeners).
    for (const listener of eventListeners) {
      listener(payload);
    }
    if (state.json) {
      process.stdout.write(JSON.stringify({ ...payload, ts: new Date().toISOString() }) + '\n');
    } else if (shouldLog('info')) {
      const { stage, status, ...rest } = payload as { stage?: string; status?: string } & Record<
        string,
        unknown
      >;
      const head = `[${stage ?? '?'}/${status ?? '?'}]`;
      const tail = Object.keys(rest).length > 0 ? ' ' + JSON.stringify(rest) : '';
      process.stdout.write(head + tail + '\n');
    }
  },
};
