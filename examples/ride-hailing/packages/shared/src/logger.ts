type Level = 'debug' | 'info' | 'warn' | 'error';
function write(level: Level, msg: string, meta?: Record<string, unknown>) {
  console.log(JSON.stringify({ level, msg, ...meta, at: new Date().toISOString() }));
}
export const logger = {
  info: (m: string, meta?: Record<string, unknown>) => write('info', m, meta),
  warn: (m: string, meta?: Record<string, unknown>) => write('warn', m, meta),
  error: (m: string, meta?: Record<string, unknown>) => write('error', m, meta),
};
