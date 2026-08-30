# 06: Filters as URL params

**What to build:** The board can be filtered by app, project, status set and title text. The filter state is entirely in the URL query string, so a bookmarked URL is a saved view and reload/back/forward preserve it. `cancelled` visibility is *not* a filter: it is a board view option (issue 03, `localStorage`); the status filter simply narrows whatever the view shows. List endpoints accept the same parameters.

**Blocked by:** 04 (Lifecycle — transition table, intent endpoints, drag-and-drop)

**Status:** ready-for-agent

- [ ] `GET /tickets?app=&project=&status=a,b&q=` filters server-side; API tests for each and combined
- [ ] Filter bar on the board per DESIGN.md (chips and one text input; mono for keys); state ⇄ URL
- [ ] Filters compose with the view option from 03 (a status filter of `cancelled` with the view option off shows nothing — no special case); done always shown, quiet
- [ ] Browser smoke: set a filter, reload, filter persists
