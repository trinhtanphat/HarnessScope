export class DesktopError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DesktopError';
    this.code = code;
  }
}

export async function safeResult(fn) {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    if (error instanceof DesktopError) {
      return { ok: false, code: error.code, message: error.message };
    }
    return {
      ok: false,
      code: 'DESKTOP_OPERATION_FAILED',
      message: 'The desktop operation could not be completed.'
    };
  }
}
