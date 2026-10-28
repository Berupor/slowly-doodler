# How it works

`content/hook.js` runs in the page's JS world at document start and patches `Storage.prototype.getItem`. Slowly's editor offers to restore a draft from `slowly-drawing-recovery:*`; when Doodler has a drawing under `doodler:pending`, the patched `getItem` returns it for that key once. The content script then clicks Restore and Done like a user would. No request to Slowly is forged, the page does its own upload.

`editor/sdj.js` mirrors Slowly's drawing format and limits. `content/friends.js` recomputes Slowly's friend URL hashes to preselect the friend whose letter is open. The editor runs in an extension iframe with Slowly's stylesheets passed in. The library lives in extension storage.

Permissions are `storage` and `unlimitedStorage`, host access is `https://web.slowly.app/*` only. The only other request is the Open Sans stylesheet from Google Fonts.

## Breakage

The send path depends on Slowly's markup and bundle. The selectors are in one object, `SLOWLY` in `content/content.js`. When one is missing, the extension logs `doodler_selector_missing` and shows a toast once per session. If Slowly changes the drawing format, `editor/sdj.js` and the validator copy used by the e2e test need to follow.
