
"use strict";

const { Events } = require("discord.js");

const {
  createAiProvider
} = require("../systems/ai/provider");

const {
  createAiMentionHandler
} = require("../systems/ai/mentionHandler");

// ========================================
// GEMINI CONFIGURATION
// ========================================

const GEMINI_MODEL =
  process.env.GEMINI_MODEL ||
  "gemini-3.5-flash-lite";

const GEMINI_ENDPOINT =
  `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`;

// ========================================
// GEMINI API CONNECTION
// ========================================

async function generateGeminiText(request) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is missing in Render."
    );
  }

  const body = {
    systemInstruction: {
      parts: [
        {
          text: request.systemInstruction
        }
      ]
    },

    contents: [
      {
        role: "user",
        parts: [
          {
            text: request.userMessage
          }
        ]
      }
    ],

    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: Math.max(
        1000,
        request.maxOutputTokens || 550
      ),
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          inScope: {
            type: "BOOLEAN"
          },
          reply: {
            type: "STRING"
          }
        },
        required: ["inScope", "reply"]
      }
    }
  };

  const response = await fetch(
    GEMINI_ENDPOINT,
    {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },

      body: JSON.stringify(body),

      signal: AbortSignal.timeout(30000)
    }
  );

  if (!response.ok) {
    throw new Error(
      `Gemini API returned HTTP ${response.status}`
    );
  }

  const data = await response.json();

  const parts =
    data?.candidates?.[0]?.content?.parts || [];

  const text = parts
    .filter(part => typeof part.text === "string")
    .map(part => part.text)
    .join("")
    .trim();

  if (!text) {
    throw new Error(
      "Gemini returned an empty response."
    );
  }

  return text;
}

// ========================================
// CONNECT GEMINI TO AI PROVIDER
// ========================================

const aiProvider = createAiProvider({
  generateText: generateGeminiText,

  // Don't disguise API failures as AI answers
  useOfflineFallback: false
});

// ========================================
// CONNECT AI TO TICKET MENTIONS
// ========================================

const handleAiMention =
  createAiMentionHandler({
    generateReply: aiProvider.generateReply
  });

// ========================================
// DISCORD MESSAGE EVENT
// ========================================

module.exports = {
  name: Events.MessageCreate,

  async execute(message) {
    if (!message.inGuild()) return;

    if (message.author.bot) return;

    if (message.webhookId) return;

    const botId = message.client.user?.id;

    if (!botId) return;

    // AI only responds when mentioned
    if (!message.mentions.users.has(botId)) {
      return;
    }

    try {
      await handleAiMention(message);
    } catch (error) {
      console.error(
        "[ItamaRos AI] Message handler error:",
        error.message
      );
    }
  }
};
