# mark-feed-links-as-read

Local unpacked Chrome extension that restores a "read-like" visual cue for
links on domains you configure.

## What it does

- Watches browser tab/navigation loads.
- Saves links as seen only when the destination URL matches a configured
	history domain pattern.
- Stores seen-link URL history in `chrome.storage.local`.
- Decorates matching links with a CSS class so they can appear "read"
	independently of `:visited`.
- Provides a built-in options UI for:
	- Editable history domains for link history tracking
	- Simple per-domain custom CSS rules

No destination domain is hardcoded for link-history tracking.

## Built-in Link Style

The extension injects this style for seen-link decoration:

```css
a.mflar-seen-from-feeds,
a.mflar-seen-from-feeds * {
	color: dimgrey !important;
}
```

Scrollbar styling is no longer hardcoded. Add scrollbar rules through Extension
options using the custom style UI.

## Options UI

Open the extension Options page:

1. Open `chrome://extensions`.
2. Find this extension and click `Details`.
3. Click `Extension options`.

Configure history domains:

1. Add a domain pattern in `History Domains`.
2. Use `*` for all sites, `example.com` for exact host, or
	`*.example.com` for subdomains.

Configure custom styles:

1. Add a style rule with domain pattern, selector, and declarations.
2. Example declarations: `scrollbar-width: auto !important;`

Settings (history domains and CSS rules) are saved in `chrome.storage.sync`
and applied live on matching pages.

## Install (unpacked)

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select this folder.

## Notes

- Current extension version is `1.2.0`.
- URL history remains local to avoid sync storage limits.
- Existing synced URL history is automatically migrated back to local storage.
- Settings are synced so they follow your signed-in Chrome profile.

## Troubleshooting

If links are not decorating:

1. Reload the unpacked extension from `chrome://extensions` after code changes.
2. Confirm at least one `History Domains` entry exists in Extension options.
3. Refresh the relevant page and open a link to a tracked domain in any tab.
4. Open `chrome://extensions`, click `Inspect views` for this extension content script/service worker, and check for errors.

Right-click alone does not mark a link as seen; marking happens once a tracked-domain tab actually loads.