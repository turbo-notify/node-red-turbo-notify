# Changelog

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
