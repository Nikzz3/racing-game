# Releasing the desktop app

The desktop app (`desktop/`) ships as installers for macOS, Windows and Linux through
GitHub releases. A release is a tag push; everything after that is automated by
`.github/workflows/desktop.yml`. Nobody writes release notes by hand.

## Cutting a release

1. **Bump the version** in `desktop/package.json` (`"version": "0.2.0"`), commit it to
   `master`, and push. The tag must equal `v` + this version, so bump first.
2. **Tag and push the tag:**

   ```bash
   git tag -a v0.2.0 -m "Sunset Ridge Racing desktop 0.2.0"
   git push origin v0.2.0
   ```

3. **Wait for the workflow.** Three `package` jobs build the installers on macOS, Windows
   and Ubuntu runners and upload them as artifacts. A final `release` job then downloads
   all of them, checks the tag matches the package version, generates the notes, and
   creates **one release** named after the tag with every installer plus the
   `latest*.yml` and `.blockmap` files the in-app updater reads. It is created as a
   draft only while the assets upload and is published in the same run.
4. **Done.** Installed apps see the new version on their next update check, so only push
   a tag when the version is ready for players. To pull a release back, mark it as a
   draft on the releases page; the updater then falls back to the previous one.

Re-running the workflow on the same tag (Actions → Desktop installers → Run workflow →
choose the tag) rebuilds everything and updates the existing release in place.

## Where the release notes come from

`desktop/scripts/release-notes.mjs` produces the release body from git at release time:

- **Downloads** — a table linking each platform's installer on the release, followed by
  one-line first-launch hints (macOS not notarized → Open Anyway or `xattr -cr`, Windows SmartScreen →
  More info and Run anyway, Linux → `chmod +x` the AppImage).
- **What's Changed** — every non-merge commit subject between the previous `v*` tag and
  this one, each linked to its commit. Descriptive commit subjects are therefore the
  changelog; write them for the player reading the release.
- **Full Changelog** — a GitHub compare link from the previous tag to this one.

For the first release there is no previous tag, so the list is limited to commits that
touched the desktop workspace or its workflow.

To preview the notes locally for an existing tag:

```bash
node desktop/scripts/release-notes.mjs v0.2.0
```

## What the installed app does with a release

Packaged apps check the latest **published** release at launch and every six hours
(`electron-updater`, configured in `desktop/src/main.ts`). The lobby header always shows
an update control: it reads `v<version> · Check for updates` until the first check
completes, `v<version> · Up to date` once a check found nothing newer (clicking it
re-checks), and when a newer version exists clicking it downloads and installs, then
restarts.

- **Windows and Linux** install in place, unsigned or not. A Linux install that was not
  started through the AppImage runtime (extracted bundle, snap) cannot self-update; the
  control then reads `Get updates` and opens the releases page.
- **macOS** can only install in place when the app is code-signed. Unsigned builds (no
  `CSC_LINK` secret) are marked as such at package time; they show the new version as a
  download and open the releases page instead of fetching an update they cannot install.

## Configuration that feeds a release

| Setting                                                    | Where                      | Purpose                                                                         |
| ---------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------- |
| `RACING_SERVER_URL`                                        | GitHub repository variable | WebSocket URL baked into the installers (`wss://racing.nickzimmermann.com`)     |
| `CSC_LINK`, `CSC_KEY_PASSWORD`                             | GitHub secrets (optional)  | Code-signing certificate for macOS and Windows                                  |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | GitHub secrets (optional)  | macOS notarization; also set `notarize: true` in `desktop/electron-builder.yml` |
| `version`                                                  | `desktop/package.json`     | Release version; must match the tag                                             |

Without the signing secrets the workflow still succeeds and ships unsigned installers, which
macOS Gatekeeper and Windows SmartScreen warn about on first launch. The macOS bundle is
still ad-hoc signed by `desktop/scripts/after-pack.cjs` so Gatekeeper offers Open Anyway
instead of declaring the app damaged.
