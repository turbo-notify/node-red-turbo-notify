# This package was renamed

The Turbo Notify nodes for Node-RED are now published as **`@turbo-notify/node-red-whatsapp`**.

This package has no nodes of its own. Installing it installs the new package for you, and the node types did not change, so a flow made with the first package keeps working.

## Move to the new name

In your Node-RED user directory (usually `~/.node-red`):

```
npm uninstall @turbo-notify/node-red-turbo-notify
npm install @turbo-notify/node-red-whatsapp
```

Restart Node-RED. Or, in Node-RED, open **Manage palette**, remove this package and install `@turbo-notify/node-red-whatsapp`.

## Why

The new name says what the nodes do, so people who search for a WhatsApp node for Node-RED find them. It also has eighteen ready-to-import example flows.

- New package: https://www.npmjs.com/package/@turbo-notify/node-red-whatsapp
- Documentation: https://docs.turbonotify.com/en/platforms/node-red/
- Source: https://github.com/turbo-notify/node-red-turbo-notify

MIT. See [LICENSE](LICENSE).
