# mark-feed-links-as-read

Local unpacked Chrome extension that restores a "read-like" visual cue for
New Scientist links when browser visited-link partitioning is enabled.

## What it does

- Tracks New Scientist article links opened from your Feeds page.
- Marks links opened via Right Click -> Open link in new tab using a background navigation listener.
- Stores a local seen-link set in `chrome.storage.local`.
- On `newscientist.com`, decorates matching links with a CSS class so they can
	appear "read" independently of `:visited`.

The decoration is extension-managed and only applies to New Scientist article
links (`/article/...`).

## Current style

The extension injects this style on New Scientist pages:

```css
a.mflar-seen-from-feeds,
a.mflar-seen-from-feeds * {
	color: dimgrey !important;
}
```

## Install (unpacked)

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select this folder.

## Notes

- Manifest version is intentionally `0.0.0` for local development use.
- Stored links are pruned by age and capped in size.

## Troubleshooting

If links are not decorating:

1. Reload the unpacked extension from `chrome://extensions` after code changes.
2. Refresh both the Feeds tab and any open New Scientist tabs.
3. Open a New Scientist article by clicking its link from Feeds.
4. Open `chrome://extensions`, click `Inspect views` for this extension content script, and check for errors.

This extension only tracks and decorates New Scientist `/article/...` links.

Debug logs use the prefix `[MFLAR]` in the page console.
Background service worker logs use `[MFLAR][BG]` in the extension service worker console.

Right-click alone does not mark a link as seen; marking happens on actual open actions.