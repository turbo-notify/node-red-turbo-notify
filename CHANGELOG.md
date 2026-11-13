# Changelog

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
