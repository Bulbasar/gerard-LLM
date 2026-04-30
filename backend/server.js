const express = require("express");
const cors = require("cors");
const axios = require("axios");

const { initDB, Session, Message } = require("./db");

const app = express();
app.use(cors());
app.use(express.json());

const controllers = new Map();

// 🚀 INIT DB
initDB();

/**
 * STREAM CHAT + SAVE TO DB
 */
app.post("/chat-stream", async (req, res) => {
  const { message, sessionId } = req.body;

  try {
    await Session.findOrCreate({
      where: { sessionId },
      defaults: { sessionId },
    });

    await Message.create({
      sessionId,
      role: "user",
      content: message,
    });

    // SSE HEADERS
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    // AI CALL
    const response = await axios.post(
      "http://127.0.0.1:4891/v1/chat/completions",
      {
        model: "phi-3-mini",
        messages: [
          {
            role: "system",
            content:
              "You are a helpful assistant. Always respond clearly and fully.",
          },
          { role: "user", content: message },
        ],
        temperature: 0.3,
        max_tokens: 2048,
        stream: false,
      },
    );

    let aiText = response.data?.choices?.[0]?.message?.content || "";

    if (!aiText) throw new Error("Empty AI response");

    // DO NOT destroy spacing
    aiText = aiText.trim();

    // WORD-BASED STREAMING (BEST UX)
    const tokens = aiText.split(/(\s+)/); // keeps spaces

    let fullText = "";

    for (const token of tokens) {
      fullText += token;

      res.write(`data: ${JSON.stringify(token)}\n\n`);

      await new Promise((r) => setTimeout(r, 8));
    }

    await Message.create({
      sessionId,
      role: "assistant",
      content: fullText,
    });

    // safe done signal
    res.write(`data: ${JSON.stringify("[DONE]")}\n\n`);
    res.end();
  } catch (err) {
    console.error(err);

    res.write(`data: ${JSON.stringify("ERROR: " + err.message)}\n\n`);
    res.write(`data: ${JSON.stringify("[DONE]")}\n\n`);
    res.end();
  }
});

/**
 * HISTORY API (USED BY YOUR FRONTEND)
 */
app.get("/history/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;

    console.log("📜 Loading history:", sessionId);

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

  console.log("🛑 Cancel:", sessionId);

  const controller = controllers.get(sessionId);

  if (controller) {
    controller.abort();
    controllers.delete(sessionId);
  }

  res.send("cancelled");
});

app.listen(5000, () => {
  console.log("🚀 Server running on http://localhost:5000");
});
