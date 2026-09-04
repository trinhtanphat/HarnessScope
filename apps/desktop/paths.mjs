import { join } from 'node:path';

export function defaultWorkspacePath(userData) {
  if (typeof userData !== 'string' || !userData.trim()) {
    throw new TypeError('Electron userData path is required.');
  }
  return join(userData, 'HarnessScope', 'workspace.sqlite');
}
