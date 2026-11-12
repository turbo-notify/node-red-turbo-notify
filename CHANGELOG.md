# Changelog

## 0.1.0

First release.

- Turbo Notify account node (config) with the API key in the Node-RED credentials store and a Test button.
- whatsapp send: text, image, video, audio, document, sticker, location and replies, with an idempotency key.
- whatsapp status: reads the status of a sent message.
- whatsapp events: polls `GET /v1/events` with a persistent cursor, oldest first, at least once.
- Four importable example flows.
