import readline from "node:readline";

function shouldMaskChunk(chunk) {
  if (typeof chunk !== "string" || chunk.length === 0) {
    return false;
  }

  if (chunk.includes("\n") || chunk.includes("\r") || chunk.includes("\u001b")) {
    return false;
  }

  return /[\x20-\x7e]/.test(chunk);
}

function prompt(question, { silent = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true
    });

    if (!silent) {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer);
      });
      return;
    }

    const output = rl.output;
    const originalWrite = output.write.bind(output);
    let hasShownPrompt = false;
    output.write = (chunk, encoding, callback) => {
      if (rl.stdoutMuted && hasShownPrompt && shouldMaskChunk(chunk)) {
        return originalWrite("*".repeat(chunk.length), encoding, callback);
      }

      if (chunk === question) {
        hasShownPrompt = true;
      }

      return originalWrite(chunk, encoding, callback);
    };

    rl.stdoutMuted = true;
    rl.question(question, (answer) => {
      output.write = originalWrite;
      rl.close();
      output.write("\n");
      resolve(answer);
    });
  });
}

export {
  prompt
};
