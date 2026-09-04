# HarnessScope Tauri Desktop

HarnessScope v0.3 uses Tauri as the **preferred** Windows/macOS desktop runtime while preserving the Node CLI, browser UI, and Electron fallback. The renderer is shared from `ui/`; privileged behavior is provided by `harnesscope-core` through an explicit Tauri command allowlist.

## Security model

The Tauri shell does not expose raw filesystem or shell plugins to renderer feature code. Native file selection is mediated by the dialog adapter, imported evidence is redacted before persistence, file observation records metadata only, and process observation is limited to targets the user explicitly launches through HarnessScope.

The main window uses a restrictive CSP and a capability file scoped to the `main` window. Do not add blanket shell, filesystem, arbitrary URL, credential, protected-memory, injection, or security-bypass permissions.

Workspace writers use the shared cross-runtime lock protocol before opening a writable SQLite workspace, so the Tauri, Node CLI/server, and Electron paths fail closed rather than writing concurrently.

## Local development

From the repository root:

```bash
npm ci
npm run tauri:dev
```

The native production targets are Windows x64 and macOS universal. Rust core/parity still build and test on Linux, but the Tauri window itself is not a Linux release target in v0.3.

Build native packages on their target operating systems:

```bash
npm run tauri:win
npm run tauri:mac
```

Normalized release outputs are produced by `scripts/package-windows-portable.ps1` and `scripts/package-macos-app.sh`.

## v0.3 release assets

The fail-closed release workflow publishes exactly these seven public assets from the exact successful `main` SHA:

```text
HarnessScope-0.3.0-windows-x64-Setup.exe
HarnessScope-0.3.0-windows-x64.msi
HarnessScope-0.3.0-windows-x64-portable.zip
HarnessScope-0.3.0-macos-universal.dmg
HarnessScope-0.3.0-macos-universal.app.zip
HarnessScope-0.3.0-source.zip
SHA256SUMS.txt
```

The release workflow independently reruns Node tests, Rust formatting/clippy/tests, semantic parity, and Tauri checks on native runners before packaging. It never publishes PR artifacts and never rewrites an existing `v0.3.0` tag.

## Unsigned v0.3 builds

The v0.3 Windows and macOS packages are intentionally **unsigned** until code-signing credentials are available. Verify `SHA256SUMS.txt` before opening an artifact.

Windows SmartScreen may show an unknown-publisher warning. If you trust the verified release, use the normal **More info → Run anyway** flow; do not disable SmartScreen or Defender.

On macOS, if you trust the verified release, use Finder **Control-click → Open** and confirm **Open**. HarnessScope does not require disabling Gatekeeper or changing system-wide security settings.

## Electron fallback

The Electron desktop runtime remains supported as a fallback and regression path under `apps/desktop`. Tauri-specific permissions and APIs must stay isolated from the shared renderer just as Electron-specific imports stay isolated under `apps/desktop`.
