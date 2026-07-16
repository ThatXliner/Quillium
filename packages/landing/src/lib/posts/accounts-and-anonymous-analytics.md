---
title: "What Changes When You Create a Quillium Account"
description: "Creating an account links your anonymous analytics identifier to it. Here's exactly what that means and what it doesn't."
date: "2026-07-16"
author: "Bryan Hu"
featured: false
---

I've written before about how [Quillium doesn't track you](./quillium-privacy): no accounts, no login, no user ID tied to your identity, just an anonymous identifier that PostHog assigns on its own. That's still true for the vast majority of people using Quillium today. But accounts now exist, for [Omni sync](./introducing-omni), and I want to be upfront about the one thing that changes once you create one.

## The change

If you create a Quillium account, we link your previously anonymous analytics identifier to that account, and that's the whole change. In practice, it means that if you report a bug or something breaks, we can look at what happened on your account specifically, rather than seeing only an anonymous, unlabeled event stream we can't trace back to you.

## What stays the same

- If you never create an account, nothing changes. You get the exact same anonymous experience described in the original privacy post.
- We don't retroactively identify anything. Analytics collected before you had an account stay anonymous; the link only starts from the moment the account exists.
- We still don't sell, share, or advertise against this data. It exists so we can help you, not to build a profile of you.
- Your documents are unaffected either way, since this is about analytics identifiers rather than your writing.

## Why bother telling you this

The original post said we don't call any identify function with personal information, and once accounts existed, that stopped being true for account holders. I'd rather correct that in public than let an old, absolute claim quietly go stale. The [privacy policy](/privacy) has the full legal language if you want the specifics, in Section 2.10. If this bothers you, the simplest answer is not to create an account, since everything Quillium does locally still works exactly as it always has.

## Where this could go

Longer term, I'd like to push this further rather than settle for "linked, but only for support." Mullvad runs its whole VPN service on random account numbers, with no email, no name, and nothing that links a payment or a session back to a person unless you choose to hand it over. There's no reason an account for sync couldn't work the same way, using an identifier that gets you Omni access without ever being tied to who you actually are. I have nothing concrete to announce yet; this is simply the direction I would rather move in than away from.
