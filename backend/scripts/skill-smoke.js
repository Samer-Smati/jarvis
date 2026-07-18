/* One-shot smoke test: sends a message through the WebSocket and prints events. */
const { io } = require('socket.io-client');

const message = process.argv.slice(2).join(' ') || 'What is the weather in Tunis right now?';
const socket = io('http://localhost:3000', { transports: ['websocket'] });

const timeout = setTimeout(() => {
  console.error('\n[TIMEOUT after 240s]');
  process.exit(1);
}, 240000);

socket.on('connect', () => {
  console.log(`[connected] sending: ${message}`);
  socket.emit('user_message', { conversationId: 'smoke-' + Date.now(), text: message });
});

socket.on('token', () => process.stdout.write('.'));
socket.on('tool_start', (e) => console.log(`\n[tool_start] ${e.toolName} ${JSON.stringify(e.args)}`));
socket.on('tool_end', (e) => console.log(`[tool_end] ${e.toolName} ok=${e.success}\n${e.output}`));
socket.on('done', (e) => {
  console.log(`\n[done] ${e.finalText}`);
  clearTimeout(timeout);
  process.exit(0);
});
socket.on('agent_error', (e) => {
  console.error(`\n[error] ${JSON.stringify(e)}`);
  clearTimeout(timeout);
  process.exit(1);
});
