# Capability Status

A readout of what Kiki can do today, grouped by how reliably each capability works. Not a benchmark — a hand-curated status summary maintained by the author. If you hit something listed under "Not yet working," it's a known limit, not a bug.

Each row is triggerable from any of the three surfaces unless noted:

- **Voice:** say `"Kiki, <command>"` (requires wake word detection)
- **Hotkey:** press `Ctrl+/` then speak `<command>`
- **Chat:** open the side panel and type `<command>`

---

## Working reliably

Single-action commands. These lean on the Tier 1 classifier and a single action from the action schema in [extension/background/prompts.js](extension/background/prompts.js). They land on the first try on any typical page.

| Command | Site | Expected outcome |
|---|---|---|
| `scroll down` | Any long article (e.g. `en.wikipedia.org/wiki/Chrome_extension`) | Page scrolls down a moderate amount (about one screenful). |
| `go to the top` | Same page, after scrolling | Page snaps back to the top. |
| `go to wikipedia.org` | Any tab | Navigates the current tab to wikipedia.org. |
| `go back` | After a navigation | Browser back button fires. |
| `click number 3` | Any page with the numbered label overlay visible | Element labeled `[3]` is clicked. |
| `search for blue running shoes` | `google.com` (with the search box focused or visible) | Types the phrase into the search input and submits (Enter). |
| `switch to my Gmail tab` | Multiple tabs open, one of them Gmail | Focus moves to the Gmail tab. |

## Working with caveat

Multi-step commands that escalate to the Tier 2 planner. They work on well-structured pages but are sensitive to layout changes, dynamic content, and ambiguous element names. Expect retries.

| Command | Site | Expected outcome | Caveat |
|---|---|---|---|
| `search for "voice control browser" and open the first result` | `google.com` | Types query, submits, clicks the first organic result. | Sponsored/ad results can land above the first organic link and get clicked instead. |
| `click the first headline` | `news.ycombinator.com` | Navigates to the top story's link. | "First" is interpreted via ref ordering; if the page is scrolled, ordering may be off. |
| `find the price on this page` | Any product listing (e.g. a public Amazon product page) | Chat surface returns the price in plain text. | Works via page Q&A (see below); action executors aren't involved. |
| `compose a new email to test@example.com with subject hello` | `mail.google.com` (must already be signed in) | Opens compose, fills recipient and subject. | Fails if compose button is offscreen or if Gmail's DOM changes; body fills are inconsistent. |
| `fill this form with name John and email john@example.com` | Any simple contact form (e.g. `httpbin.org/forms/post`) | Fills the name and email inputs in order. | Two-column or stepped forms confuse the planner; expect partial fills. |

## Page Q&A (chat surface)

These run through the Tier 1 path but return `{action: "done", message: "..."}` with an answer read from the page snapshot — no clicks, no typing. Best used through the chat panel.

| Command | Site | Expected outcome |
|---|---|---|
| `what are the top stories?` | `news.ycombinator.com` | A short list of headlines with points, extracted from the current page. |
| `what is this page about?` | Any article or landing page | One- or two-sentence summary of the page's heading and first paragraphs. |
| `extract the full specs` | A Wikipedia infobox or a product details page | A structured readout of the table's rows. Long infoboxes may be truncated. |

## Known rough edges

Capabilities that are under improvement. Listed so you don't have to find out by posting screenshots.

| Attempted command | Site type | What goes wrong |
|---|---|---|
| `book a flight from NYC to Dallas next Friday` | `google.com/flights` | Multi-step works for 2–3 actions, then the planner tends to re-pick the same date field, or the anti-loop constraint kicks in and the task exits before booking completes. |
| `add the third item to my cart` | Most e-commerce product grids | Virtualized lists and lazy-loaded images shift ref numbers between snapshots, so "third item" can resolve to a different card after scroll. |
| Anything spanning multiple tabs | `tab_new` / `tab_switch` combos | The planner can open a new tab but loses continuity after the switch; the `MAX_LLM_CALLS = 25` cap in [service-worker.js](extension/background/service-worker.js) tends to trip before a cross-tab workflow finishes. |
| Commands against deep web apps | Figma, Google Docs, Linear, Notion | These rely heavily on custom canvases, shadow DOM, or non-ARIA interactions. The accessibility snapshot from [accessibility-tree.js](extension/content/accessibility-tree.js) misses most of the interactive surface. |
| Commands after a CAPTCHA or cookie wall appears | Many EU-facing sites | Kiki does not bypass consent dialogs or anti-bot checks on your behalf. Dismiss them manually and try again. |

---

## Notes

- Results depend on which LLMs you've configured. Defaults work; smaller/faster models push "Working with caveat" rows toward "Known rough edges."
- Sites change. If a row here is stale, open a PR.
- If a "Working reliably" row fails for you repeatedly, that's worth a bug report with the page URL and the last few lines of the service worker console.
