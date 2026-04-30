import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { FiSend, FiX } from "react-icons/fi";
import { FiMic } from "react-icons/fi";

type ChatMessage = {
  user: string;
  ai: string;
  status: "thinking" | "streaming" | "done";
};

// simple send icon (no dependencies)
const SendIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    className="w-4 h-4"
  >
    <path d="M2 21l21-9L2 3v7l15 2-15 2v7z" />
  </svg>
);

function App() {
  const [message, setMessage] = useState("");
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);

  const [sessionId] = useState(() =>
    crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(),
  );
  const abortRef = useRef<AbortController | null>(null);

  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // for theme
  const [theme, setTheme] = useState<"dark" | "light">(
    () => (localStorage.getItem("theme") as any) || "dark",
  );

  useEffect(() => {
    localStorage.setItem("theme", theme);

    document.body.style.backgroundColor =
      theme === "dark" ? "#131313" : "#FAFAFA";

    document.body.style.color = theme === "dark" ? "#FFFFFF" : "#131313";
  }, [theme]);

  useEffect(() => {
    const saved = localStorage.getItem("chat");
    if (saved) setChat(JSON.parse(saved));
  }, []);

  useEffect(() => {
    localStorage.setItem("chat", JSON.stringify(chat));
  }, [chat]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat]);

  const ThinkingDots = () => (
    <div className="flex gap-1 items-center py-1">
      <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
      <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:0.15s]" />
      <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:0.3s]" />
    </div>
  );

  const autoResize = () => {
    const el = textareaRef.current;
    if (!el) return;

    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 400) + "px";
  };

  const sendMessage = async () => {
    if (!message.trim() || loading) return;

    const userMsg = message;
    setMessage("");
    setLoading(true);

    const controller = new AbortController();
    abortRef.current = controller;

    setChat((prev) => [
      ...prev,
      {
        user: userMsg,
        ai: "",
        status: "thinking",
      },
    ]);

    try {
      const res = await fetch("http://localhost:5000/chat-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMsg,
          sessionId,
        }),
        signal: controller.signal,
      });

      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      let buffer = "";
      let fullText = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data:")) continue;

          const raw = line.replace("data:", "").trim();
          if (!raw) continue;

          const token = JSON.parse(raw);

          if (token === "[DONE]") {
            setChat((prev) => {
              const copy = [...prev];
              copy[copy.length - 1].status = "done";
              return copy;
            });

            setLoading(false);
            reader.cancel(); // 🚀 force stop stream
            break; // 🚀 exit loop immediately
          }

          fullText += token;

          setChat((prev) => {
            const copy = [...prev];
            copy[copy.length - 1] = {
              ...copy[copy.length - 1],
              ai: fullText,
              status: "streaming",
            };
            return copy;
          });
        }
      }

      setChat((prev) => {
        const copy = [...prev];
        if (copy.length > 0) {
          copy[copy.length - 1].ai = fullText;
          copy[copy.length - 1].status = "done";
        }
        return copy;
      });
    } catch (err) {
      console.log("error:", err);

      setChat((prev) => {
        const copy = [...prev];
        if (copy.length > 0) {
          copy[copy.length - 1].ai = "Error generating response.";
          copy[copy.length - 1].status = "done";
        }
        return copy;
      });
    } finally {
      setLoading(false);
    }
  };

  const startVoice = () => {
    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert("Speech Recognition not supported");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";

    recognition.onresult = (e: any) => {
      const text = e.results[0][0].transcript;
      setMessage((prev) => prev + " " + text);
      setTimeout(autoResize, 50);
    };

    recognition.start();
  };

  const cancelGeneration = async () => {
    abortRef.current?.abort();

    await fetch("http://localhost:5000/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    });

    setLoading(false);
  };

  const markdownComponents: Components = {
    code(props) {
      const { children, className, ...rest } = props;
      const isInline = !className;

      return isInline ? (
        <code className="bg-gray-700 px-1 py-0.5 rounded text-sm" {...rest}>
          {children}
        </code>
      ) : (
        <pre className="bg-black/40 p-3 rounded-xl overflow-x-auto text-sm">
          <code>{children}</code>
        </pre>
      );
    },
  };

  const loadHistory = async () => {
    try {
      const res = await fetch(`http://localhost:5000/history/${sessionId}`);

      const data = await res.json();

      const formatted: ChatMessage[] = [];

      for (let i = 0; i < data.length; i += 2) {
        const user = data[i];
        const ai = data[i + 1];

        if (user) {
          formatted.push({
            user: user.content,
            ai: ai?.content || "",
            status: "done",
          });
        }
      }

      setChat(formatted);
    } catch (err) {
      console.log("history error", err);
    }
  };

  useEffect(() => {
    loadHistory();
  }, []);

  return (
    <div className="flex flex-col h-screen transition-colors duration-200">
      {/* HEADER */}
      <div className="p-4 border-b border-gray-800 flex items-center justify-between">
        <span className="font-semibold">Local AI Assistant</span>

        <button
          onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
          className="px-3 py-1 rounded-lg text-sm border border-gray-500"
        >
          {theme === "dark" ? "🌙 Dark" : "☀️ Light"}
        </button>
      </div>

      {/* CHAT */}
      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        {chat.map((c, i) => (
          <div key={i} className="space-y-3">
            <div className="flex justify-end">
              <div
                className="px-4 py-3 rounded-2xl max-w-[80%] whitespace-pre-wrap leading-relaxed"
                style={{
                  backgroundColor: theme === "dark" ? "#1f1f1f" : "#ffffff",
                  color: theme === "dark" ? "#fff" : "#131313",
                  border: theme === "light" ? "1px solid #e5e5e5" : "none",
                }}
              >
                {c.user}
              </div>
            </div>

            <div className="flex justify-start">
              <div
                className="px-4 py-3 rounded-2xl max-w-[80%] whitespace-pre-wrap leading-relaxed"
                style={{
                  backgroundColor: theme === "dark" ? "#1f1f1f" : "#ffffff",
                  color: theme === "dark" ? "#fff" : "#131313",
                  border: theme === "light" ? "1px solid #e5e5e5" : "none",
                }}
              >
                {c.status === "thinking" && <ThinkingDots />}

                {c.status !== "thinking" && (
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={markdownComponents}
                  >
                    {c.ai}
                  </ReactMarkdown>
                )}
              </div>
            </div>
          </div>
        ))}

        <div ref={chatEndRef} />
      </div>

      {/* INPUT */}
      <div className="p-4 border-t border-gray-800 flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => {
            setMessage(e.target.value);
            autoResize();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              sendMessage();
            }
          }}
          placeholder="Message AI..."
          disabled={loading}
          className="flex-1 p-3 rounded-xl border outline-none resize-none max-h-[400px]"
          style={{
            backgroundColor: theme === "dark" ? "#1f1f1f" : "#ffffff",
            color: theme === "dark" ? "#fff" : "#131313",
            borderColor: theme === "dark" ? "#333" : "#ddd",
          }}
        />

        <button
          onClick={startVoice}
          className="w-10 h-10 rounded-xl bg-gray-800 hover:bg-gray-700"
        >
          <FiMic size={18} />
        </button>

        <button
          onClick={loading ? cancelGeneration : sendMessage}
          disabled={!loading && (!message.trim() || loading)}
          className={`w-10 h-10 rounded-xl flex items-center justify-center transition ${
            !loading && !message.trim()
              ? "bg-gray-700 opacity-50 cursor-not-allowed"
              : loading
                ? "bg-red-600 hover:bg-red-700"
                : "bg-blue-600 hover:bg-blue-700"
          }`}
        >
          {loading ? <FiX size={16} /> : <FiSend size={16} />}
        </button>
      </div>
    </div>
  );
}

export default App;
