import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  HEARTBEAT_MS,
  STALE_MS,
  WorkspaceLockError,
  acquireWorkspaceLock,
  lockPathFor
} from '../src/core/workspace-lock.mjs';

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'harnesscope-lock-'));
  return { dir, dbPath: join(dir, 'workspace.sqlite') };
}

function writeOwner(lockPath, owner) {
  mkdirSync(lockPath, { recursive: true });
  writeFileSync(join(lockPath, 'owner.json'), JSON.stringify(owner));
}

test('workspace lock constants are the shared 5s heartbeat / 30s stale contract', () => {
  assert.equal(HEARTBEAT_MS, 5_000);
  assert.equal(STALE_MS, 30_000);
});

test('first owner acquires, a second owner fails closed, and owner release removes the lock', () => {
  const { dir, dbPath } = tempDb();
  const lease = acquireWorkspaceLock(dbPath, { runtime: 'node-test', heartbeatMs: 0 });
  assert.equal(lockPathFor(dbPath), `${dbPath}.lock`);
  assert.throws(
    () => acquireWorkspaceLock(dbPath, { runtime: 'other', heartbeatMs: 0 }),
    (error) => error instanceof WorkspaceLockError && error.code === 'WORKSPACE_LOCKED'
  );
  assert.equal(lease.release(), true);
  assert.equal(lease.release(), false);
  rmSync(dir, { recursive: true, force: true });
});

test('old live or unknown owners are never reclaimed, but confirmed-dead owners are', () => {
  const { dir, dbPath } = tempDb();
  const lockPath = lockPathFor(dbPath);
  const staleOwner = {
    token: 'stale-token', pid: 424242, runtime: 'stale-test', processStartIdentity: null,
    acquiredUtc: '2000-01-01T00:00:00.000Z', heartbeatUtc: '2000-01-01T00:00:00.000Z'
  };
  writeOwner(lockPath, staleOwner);

  assert.throws(
    () => acquireWorkspaceLock(dbPath, { heartbeatMs: 0, isProcessAlive: () => true }),
    (error) => error.code === 'WORKSPACE_LOCKED'
  );
  assert.throws(
    () => acquireWorkspaceLock(dbPath, { heartbeatMs: 0, isProcessAlive: () => { throw new Error('probe failed'); } }),
    (error) => error.code === 'WORKSPACE_LOCKED'
  );

  const lease = acquireWorkspaceLock(dbPath, { heartbeatMs: 0, isProcessAlive: () => false });
  const current = JSON.parse(readFileSync(join(lockPath, 'owner.json'), 'utf8'));
  assert.notEqual(current.token, 'stale-token');
  assert.equal(lease.release(), true);
  rmSync(dir, { recursive: true, force: true });
});

test('release is owner-token checked and malformed lock metadata fails closed', () => {
  const { dir, dbPath } = tempDb();
  const lockPath = lockPathFor(dbPath);
  const lease = acquireWorkspaceLock(dbPath, { heartbeatMs: 0 });
  const owner = JSON.parse(readFileSync(join(lockPath, 'owner.json'), 'utf8'));
  writeFileSync(join(lockPath, 'owner.json'), JSON.stringify({ ...owner, token: 'different-owner' }));
  assert.equal(lease.release(), false);
  assert.equal(readFileSync(join(lockPath, 'owner.json'), 'utf8').includes('different-owner'), true);
  rmSync(lockPath, { recursive: true, force: true });

  mkdirSync(lockPath, { recursive: true });
  writeFileSync(join(lockPath, 'owner.json'), '{not-json');
  assert.throws(
    () => acquireWorkspaceLock(dbPath, { heartbeatMs: 0, isProcessAlive: () => false }),
    (error) => error.code === 'WORKSPACE_LOCKED'
  );
  rmSync(dir, { recursive: true, force: true });
});
