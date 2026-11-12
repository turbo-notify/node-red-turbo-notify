# Turbo Notify for Node-RED

Send WhatsApp messages from your own number, and start a flow when a message arrives, with [Turbo Notify](https://turbonotify.com).

**From your own number.** Messages leave from the WhatsApp number you link to your Turbo Notify account, not from a shared bot or a demo account.

```
[ sensor ] --> [ whatsapp send ] --> [ debug ]

[ whatsapp events ] --> [ your logic ] --> [ whatsapp send ]
```

## What you need

- A Turbo Notify account with a WhatsApp number linked to it.
- A plan that covers the messages you send.
- An API key created under **API keys** in the dashboard. Give it the scopes of the nodes you use: `messages:send` to send, `messages:read` to read the status of a message and `events:read` for the events node.
- Node-RED 3.0.0 or later and Node.js 18 or later.

## Install

In Node-RED, open the menu, choose **Manage palette**, then **Install**, and search for `@turbo-notify/node-red-turbo-notify`.

Or from the command line, in your Node-RED user directory (usually `~/.node-red`):

```
npm install @turbo-notify/node-red-turbo-notify
```

Restart Node-RED. The nodes appear in the **Turbo Notify** category of the palette.

## First message in two minutes

1. Drag a **whatsapp send** node into a flow. Open it and add a new account: paste your API key and press **Test**.
2. Put your own phone number in **To**, in international format (`+12025550123`).
3. Wire an **inject** node (with a text payload) to it and deploy.

Press the inject button. The node accepts the message at once and WhatsApp delivers it a moment later. The key is kept in the Node-RED credentials store, so it never appears in the flow file or in an exported flow.

## Nodes

| Node | What it does |
|---|---|
| **Turbo Notify account** (config) | Holds the API key and the address of the API. Its **Test** button reads your account usage and tells you whether the key works. |
| **whatsapp send** | Sends text, an image, video, audio, document or sticker (from a web address), or a location. Can reply to an earlier message. |
| **whatsapp status** | Reads how far a message has got: pending, sent, delivered, read or failed. |
| **whatsapp events** | Starts a flow when something happens on your number, such as a message arriving. Checks every 30 seconds by default. |

### whatsapp send

`msg.payload` as a string is the text of the message. Anything else comes from the node properties or from the message, and the message wins:

| Property | Meaning |
|---|---|
| `msg.to` | A phone number in international format (`+12025550123`), a contact id (`ct_...`) or a group id (`grp_...`). One recipient per message. |
| `msg.number` | The Turbo Notify number to send from: `main` (default), the alias of an extra number or its `num_...` id. |
| `msg.media` | `{ type, url, caption, filename }`. `type` is `image`, `video`, `audio`, `document` or `sticker`; `url` is a public http or https address. |
| `msg.location` | `{ latitude, longitude, name, address, url }`. |
| `msg.replyTo` | The id (`msg_...`) of an earlier message to quote. The reply goes to the chat of that message. |
| `msg.idempotencyKey` | Up to 255 plain characters. Repeating a send with the same key does not send twice. |

The output is the answer of the API on `msg.payload` (`message_id`, `status`) and the message id on `msg.messageId`, so you can wire **whatsapp status** straight after it.

A wrong phone number, two recipients, a media address that is not http or https, a text over 4096 characters or an id with the wrong prefix stops the message before anything is sent and names the property.

### whatsapp status

Takes `msg.messageId` (set by **whatsapp send**), and returns the status of the message on `msg.payload`. Ids belong to one number, so use the same number the message was sent from.

### whatsapp events

Options: the event types to listen to (default `message.received`; empty means every event), the number (empty means all of them) and the interval in seconds (default 30, minimum 10).

It emits one message per event, oldest first. `msg.payload` is the whole event (`id`, `type`, `number_alias`, `number_id`, `created_at`, `data`) and `msg.topic` is the event type.

## Errors

When the API refuses a call, the node shows the API error code in its status (a red ring) and raises an error whose message is that code, for example `insufficient_scope`. A **Catch** node receives it:

- `msg.error.message`: the error code.
- `msg.error.cause.description`: what it means and what to do.
- `msg.error.cause.status`, `msg.error.cause.requiredScope` (for `insufficient_scope`) and `msg.error.cause.retryAfter` (seconds, for a `429`) when the API gives them.

## Examples

Import them from the menu: **Import**, then **Examples**, then **@turbo-notify/node-red-turbo-notify**.

| Example | What it shows |
|---|---|
| `door-sensor-to-whatsapp` | An alert text when a sensor reports an event, then a check of its delivery status. |
| `reply-to-an-incoming-message` | Answers every private message that arrives, using the events node. |
| `daily-report-to-a-list` | A report sent every morning to several people, one message every 10 seconds. |
| `camera-picture-to-whatsapp` | A picture from a camera snapshot address, with a caption. |

Every example uses the placeholder number `+12025550123`: replace it before you deploy.

## Limits worth knowing

- **Sending pace.** Your number sends one message every 5 to 10 seconds. A flow that sends a burst queues the messages, and a message that waits more than 5 minutes fails with `message_timeout` (it may still arrive). When a flow sends a list, put a **delay** node set to rate limit (one message every 10 seconds) in front of **whatsapp send**, as in the `daily-report-to-a-list` example, or split the list over several runs.
- **Quotas and warm-up.** Plans limit messages and contacts per billing cycle, and a new number sends a limited volume in its first week. The API answers with a clear error code when a limit is reached.
- **Media.** The API takes a public http or https address. Node-RED does not upload a file.
- **Events are polled, not pushed.** The events node asks the API for new events every 30 seconds by default (never faster than every 10). Delivery is at least once, so keep `msg.payload.id` if a flow must never act twice on the same event. For sub-second delivery, use a webhook (see below).
- **The polling cursor.** The first check after a deploy only remembers the newest event, so a flow never runs on old history. The cursor is kept in the node context. With Node-RED's default in-memory context, a restart starts from now again: events that arrived while Node-RED was down are not replayed. To keep the cursor across restarts, set a persistent store as the default in your Node-RED `settings.js`:

  ```js
  contextStorage: {
      default: { module: 'localfilesystem' }
  }
  ```

  If a check fails (for example, the API is unreachable), the cursor does not move and the next check reads the same period again.

### Receiving events by webhook

Webhooks are set once per organization in the dashboard, so a node cannot register one for you. If you want push delivery, point the webhook at an **http in** node and check the signature in a **function** node, as described in the [webhook documentation](https://docs.turbonotify.com/en/messages/webhook/). The events node needs none of that.

## WhatsApp policy

Turbo Notify links an ordinary WhatsApp number to your account as a linked device. It is not the Meta WhatsApp Business Platform. Messages come from your own number, so WhatsApp's rules apply to you: message people who expect to hear from you, do not send unsolicited bulk messages, and read the [good practices](https://docs.turbonotify.com/en/general/abuse/) before you automate anything. A number that sends spam can be restricted by WhatsApp, and that is outside our control.

## Development

```
npm install
npm run lint
npm test
npm run build
```

Tests use `node-red-node-test-helper` with Jest and a mocked `fetch`: no test talks to the network.

## License

MIT. See [LICENSE](LICENSE).
