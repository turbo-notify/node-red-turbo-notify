# Changelog

## 1.5.15

A first-run review in a real Node-RED editor: can a person who just installed the nodes understand, alone, that they need a Turbo Notify account, a linked WhatsApp number and an API key? They could not, so:

- The **Turbo Notify account** dialog now opens with the three things you need and a link to each screen of the dashboard (account, Numbers, API keys), and its list entry and title read "Turbo Notify account" instead of the technical node name. The whatsapp send, status and events dialogs say where to start and what `main` means.
- The **Test** button now checks the key and then your main WhatsApp number, and says in plain words which of these you are in: ready, key works but no number linked yet, key refused, text that is not a key, or key without permission to read numbers. A button opens the right page of the dashboard. It no longer starts with a technical code and no longer says "works" when the number is not linked.
- After a deploy without a key, the nodes show a yellow **paste your API key** at once (the events node waits instead of failing every poll).
- **The Base URL setting is gone.** The nodes always use `https://api.turbonotify.com`. A flow you import or share used to be able to name another address and receive the key you pasted; now it cannot. A flow made with an older version that still carries an address ignores it and logs one line. To use another address on purpose (a test double or a staging copy), the administrator sets `turboNotifyBaseUrl` in `settings.js`.
- All eighteen example flows start with a note called **START HERE** that repeats the three setup steps with links, their titles and descriptions say WhatsApp, and their account node carries no address.
- Fix: the API answers `status` as an object (`state`, `at`, `error`). The **confirm delivery** example compared it with the text "failed", so it never warned about a failed message, and the whatsapp send and status nodes showed `[object Object]` under the node. They now read `status.state`; the help text and README say `msg.payload.status.state`. If you use `payload.status` in your own switch, change it to `payload.status.state`.
- The flows that answer people no longer risk a loop or a flood: the reply and menu flows answer a person at most once an hour (the menu still answers every real choice), nobody gets more than 6 menu answers or 3 locations an hour, every answer leaves through a delay of one message every 10 seconds, the answer flows stop at 60 answers an hour in all (30 for the location flow), the team group flow forwards at most 5 an hour per person and 20 in all and changes `@` followed by digits so a stranger cannot ping your team, the CSV log keeps a message that starts like a spreadsheet formula as text, the website flow sends nothing until you set the name of your site, and every flow that reads messages ignores any event that is not an inbound `message.received` or `message.replied`, so emptying the event types field cannot make it answer its own sent messages. The START HERE notes of the flows that answer people say the first check after a deploy only remembers the newest message (test from another phone after the deploy) and where to find the grp_ id of a group.
- Error texts match the API: a 422 names the field and the reason (`to.number: ...`), a missing main number says to use Connect main number (the Test button now says "no number linked yet" for a fresh account instead of "could not check"), and a timeout no longer tells you to read a message status you do not have.
- Messages that quote another message arrive as `message.replied`, not `message.received`: the flows that read messages now listen to both (and ignore a reply that your own number sent, so they cannot answer themselves), and the events help and README say how to get both. A person who swipes to reply to your menu is answered.
- The description of an API error is also in `msg.errorDescription`, because Node-RED 3 does not copy it into `msg.error.cause` (Node-RED 4 does). The Node-RED error alert no longer alerts about the failure of its own send node, so a revoked key cannot make it retry forever.
- The README, the send node help and the docs page now say both things about the pace of a number: a send that comes before the minimum gap of the plan (6 seconds on Free) is refused with `429 send_rate_spacing`, and the accepted messages leave one at a time, a few seconds apart, so a burst waits and the tail can end as `message_timeout`. The delay node in front of the send is what paces a list.
- Questions from the first public feedback (what is a cycle, what happens at the limit, which number can be linked) are answered where a person looks: the **Test** button now also says how much of the message allowance of the cycle is used and when the count starts again, the quota errors say that a cycle is one month, that the date is under Billing and that a bigger plan sends again right away, and the README and the docs page have a "Plan limits" and a "Which number" paragraph.
- A number alias of `.` or `..` is refused instead of reaching another API route, and an error about a missing scope now says to create a new key (the scopes of a key cannot be changed afterwards).
- `npm run editor` starts a real Node-RED with the package and a stand-in for the API, to try every state above without an account.

## Redirect of the first package name

- `@turbo-notify/node-red-turbo-notify` 1.5.14 is a signpost with no nodes (folder `redirect/`). It depends on `@turbo-notify/node-red-whatsapp`, so an install or an update of the old name brings the new package and flows keep working. It is published by the same workflow on a tag named `redirect-1.5.14`.

## 1.5.14

- Security: the two flows that open an HTTP endpoint (`http-endpoint-to-whatsapp` and `order-confirmation`) no longer ship a default token. The tab variable `ALERT_TOKEN` is empty, and the endpoint answers `503` to every call until you set a token of at least 16 characters; a wrong token answers `401`. The token is compared character by character in constant time. In 1.5.13 the variable started as `change-me` and an empty token let every call through, so anyone who deployed one of these flows without changing the token left it open. If you deployed either flow from 1.5.13, set a strong `ALERT_TOKEN` now.
- The setup comment of both flows says who can send with the token (any number, from your number) and asks for https.

## 1.5.13

- The package is now `@turbo-notify/node-red-whatsapp`, so a search for "node-red whatsapp" finds it. It replaces `@turbo-notify/node-red-turbo-notify` (0.1.0 and 0.1.1). The node types did not change, so a flow that uses the old package keeps working: uninstall the old package, install this one and restart Node-RED.
- Version 1.5.13, the version every public Turbo Notify package carries.
- Fourteen new example flows, eighteen in all: a scheduled reminder, an HTTP endpoint that sends a message, an order confirmation, a menu by keyword, an after-hours reply, forwarding to a team group, a website down alert, a temperature alert, a daily weather forecast, a PDF, the store location, a Node-RED error alert, a delivery check and a CSV log. Each one runs in the test suite on the real Node-RED nodes.

## 0.1.1

- The package homepage points to the Turbo Notify in Node-RED page in the documentation.
- First release published through the npm Trusted Publisher (no token).

## 0.1.0

First release.

- Turbo Notify account node (config) with the API key in the Node-RED credentials store and a Test button.
- whatsapp send: text, image, video, audio, document, sticker, location and replies, with an idempotency key.
- whatsapp status: reads the status of a sent message.
- whatsapp events: polls `GET /v1/events` with a persistent cursor, oldest first, at least once.
- Four importable example flows.
- The key travels only over https (or to this computer), and the Test button sends the stored key only to the address the node was deployed with.
