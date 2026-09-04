import { randomUUID } from 'node:crypto';
import {
  mkdirSync, readFileSync, renameSync, rmSync, writeFileSync
} from 'node:fs';
import { dirname, resolve } from 'node:path';

export const HEARTBEAT_MS = 5_000;
export const STALE_MS = 30_000;

export class WorkspaceLockError extends Error {
  constructor(code = 'WORKSPACE_LOCKED', message = 'The HarnessScope workspace is already in use.') {
    super(message);
    this.name = 'WorkspaceLockError';
    this.code = code;
  }
}

export function lockPathFor(dbPath) {
  return `${resolve(dbPath)}.lock`;
}

function ownerPath(lockPath) {
  return `${lockPath}/owner.json`;
}

function locked() {
  return new WorkspaceLockError();
}

function readOwner(lockPath) {
  try {
    const value = JSON.parse(readFileSync(ownerPath(lockPath), 'utf8'));
    if (
      !value || typeof value !== 'object' ||
      typeof value.token !== 'string' || !value.token ||
      !Number.isInteger(value.pid) || value.pid <= 0 ||
      typeof value.runtime !== 'string' || !value.runtime ||
      (value.processStartIdentity !== null && typeof value.processStartIdentity !== 'string') ||
      typeof value.acquiredUtc !== 'string' ||
      typeof value.heartbeatUtc !== 'string'
    ) throw locked();
    return value;
  } catch (error) {
    if (error instanceof WorkspaceLockError) throw error;
    throw locked();
  }
}

function writeOwner(lockPath, owner) {
  const target = ownerPath(lockPath);
  const temp = `${lockPath}/.owner-${owner.token}.tmp`;
  writeFileSync(temp, JSON.stringify(owner), { encoding: 'utf8', flag: 'w' });
  try {
    renameSync(temp, target);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

function defaultProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    if (error?.code === 'EPERM') return true;
    throw error;
  }
}

function createOwner(runtime) {
  const now = new Date().toISOString();
  return {
    token: randomUUID(),
    pid: process.pid,
    runtime,
    processStartIdentity: null,
    acquiredUtc: now,
    heartbeatUtc: now
  };
}

function heartbeatAge(owner, nowMs = Date.now()) {
  const heartbeatMs = Date.parse(owner.heartbeatUtc);
  if (!Number.isFinite(heartbeatMs)) throw locked();
  return Math.max(0, nowMs - heartbeatMs);
}

function createFreshLock(lockPath, owner) {
  mkdirSync(lockPath);
  try {
    writeOwner(lockPath, owner);
  } catch (error) {
    rmSync(lockPath, { recursive: true, force: true });
    throw error;
  }
}

export function acquireWorkspaceLock(dbPath, options = {}) {
  const absoluteDbPath = resolve(dbPath);
  const lockPath = lockPathFor(absoluteDbPath);
  const runtime = String(options.runtime || 'node');
  const heartbeatMs = options.heartbeatMs ?? HEARTBEAT_MS;
  const staleMs = options.staleMs ?? STALE_MS;
  const isProcessAlive = options.isProcessAlive ?? defaultProcessAlive;
  mkdirSync(dirname(absoluteDbPath), { recursive: true });

  const owner = createOwner(runtime);
  let stalePath = null;

  try {
    createFreshLock(lockPath, owner);
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;

    const existing = readOwner(lockPath);
    if (heartbeatAge(existing) <= staleMs) throw locked();

    let alive;
    try {
      alive = Boolean(isProcessAlive(existing.pid));
    } catch {
      throw locked();
    }
    if (alive) throw locked();

    stalePath = `${lockPath}.stale-${randomUUID()}`;
    try {
      renameSync(lockPath, stalePath);
    } catch {
      throw locked();
    }

    try {
      createFreshLock(lockPath, owner);
      rmSync(stalePath, { recursive: true, force: true });
      stalePath = null;
    } catch {
      throw locked();
    }
  }

  let active = true;
  let timer = null;

  const refresh = () => {
    if (!active) return false;
    let current;
    try {
      current = readOwner(lockPath);
    } catch {
      active = false;
      if (timer) clearInterval(timer);
      return false;
    }
    if (current.token !== owner.token) {
      active = false;
      if (timer) clearInterval(timer);
      return false;
    }
    owner.heartbeatUtc = new Date().toISOString();
    try {
      writeOwner(lockPath, owner);
      return true;
    } catch {
      active = false;
      if (timer) clearInterval(timer);
      return false;
    }
  };

  if (heartbeatMs > 0) {
    timer = setInterval(refresh, heartbeatMs);
    timer.unref?.();
  }

  return {
    dbPath: absoluteDbPath,
    lockPath,
    token: owner.token,
    refresh,
    release() {
      if (!active) return false;
      active = false;
      if (timer) clearInterval(timer);
      let current;
      try {
        current = readOwner(lockPath);
      } catch {
        return false;
      }
      if (current.token !== owner.token) return false;
      rmSync(lockPath, { recursive: true, force: true });
      return true;
    }
  };
}
