const messageQueue = [];
const MAX_QUEUE_SIZE = 5000;

/**
 * Push item safely into queue
 */
function pushToQueue(item) {
  if (messageQueue.length >= MAX_QUEUE_SIZE) {
    console.warn("⚠️ Queue full, dropping item");
    return;
  }

  messageQueue.push(item);
}

/**
 * Flush queue in batches
 */
async function flushQueue(Message) {
  if (messageQueue.length === 0) return;

  const batch = messageQueue.splice(0, messageQueue.length);

  try {
    await Message.bulkCreate(batch);
  } catch (err) {
    console.error("QUEUE FLUSH ERROR:", err.message);
  }
}

module.exports = {
  pushToQueue,
  flushQueue,
  messageQueue,
};
