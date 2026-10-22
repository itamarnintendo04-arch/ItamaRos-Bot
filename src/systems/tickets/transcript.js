
"use strict";

const { AttachmentBuilder } = require("discord.js");

// ==================================================
// ITAMAROS BOT • HTML TICKET TRANSCRIPT 3.0
// ==================================================

const SETTINGS = Object.freeze({
    FETCH_LIMIT: 100,
    MAX_MESSAGES: 20000,
    MAX_FILE_BYTES: 8 * 1024 * 1024
});

// ==================================================
// SECURITY HELPERS
// ==================================================

function escapeHTML(value) {
    return String(value ?? "").replace(
        /[&<>"']/g,
        character => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        })[character]
    );
}

function safeURL(value) {
    try {
        const url = new URL(String(value));

        if (
            url.protocol !== "https:" &&
            url.protocol !== "http:"
        ) {
            return null;
        }

        return escapeHTML(url.href);
    } catch {
        return null;
    }
}

function formatDate(value) {
    if (!value) return "Unknown";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return "Unknown";
    }

    return date.toISOString().replace("T", " ").slice(0, 19) +
        " UTC";
}

function safeFileName(value) {
    const safe = String(value || "unknown")
        .replace(/[^a-zA-Z0-9_-]/g, "-")
        .slice(0, 70);

    return safe || "unknown";
}

function renderText(value) {
    return escapeHTML(value);
}

// ==================================================
// FETCH MESSAGE HISTORY
// ==================================================

async function fetchAllMessages(channel) {
    const messages = [];
    let before;

    while (true) {
        const options = {
            limit: SETTINGS.FETCH_LIMIT
        };

        if (before) {
            options.before = before;
        }

        const batch = await channel.messages.fetch(options);

        if (!batch.size) {
            break;
        }

        messages.push(...batch.values());

        const lastMessage = batch.last();

        if (!lastMessage) {
            break;
        }

        before = lastMessage.id;

        // Never silently generate a partial transcript.
        // A partial transcript must not be used to
        // authorize deletion of the original channel.
        if (messages.length > SETTINGS.MAX_MESSAGES) {
            throw new Error(
                "TRANSCRIPT_MESSAGE_LIMIT_EXCEEDED"
            );
        }

        if (batch.size < SETTINGS.FETCH_LIMIT) {
            break;
        }
    }

    return messages.reverse();
}

// ==================================================
// EMBED RENDERING
// ==================================================

function renderEmbed(embed) {
    const parts = [];

    if (embed.author?.name) {
        parts.push(
            `<div class="embed-author">${
                renderText(embed.author.name)
            }</div>`
        );
    }

    if (embed.title) {
        parts.push(
            `<div class="embed-title">${
                renderText(embed.title)
            }</div>`
        );
    }

    if (embed.description) {
        parts.push(
            `<div class="embed-description">${
                renderText(embed.description)
            }</div>`
        );
    }

    if (Array.isArray(embed.fields)) {
        for (const field of embed.fields) {
            parts.push(`
                <div class="embed-field">
                    <strong>${renderText(field.name)}</strong>
                    <div>${renderText(field.value)}</div>
                </div>
            `);
        }
    }

    if (embed.footer?.text) {
        parts.push(
            `<div class="embed-footer">${
                renderText(embed.footer.text)
            }</div>`
        );
    }

    if (embed.timestamp) {
        parts.push(
            `<div class="embed-footer">${
                formatDate(embed.timestamp)
            }</div>`
        );
    }

    if (!parts.length) {
        return "";
    }

    return `
        <div class="embed">
            ${parts.join("\n")}
        </div>
    `;
}

// ==================================================
// ATTACHMENT RENDERING
// ==================================================

function renderAttachment(attachment) {
    const name = renderText(
        attachment.name || "Unnamed attachment"
    );

    const url = safeURL(attachment.url);

    const size = Number.isFinite(attachment.size)
        ? `${Math.round(attachment.size / 1024)} KB`
        : "Unknown size";

    if (!url) {
        return `
            <div class="attachment">
                📎 ${name} (${size})
            </div>
        `;
    }

    return `
        <div class="attachment">
            📎
            <a
                href="${url}"
                target="_blank"
                rel="noopener noreferrer"
            >${name}</a>
            <span class="muted">(${size})</span>
        </div>
    `;
}

// ==================================================
// MESSAGE RENDERING
// ==================================================

function renderMessage(message) {
    const author = message.author;

    const username =
        author?.globalName ||
        author?.username ||
        author?.tag ||
        "Unknown User";

    const authorId = author?.id || "Unknown";

    const initials = String(username)
        .slice(0, 2)
        .toUpperCase();

    const content = message.content
        ? `<div class="message-text">${
            renderText(message.content)
        }</div>`
        : "";

    const embeds = (message.embeds || [])
        .map(renderEmbed)
        .join("\n");

    const attachments = [
        ...message.attachments.values()
    ]
        .map(renderAttachment)
        .join("\n");

    const stickers = [
        ...(message.stickers?.values() || [])
    ]
        .map(sticker => `
            <div class="sticker">
                🎨 Sticker: ${renderText(sticker.name)}
            </div>
        `)
        .join("\n");

    const botBadge = author?.bot
        ? `<span class="bot-badge">BOT</span>`
        : "";

    const edited = message.editedAt
        ? `<span class="muted">(edited)</span>`
        : "";

    return `
        <article class="message">
            <div class="avatar">
                ${renderText(initials)}
            </div>

            <div class="message-body">
                <div class="message-header">
                    <strong>${renderText(username)}</strong>
                    ${botBadge}
                    <time>${formatDate(message.createdAt)}</time>
                    ${edited}
                </div>

                <div class="user-id">
                    User ID: ${renderText(authorId)}
                </div>

                ${content}
                ${embeds}
                ${attachments}
                ${stickers}
            </div>
        </article>
    `;
}

// ==================================================
// HTML DOCUMENT
// ==================================================

function buildHTML(channel, ticket, messages) {
    const sessionId = renderText(
        ticket.sessionId || ticket._id || "Unknown"
    );

    const username = renderText(
        ticket.username || ticket.userId
    );

    const type = renderText(
        ticket.typeLabel || ticket.type || "Unknown"
    );

    const messageHTML = messages.length
        ? messages.map(renderMessage).join("\n")
        : `<div class="empty">No messages found.</div>`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport"
      content="width=device-width, initial-scale=1.0">
<meta name="referrer" content="no-referrer">

<meta
    http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; img-src 'none'"
>

<title>ItamaRos Ticket Transcript</title>

<style>
* {
    box-sizing: border-box;
}

body {
    margin: 0;
    padding: 32px 16px;
    background: #1e1f22;
    color: #f2f3f5;
    font-family: Arial, Helvetica, sans-serif;
    line-height: 1.55;
}

.container {
    max-width: 960px;
    margin: 0 auto;
}

.header {
    padding: 28px;
    border-radius: 16px;
    background: #2b2d31;
    margin-bottom: 22px;
    border: 1px solid #41434a;
}

h1 {
    margin: 0 0 10px;
    color: #a5b4fc;
    font-size: 28px;
}

.subtitle {
    color: #b5bac1;
}

.metadata {
    display: grid;
    grid-template-columns: repeat(
        auto-fit,
        minmax(220px, 1fr)
    );
    gap: 12px;
    margin-top: 22px;
}

.metadata-item {
    border-radius: 10px;
    background: #232428;
    padding: 12px;
    overflow-wrap: anywhere;
}

.metadata-label {
    display: block;
    color: #949ba4;
    font-size: 12px;
    margin-bottom: 4px;
}

.messages {
    border-radius: 16px;
    background: #2b2d31;
    border: 1px solid #41434a;
    overflow: hidden;
}

.message {
    display: flex;
    align-items: flex-start;
    gap: 14px;
    padding: 18px;
    border-bottom: 1px solid #3f4147;
}

.message:last-child {
    border-bottom: none;
}

.avatar {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 42px;
    height: 42px;
    flex-shrink: 0;
    border-radius: 50%;
    background: #5865f2;
    color: #ffffff;
    font-size: 14px;
    font-weight: bold;
}

.message-body {
    min-width: 0;
    flex: 1;
}

.message-header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
}

.message-header time,
.muted {
    font-size: 12px;
    color: #949ba4;
}

.user-id {
    color: #949ba4;
    font-size: 11px;
    margin-top: 2px;
    margin-bottom: 8px;
}

.message-text,
.embed-description,
.embed-field div {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
}

.bot-badge {
    border-radius: 4px;
    padding: 2px 5px;
    background: #5865f2;
    color: white;
    font-size: 10px;
    font-weight: bold;
}

.embed {
    background: #232428;
    border-left: 4px solid #5865f2;
    border-radius: 5px;
    padding: 14px;
    margin-top: 10px;
}

.embed-author {
    font-size: 12px;
    font-weight: bold;
}

.embed-title {
    font-weight: bold;
    margin-top: 5px;
}

.embed-description {
    margin-top: 7px;
}

.embed-field {
    margin-top: 10px;
}

.embed-footer {
    margin-top: 12px;
    color: #949ba4;
    font-size: 11px;
}

.attachment,
.sticker {
    margin-top: 10px;
    padding: 10px;
    background: #232428;
    border-radius: 8px;
    overflow-wrap: anywhere;
}

a {
    color: #66c0ff;
}

a:hover {
    text-decoration: underline;
}

.empty {
    padding: 25px;
    color: #949ba4;
}

.footer {
    margin-top: 22px;
    text-align: center;
    color: #949ba4;
    font-size: 12px;
}

@media (max-width: 600px) {
    body {
        padding: 12px;
    }

    .header {
        padding: 18px;
    }

    .message {
        padding: 12px;
        gap: 10px;
    }
}
</style>
</head>

<body>
<div class="container">
    <header class="header">
        <h1>🎫 ItamaRos Ticket Transcript</h1>

        <div class="subtitle">
            Private support conversation archive
        </div>

        <div class="metadata">
            <div class="metadata-item">
                <span class="metadata-label">Ticket Owner</span>
                ${username}
            </div>

            <div class="metadata-item">
                <span class="metadata-label">Ticket Owner ID</span>
                ${renderText(ticket.userId)}
            </div>

            <div class="metadata-item">
                <span class="metadata-label">Ticket Type</span>
                ${type}
            </div>

            <div class="metadata-item">
                <span class="metadata-label">Channel</span>
                ${renderText(channel.name)}
            </div>

            <div class="metadata-item">
                <span class="metadata-label">Channel ID</span>
                ${renderText(channel.id)}
            </div>

            <div class="metadata-item">
                <span class="metadata-label">Session ID</span>
                ${sessionId}
            </div>

            <div class="metadata-item">
                <span class="metadata-label">Generated</span>
                ${formatDate(new Date())}
            </div>

            <div class="metadata-item">
                <span class="metadata-label">Message Count</span>
                ${messages.length}
            </div>
        </div>
    </header>

    <main class="messages">
        ${messageHTML}
    </main>

    <footer class="footer">
        Generated by ItamaRos Bot.
        Keep this transcript private.
    </footer>
</div>
</body>
</html>`;
}

// ==================================================
// MAIN TRANSCRIPT BUILDER
// ==================================================

async function buildTranscript(channel, ticket) {
    try {
        if (
            !channel?.messages ||
            typeof channel.messages.fetch !== "function"
        ) {
            throw new Error("INVALID_TRANSCRIPT_CHANNEL");
        }

        if (!ticket) {
            throw new Error("INVALID_TRANSCRIPT_TICKET");
        }

        const messages = await fetchAllMessages(channel);

        const html = buildHTML(
            channel,
            ticket,
            messages
        );

        const buffer = Buffer.from(html, "utf8");

        if (buffer.length > SETTINGS.MAX_FILE_BYTES) {
            throw new Error(
                "TRANSCRIPT_FILE_TOO_LARGE"
            );
        }

        const sessionId = safeFileName(
            ticket.sessionId || ticket.channelId
        );

        const fileName = `ticket-${sessionId}.html`;

        const transcript = new AttachmentBuilder(
            buffer,
            {
                name: fileName,
                description:
                    "Private ItamaRos support ticket transcript"
            }
        );

        console.log(
            `[Tickets] Transcript generated: ` +
            `${fileName} | ${messages.length} messages | ` +
            `${buffer.length} bytes`
        );

        return transcript;
    } catch (error) {
        console.error(
            "[Tickets] Transcript generation failed:",
            error
        );

        // Existing close.js and delete.js handlers
        // already support a null transcript result.
        return null;
    }
}

module.exports = {
    buildTranscript
};
