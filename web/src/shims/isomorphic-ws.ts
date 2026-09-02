// Browser shim: isomorphic-ws's browser build only has a default export, but
// the indexer provider does `import { WebSocket } from 'isomorphic-ws'`.
// Map both forms onto the native WebSocket.
const impl = globalThis.WebSocket;
export default impl;
export { impl as WebSocket };
