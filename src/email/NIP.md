Newsletters
===========

This NIP defined Nostr-based newsletters that can be delivered over nostr,
email or other channels. Newsletter has a private list of subscribers,
each subscriber provides their addresses (email, etc), and a `sender` service is used to deliver the newsletter messages. 

Newsletter event
----------------

Newsletter event of kind 30587 announces the newsletter with it's metadata. An important part of newsletter is the `sender` service
whose pubkey is tagged to make sure newsletter software knows who
is in charge of delivering the newsletter messages and confirming 
new subscriber addresses.

// newsletter event
{
  id: <newsletter-event-id>,
  kind: 30587, 
  pubkey: <newsletter-pubkey>,
  created_at: 1234567890,
  content: "",
  tags: [
    ["d", "my-newsletter"],
    ["p", <sender_pubkey>, "sender"],
    ["title", "Nostr Weekly"],
    ["description", "Weekly news on nostr development"],
    ["alt", "Newsletter: Nostr Weekly"]
    ["icon", <icon_url>],
    ["banner", <banner_url>],
    ["accent_color", "#ff0000"], // helps with styling 
  ]
}


Subscribe / unsubscribe events
------------------------------

The subscribe/unsubscribe actions are represented by a gift-wrapped kind:587 `action` event. `action` event specifies the recipient addresses and their types. 

Defined types are "email" and "nostr", other types to be added later. 

Non-nostr addresses may have `user-pubkey` attached if subscription was requested via Nostr (vs i.e. importing existing email subscribers).

One `action` may include many addresses, to facilitate bulk-import/delete by newsletter admins. 

When several actions for a particular address and newsletter are published, the most recent one takes precedence.

// action event - nip59 rumor
{
  id: <event id>,
  created_at: 1234567890,
  kind: 587,
  pubkey: <user-pubkey|sender-pubkey|newsletter-pubkey>,
  content: "",
  tags: [
    ["n", "30587:<newsletter-pubkey>:my-newsletter"], // newsletter address
    ["action", <"subscribe"|"unsubscribe">],
    ["nostr", <pubkey1>],
    ["nostr", <pubkey2>],
    ["email", <email1>, <user-pubkey1>?],
    ["email", <email2>, <user-pubkey2>?],
    ...
  ],
  // no signature!
}

// nip59 seal
{
  kind: 13,
  pubkey: <user-pubkey|sender-pubkey|newsletter-pubkey>,
  content: nip44_encrypt(<rumor>, <user-pubkey|sender-pubkey|newsletter-pubkey>),
  tags: [], // empty tags!
  sig: <signature>
}

// nip59 gift-wrap
{
  kind: 1059,
  pubkey: <random-pubkey>,
  content: nip44_encrypt(<seal>, <user-pubkey|sender-pubkey|newsletter-pubkey>),
  tags: [
    ["p", <user-pubkey|sender-pubkey|newsletter-pubkey>],
  ],
  sig: <signature>
}

There is also an auxiliary gift-wrapped `request` event of kind:586
that is used to request a confirmation message from `sender` for non-nostr address types. The structure is the same as `action` event, but it's always `user` publishing for `sender`.

// request - nip59 rumor
{
  id: <id>
  kind: 586,
  pubkey: <user-pubkey>,
  content: "",
  tags: [
    ["n", <newsletter-address>],
    ["action", <"subscribe"|"unsubscribe">],
    ["nostr", <user-pubkey>],
    ["email", <email>, <user-pubkey>],
    ["telegram", <tg_id>],
    ...
  ]
  // no signature!
}

// nip59 seal
{
  kind: 13,
  pubkey: <user-pubkey>,
  content: nip44_encrypt(<rumor>, <sender_pubkey>),
  tags: [], // empty tags!
  sig: <signature>
}

// nip59 gift-wrap
{
  kind: 1059,
  pubkey: <random-pubkey>,
  content: nip44_encrypt(<seal>, <sender_pubkey>),
  tags: [
    ["p", <sender_pubkey>],
  ],
  sig: <signature>
}

Subscribe / unsubscribe flows
-----------------------------

There are several valid flows depending on the action type, address type and the initiating party.

Subscribe/unsubscribe of "nostr" address by user:
- `user` publishes `action` event for themselves and for the `newsletter`, pubkey in "nostr" address must be equal to the pubkey of the `action` event

Import of non-nostr addresses by the newsletter:
- `newsletter` publishes subscribe `action` event for itself without `user-pubkey` attached to addresses 

Subscribe/unsubscribe of non-nostr address by user:
- `user` publishes the `action` event for themselves, and a `request` event for the `sender`
- `sender` sends confirmation message to provided address (i.e. with a confirmation link)
- `user` performs the confirmation action (i.e. clicks on confirmation link) and `sender` copies address tags and publishes `action` event for the `newsletter` 

Unsubscribe of non-nostr address by "unsubscribe link":
- "unsubscribe link" (or similar "challenge") might be sent by the `sender` inside the newsletter messages
- `user` performs the confirmation action (i.e. clicks on unsubscribe link) and `sender` publishes `action` events for this particular address for the `newsletter`, and for the `user` if `user-pubkey` is attached to the address

Unsubscribe by newsletter:
- `newsletter` publishes unsubscribe `action` event for itself, and for the `user` if `user-pubkey` is attached to the address
- `newsletter` may also add the address to a blacklist to prevent re-subscribing FIXME how?

Sending newsletter issues
-------------------------

A gift-wrapped kind:1587 `issue` event is used to deliver the newsletter messages to users.

For "nostr" addresses, both `newsletter` or `sender` are the valid publishers of the `issue` events. Client must check that "nostr" address mentioned in the `issue` event equals to the user pubkey.

For non-nostr addresses, `newsletter` publishes the `issue` event for the `sender` including the list of recipient addresses. `sender` will then convert the issue payload into a proper envelope for each address type, and deliver it to recipients.

`issue` events have the payload in two formats - HTML and Markdown,
so that `sender` could deliver a proper variant to each address type.

// issue - nip59 rumor
{
  id: <id>
  kind: 1587,
  pubkey: <newsletter-pubkey>,
  content: "",
  tags: [
    ["n", <newsletter-address>],
    ["html", <html-message>],
    ["markdown", <markdown>],
    ["nostr", <user-pubkey1>],
    ["email", <email1>],
    ["email", <email2>],
    ...
  ]
  // no signature!
}

// nip59 seal
{
  kind: 13,
  pubkey: <newsletter-pubkey>,
  content: nip44_encrypt(<rumor>, <sender-pubkey|user-pubkey>),
  tags: [], // empty tags!
  sig: <signature>
}

// nip59 gift-wrap
{
  kind: 1059,
  pubkey: <random-pubkey>,
  content: nip44_encrypt(<seal>, <sender-pubkey|user-pubkey>),
  tags: [
    ["p", <sender-pubkey|user-pubkey>],
  ],
  sig: <signature>
}


FIXME Newsletter address blacklist event?

