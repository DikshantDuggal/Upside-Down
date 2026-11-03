// Thin bootstrap adapter: preserve B's implementation; deliver parent shutdown on Windows.
process.on('message', message => {
  if (message === 'upside-down:shutdown') {
    process.disconnect?.();
    process.emit('SIGTERM');
  }
});
await import('../client-local/src/main.ts');
