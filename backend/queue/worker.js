const { flushQueue, messageQueue } = require("./messageQueue");

/**
 * Simple interval worker (stable + low CPU)
 */
function startQueueWorker(Message) {
  setInterval(async () => {
    if (messageQueue.length > 0) {
      await flushQueue(Message);
    }
  }, 300);
}

module.exports = { startQueueWorker };
