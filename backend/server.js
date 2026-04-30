process.env.TZ = "Asia/Manila";

const express = require("express");
const cors = require("cors");
const axios = require("axios");

const { initDB, Session, Message, UserMemory } = require("./db");
const { pushToQueue } = require("./queue/messageQueue");
const { startQueueWorker } = require("./queue/worker");

const app = express();
const controllers = new Map();

/**
 * ✅ FIX: allow large code/messages safely
 */
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

/**
 * INIT DB + WORKER
 */
initDB().then(() => {
  startQueueWorker(Message);
  console.log("🚀 Queue worker started");
});

/**
 * MEMORY UPSERT
 */
async function upsertMemory(UserMemory, sessionId, key, value) {
  const existing = await UserMemory.findOne({
    where: { sessionId, key },
  });

  if (!existing) {
    await UserMemory.create({ sessionId, key, value });
    return;
  }

  if (existing.value === value) return;

  await existing.update({ value });
}

/**
 * STREAM CHAT
 */
app.post("/chat-stream", async (req, res) => {
  let { message, sessionId } = req.body;

  const controller = new AbortController();
  controllers.set(sessionId, controller);

  try {
    /**
     * =========================
     * LIMIT USER INPUT SIZE
     * =========================
     */
    const safeMessage =
      message.length > 8000 ? message.slice(0, 8000) : message;

    /**
     * SESSION
     */
    await Session.findOrCreate({
      where: { sessionId },
      defaults: { sessionId },
    });

    /**
     * SAVE USER MESSAGE
     */
    await Message.create({
      sessionId,
      role: "user",
      content: safeMessage,
    });

    /**
     * SHORT HISTORY (LIMITED)
     */
    const history = await Message.findAll({
      where: { sessionId },
      order: [["createdAt", "DESC"]],
      limit: 10,
    });

    const formattedHistory = history
      .reverse()
      .slice(-6) // 🔥 LIMIT CONTEXT
      .map((m) => ({
        role: m.role,
        content: m.content,
      }));

    /**
     * LONG-TERM MEMORY (LIMITED)
     */
    const memories = await UserMemory.findAll({
      where: { sessionId },
    });

    const safeMemory = memories.slice(0, 10);

    const memoryText =
      safeMemory.length > 0
        ? safeMemory.map((m) => `- ${m.key}: ${m.value}`).join("\n")
        : "No stored memory";

    /**
     * SSE HEADERS
     */
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    /**
     * ASSISTANT MESSAGE RECORD
     */
    const assistantMsg = await Message.create({
      sessionId,
      role: "assistant",
      content: "",
    });

    /**
     * CALL LLM
     */
    const response = await axios.post(
      "http://127.0.0.1:4891/v1/chat/completions",
      {
        model: "phi-3-mini-4k-instruct",
        messages: [
          {
            role: "system",
            content: `
You are a helpful assistant.

User long-term memory:
${memoryText}
            `,
          },
          ...formattedHistory,
          { role: "user", content: safeMessage },
        ],
        temperature: 0.3,
        max_tokens: 800,
      },
      {
        signal: controller.signal,
        timeout: 120000, // 🔥 prevent hanging requests
      },
    );

    const text =
      response.data?.choices?.[0]?.message?.content || "No response.";

    /**
     * STREAM OUTPUT
     */
    let fullText = "";
    let buffer = [];

    const flush = () => {
      if (!buffer.length) return;

      const chunk = buffer.join("");
      buffer = [];

      fullText += chunk;
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    };

    for (let i = 0; i < text.length; i++) {
      if (controller.signal.aborted) break;

      buffer.push(text[i]);

      if (buffer.length >= 6) flush();

      await new Promise((r) => setTimeout(r, 5));
    }

    flush();

    /**
     * SAVE ASSISTANT MESSAGE
     */
    await assistantMsg.update({
      content: fullText,
    });

    pushToQueue({
      sessionId,
      role: "assistant",
      content: fullText,
    });

    /**
     * MEMORY EXTRACTION
     */
    try {
      const memoryRes = await axios.post(
        "http://127.0.0.1:4891/v1/chat/completions",
        {
          model: "phi-3-mini-4k-instruct",
          messages: [
            {
              role: "system",
              content: `
Extract only long-term user facts.

Return ONLY valid JSON:
{
  "memory": [
    { "key": "string", "value": "string" }
  ]
}

Rules:
- Only store stable facts
- Avoid duplicates
- If nothing useful, return {"memory": []}
              `,
            },
            { role: "user", content: safeMessage },
          ],
          temperature: 0.1,
          max_tokens: 300,
        },
      );

      let raw = memoryRes.data?.choices?.[0]?.message?.content || "";

      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = { memory: [] };
      }

      if (Array.isArray(parsed.memory)) {
        for (const m of parsed.memory) {
          if (!m.key || !m.value) continue;

          await upsertMemory(
            UserMemory,
            sessionId,
            m.key.trim().toLowerCase(),
            m.value.trim(),
          );
        }
      }
    } catch (e) {
      console.log("memory extraction failed:", e.message);
    }

    /**
     * END STREAM
     */
    res.write(`data: ${JSON.stringify("[DONE]")}\n\n`);
    res.end();

    controllers.delete(sessionId);
  } catch (err) {
    /**
     * 🔥 REAL ERROR LOGGING (IMPORTANT)
     */
    console.error("❌ ERROR:", err.response?.data || err.message);

    try {
      res.write(`data: ${JSON.stringify("ERROR: " + err.message)}\n\n`);
      res.write(`data: ${JSON.stringify("[DONE]")}\n\n`);
      res.end();
    } catch {}

    controllers.delete(sessionId);
  }
});

/**
 * HISTORY API
 */
app.get("/history/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;

    const messages = await Message.findAll({
      where: { sessionId },
      order: [["createdAt", "ASC"]],
    });

    res.json(messages);
  } catch (err) {
    console.error("❌ HISTORY ERROR:", err.message);
    res.status(500).json([]);
  }
});

/**
 * CANCEL STREAM
 */
app.post("/cancel", (req, res) => {
  const { sessionId } = req.body;

  const controller = controllers.get(sessionId);

  if (controller) {
    controller.abort();
    controllers.delete(sessionId);
  }

  res.send("cancelled");
});

/**
 * START SERVER
 */
app.listen(5000, () => {
  console.log("🚀 Server running on http://localhost:5000");
});
