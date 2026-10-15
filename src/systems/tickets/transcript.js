
const fs = require("fs");
const os = require("os");
const path = require("path");

async function buildTranscript(channel, ticket) {
    try {
        const messages = [];
        let lastId;

        while (true) {
            const options = { limit: 100 };

            if (lastId) {
                options.before = lastId;
            }

            const batch = await channel.messages.fetch(options);

            if (batch.size === 0) break;

            messages.push(...batch.values());
            lastId = batch.last().id;

            if (batch.size < 100) break;
        }

        messages.reverse();

        const escapeHTML = (value) => {
            return String(value ?? "").replace(
                /[&<>"']/g,
                (char) => ({
                    "&": "&amp;",
                    "<": "&lt;",
                    ">": "&gt;",
                    '"': "&quot;",
                    "'": "&#39;"
                })[char]
            );
        };

        const messageHTML = messages.map((message) => {
            const avatar = escapeHTML(
                message.author.displayAvatarURL({
                    extension: "png",
                    size: 64
                })
            );

            const username = escapeHTML(message.author.tag);
            const content = escapeHTML(message.content);

            const attachments = [...message.attachments.values()]
                .map((attachment) => {
                    const url = escapeHTML(attachment.url);
                    const name = escapeHTML(attachment.name);

                    return `<p>📎 <a href="${url}">${name}</a></p>`;
                })
                .join("");

            return `
                <div class="message">
                    <img class="avatar" src="${avatar}" />
                    <div class="message-content">
                        <div class="header">
                            <strong>${username}</strong>
                            <span>${escapeHTML(
                                message.createdAt.toLocaleString("en-US")
                            )}</span>
                        </div>
                        <p>${content || ""}</p>
                        ${attachments}
                    </div>
                </div>
            `;
        }).join("");

        const html = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Ticket Transcript</title>
<style>
body {
    background: #232428;
    color: #f2f3f5;
    font-family: Arial, sans-serif;
    padding: 30px;
}
.container {
    max-width: 900px;
    margin: auto;
}
h1 {
    color: #5865f2;
}
.info {
    background: #2b2d31;
    padding: 18px;
    border-radius: 10px;
    margin-bottom: 25px;
}
.message {
    display: flex;
    gap: 14px;
    padding: 15px;
    border-bottom: 1px solid #3f4147;
}
.avatar {
    width: 42px;
    height: 42px;
    border-radius: 50%;
}
.message-content {
    flex: 1;
    overflow-wrap: anywhere;
}
.header {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
}
.header span {
    color: #949ba4;
    font-size: 12px;
}
a {
    color: #00a8fc;
}
</style>
</head>
<body>
<div class="container">
    <h1>🎫 Ticket Transcript</h1>
    <div class="info">
        <p><strong>Ticket Owner:</strong> ${escapeHTML(ticket.username)}</p>
        <p><strong>Ticket Type:</strong> ${escapeHTML(ticket.typeLabel)}</p>
        <p><strong>Channel ID:</strong> ${escapeHTML(ticket.channelId)}</p>
        <p><strong>Session ID:</strong> ${escapeHTML(ticket.sessionId)}</p>
        <p><strong>Generated:</strong> ${new Date().toLocaleString("en-US")}</p>
    </div>
    ${messageHTML || "<p>No messages found.</p>"}
</div>
</body>
</html>`;

        const filePath = path.join(
            os.tmpdir(),
            `ticket-${ticket.sessionId}.html`
        );

        fs.writeFileSync(filePath, html, "utf8");

        return {
            attachment: filePath,
            name: `ticket-${ticket.sessionId}.html`
        };

    } catch (error) {
        console.error("[Ticket Transcript Error]", error);
        return null;
    }
}

module.exports = {
    buildTranscript
};
