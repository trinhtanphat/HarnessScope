# HarnessScope Tauri Desktop

HarnessScope v0.3 adds a Rust/Tauri desktop shell while preserving the existing Node/Electron fallback during the migration. The renderer is shared from `ui/`; application behavior is provided by `harnesscope-core` through an explicit command allowlist.

## Security model

The Tauri shell does not expose raw filesystem or shell plugins to the renderer. Native file selection is mediated by the dialog adapter, imported evidence is redacted before persistence, file observation records metadata only, and process observation is limited to targets the user explicitly launches through HarnessScope.

The main window uses a restrictive CSP and a capability file scoped to the `main` window. Do not add blanket shell, filesystem, arbitrary URL, credential, protected-memory, injection, or security-bypass permissions.

## Local development

From the repository root, install the pinned Node dependencies and run `npm run tauri:dev`. The native production targets are Windows x64 and macOS universal. Rust core code still builds and tests on Linux, but the Tauri window itself is not a Linux release target in v0.3.

## Unsigned v0.3 builds

The v0.3 Windows and macOS packages are intentionally unsigned until code-signing credentials are available. Verify the release checksum before opening an artifact. Windows SmartScreen and macOS may therefore show an unverified-developer warning. On macOS, users who trust the downloaded checksum/source can use Finder's normal **Open** action; do not disable Gatekeeper system-wide.
