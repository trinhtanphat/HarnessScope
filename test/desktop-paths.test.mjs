import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { defaultWorkspacePath } from '../apps/desktop/paths.mjs';

test('desktop workspace lives under Electron userData HarnessScope directory', () => {
  const userData = join('tmp', 'electron-user-data');
  assert.equal(
    defaultWorkspacePath(userData),
    join(userData, 'HarnessScope', 'workspace.sqlite')
  );
});
