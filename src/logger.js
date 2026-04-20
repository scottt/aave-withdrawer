function timestamp() {
  return new Date().toISOString();
}

function write(stream, message) {
  stream.write(`[${timestamp()}] ${message}\n`);
}

export const logger = {
  info(message) {
    write(process.stdout, message);
  },
  error(message) {
    write(process.stderr, message);
  }
};
