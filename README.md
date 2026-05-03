# mark-feed-links-as-read

Local unpacked Chrome extension that restores a "read-like" visual cue for
New Scientist links when browser visited-link partitioning is enabled.

## What it does

- Watches browser tab/navigation loads.
- Marks New Scientist article pages as seen regardless of where they were opened from.
- Stores a local seen-link set in `chrome.storage.local`.
- Injects custom scrollbar styling on `newscientist.com` and `substack.com` pages.
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

html,
body {
	scrollbar-width: auto !important;
	scrollbar-color: rgba(128, 128, 128, 0.8) #F1F1F1 !important;
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
2. Refresh any open New Scientist tabs.
3. Open a New Scientist article page in any tab.
4. Open `chrome://extensions`, click `Inspect views` for this extension content script/service worker, and check for errors.

This extension only tracks and decorates New Scientist `/article/...` links.

Debug logs use the prefix `[MFLAR]` in the page console.
Background service worker logs use `[MFLAR][BG]` in the extension service worker console.

Right-click alone does not mark a link as seen; marking happens once a New Scientist article tab actually loads.