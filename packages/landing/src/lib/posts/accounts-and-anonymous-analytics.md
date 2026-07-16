---
title: "What Changes When You Create a Quillium Account"
description: "Creating an account links your anonymous analytics identifier to it. Here's exactly what that means and what it doesn't."
date: "2026-07-16"
author: "Bryan Hu"
featured: false
---

I've written before about how [Quillium doesn't track you](./quillium-privacy)—no accounts, no login, no user ID tied to your identity, just an anonymous identifier PostHog assigns on its own. That's still true for the vast majority of people using Quillium today. But accounts now exist, for [Omni sync](./introducing-omni), and I want to be upfront about the one thing that changes once you create one.

## The change

If you create a Quillium account, we link your previously anonymous analytics identifier to that account. Concretely: if you report a bug or something breaks, we can now look at what happened on your account specifically, instead of only seeing an anonymous, unlabeled event stream we can't trace back to you.

That's it. That's the whole change.

## What stays the same

- If you never create an account, nothing changes. You get the exact same anonymous experience described in the original privacy post.
- We don't retroactively identify anything. Analytics collected before you had an account stay anonymous; the link only starts from the moment the account exists.
- We still don't sell, share, or advertise against this data. It exists so we can help you, not to build a profile of you.
- Your documents are unaffected either way—this is about analytics identifiers, not your writing.

## Why bother telling you this

Because the original post said "we don't call any identify function with personal information," and once accounts existed, that stopped being true for account holders. I'd rather correct that in public than let an old, absolute claim quietly go stale. The [privacy policy](/privacy) has the full legal language if you want the specifics (Section 2.10).

If this bothers you: don't create an account. Everything Quillium does locally still works exactly as it always has.
