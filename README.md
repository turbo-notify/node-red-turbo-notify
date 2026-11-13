# WhatsApp for Node-RED, with Turbo Notify

Send WhatsApp messages from your own number, and start a flow when a message arrives, with [Turbo Notify](https://turbonotify.com). Text, pictures, documents, locations and replies, plus eighteen example flows you can import and run: alerts, an order confirmation, a menu bot, an after-hours reply, a website monitor and more.

**From your own number.** Messages leave from the WhatsApp number you link to your Turbo Notify account, not from a shared bot or a demo account.

```
[ sensor ] --> [ whatsapp send ] --> [ debug ]

[ whatsapp events ] --> [ your logic ] --> [ whatsapp send ]
```

## Get started in five minutes

You need a Turbo Notify account, your WhatsApp number linked to it and an API key. All three are made in the [Turbo Notify dashboard](https://dashboard.turbonotify.com); the [quickstart](https://docs.turbonotify.com/en/guides/quickstart/) shows each screen.

1. **Create an account** (it is free) or sign in, at [dashboard.turbonotify.com](https://dashboard.turbonotify.com/auth/signup?locale=en). Pick a plan that covers the messages you send.
2. **Link your WhatsApp number.** Open **Numbers**, click **Connect main number**, choose **QR code** or **Pairing code** and follow the steps on your phone, in WhatsApp under Linked devices (the same way you link WhatsApp Web). Your phone keeps working as usual.
3. **Create an API key.** Open **API keys** and create one with the **AI agent (MCP)** template, which has the scopes the nodes use: `messages:send` to send, `messages:read` for the status of a message, `events:read` for incoming messages and `numbers:read`, which lets **Test** check that your number is linked. Copy it, it is shown only once.
4. **Install the nodes.** In Node-RED, open the menu, choose **Manage palette**, then **Install**, and search for `@turbo-notify/node-red-whatsapp` (or just `whatsapp`). Or, from your Node-RED user directory (usually `~/.node-red`): `npm install @turbo-notify/node-red-whatsapp`, then restart Node-RED. Needs Node-RED 3.0.0 or later and Node.js 18 or later. The nodes appear in the **Turbo Notify** category of the palette.
5. **Send your first message.** Drag a **whatsapp send** node into a flow and double-click it. Next to **Account**, click the **+**, paste the key and press **Test**. It tells you in plain words whether the key works and whether your number is linked. Click **Add**, put your own phone number in **To**, in international format (`+12025550123`), wire an **inject** node with a text payload to it and deploy. Press the inject button: the node accepts the message at once and WhatsApp delivers it a moment later.

The key is kept in the Node-RED credentials store, so it never appears in the flow file or in an exported flow. If you deploy before pasting a key, the node shows a yellow **paste your API key** instead of failing on the first message.

**Coming from `@turbo-notify/node-red-turbo-notify`?** That package (0.1.x) is replaced by this one. The node types did not change, so your flows keep working: uninstall the old package, install this one and restart.

## Nodes

| Node | What it does |
|---|---|
| **Turbo Notify account** (config) | Holds your API key. Its **Test** button checks that the key works and that your WhatsApp number is linked, and says what to do if not. |
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

Takes `msg.messageId` (set by **whatsapp send**), and returns the status of the message on `msg.payload`: `msg.payload.status.state` is `pending`, `sent`, `delivered`, `read` or `failed`, and `msg.payload.status.error` says why when it failed. Ids belong to one number, so use the same number the message was sent from.

### whatsapp events

Options: the event types to listen to (default `message.received`; a message that quotes another one arrives as `message.replied`, so write `message.received,message.replied` to get both; empty means every event), the number (empty means all of them) and the interval in seconds (default 30, minimum 10).

It emits one message per event, oldest first. `msg.payload` is the whole event (`id`, `type`, `number_alias`, `number_id`, `created_at`, `data`) and `msg.topic` is the event type.

## Errors

When the API refuses a call, the node shows the API error code in its status (a red ring) and raises an error whose message is that code, for example `insufficient_scope`. A **Catch** node receives it:

- `msg.error.message`: the error code.
- `msg.errorDescription` (and `msg.error.cause.description` on Node-RED 4 and later): what it means and what to do.
- `msg.error.cause.status`, `msg.error.cause.requiredScope` (for `insufficient_scope`) and `msg.error.cause.retryAfter` (seconds, for a `429`) when the API gives them.

## Examples

Import them from the menu: **Import**, then **Examples**, then **@turbo-notify/node-red-whatsapp**. Each flow starts with a **START HERE** note that says what to change (the key, the scopes, the number).

| Example | What it does |
|---|---|
| `door-sensor-to-whatsapp` | An alert text when a sensor reports an event, then a check of its delivery status. |
| `camera-picture-to-whatsapp` | A picture from a camera snapshot address, with a caption. |
| `daily-whatsapp-report-to-a-list` | A report sent every morning to several people, one message every 10 seconds. |
| `whatsapp-reminder-on-weekdays` | A reminder on weekdays at 09:00. |
| `temperature-alert-on-whatsapp` | One message when a temperature goes above a limit and one when it is back to normal, never a flood. |
| `website-down-alert-on-whatsapp` | Checks an address every 5 minutes: one message when it goes down, one when it recovers. |
| `node-red-error-alert-on-whatsapp` | A message when a node on the tab fails, at most one every 10 seconds. |
| `daily-weather-forecast-on-whatsapp` | Today's forecast every morning from the free Open-Meteo service (no key). |
| `send-a-pdf-on-whatsapp` | Sends a document, such as an invoice, with a caption. |
| `confirm-whatsapp-delivery-or-alert` | Sends a message, checks its status 30 seconds later and warns you if it failed. |
| `http-endpoint-to-whatsapp` | `POST /whatsapp/alert` sends a message: any system that can make an HTTP call can use your number. It refuses every call (503) until you set a token of at least 16 characters in the tab variable `ALERT_TOKEN`. |
| `whatsapp-order-confirmation` | `POST /whatsapp/orders` confirms an order to the customer with a written summary. |
| `reply-to-an-incoming-whatsapp-message` | Answers a private message that arrives, at most once an hour for each person, using the events node. |
| `whatsapp-menu-by-keyword` | Answers 1, 2 or 3 (or the words hours, address, person) with the right text, and the menu for anything else. |
| `whatsapp-after-hours-auto-reply` | Tells people you are closed outside your opening hours, once every 12 hours per person. |
| `incoming-whatsapp-messages-to-a-team-group` | Forwards the private messages you receive to a WhatsApp group of your team (at most 5 an hour from one person and 20 in all). |
| `share-your-store-location-on-whatsapp` | Sends a map location when someone asks where you are. |
| `log-incoming-whatsapp-messages-to-a-file` | Keeps a CSV record of every message you receive. |

The examples that send to a fixed person use the placeholder number `+12025550123`: replace it before you deploy. The flows that answer people reply to whoever wrote, so they have no number; the team group flow has a placeholder group id to replace. The flows that read messages use the events node, which checks every 30 seconds, and its first check after a deploy only remembers the newest message: to test, deploy, write to your number from another phone and wait up to 30 seconds.

## Limits worth knowing

- **Sending pace.** Your number sends one message at a time, a few seconds apart (a longer text takes longer). A flow that sends a burst queues the messages, and a message that waits more than 5 minutes fails with `message_timeout` (it may still arrive). Separately, a send that comes sooner than the minimum gap of the plan (6 seconds on Free) is refused with `429 send_rate_spacing` and a `Retry-After` time, and the node raises that error. When a flow sends a list, put a **delay** node set to rate limit (one message every 10 seconds) in front of **whatsapp send**, as in the `daily-whatsapp-report-to-a-list` example, or split the list over several runs.
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

- **The key goes only to Turbo Notify.** The nodes always talk to `https://api.turbonotify.com`, and the address is not a setting of a flow, so a flow you import or share can never choose where your key goes.

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

To try the nodes in a real editor without an account, run `npm run editor`. It starts Node-RED with this package installed and a stand-in for the API, and prints the keys to paste (`tn_live_good_connected` works, `tn_live_good_nonumber` works but has no number linked, `tn_live_noscope` passes the account check but is refused for numbers and sends, anything else is refused). To point the nodes at another address on purpose (a test double or a staging copy), set `turboNotifyBaseUrl` in the `settings.js` of that Node-RED: only the administrator can, and it must be https or an address on the same computer.

## License

MIT. See [LICENSE](LICENSE).
