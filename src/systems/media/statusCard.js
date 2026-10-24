"use strict";

const sharp = require("sharp");

const COLORS = Object.freeze({
    giveaway: ["#27125c", "#8e44de"],
    drop: ["#122b50", "#13a89e"]
});

function xml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;")
        .replace(/[\x00-\x1f\x7f]/g, " ")
        .slice(0, 220);
}

async function statusCard({
    kind = "giveaway",
    status = "active",
    prize = "",
    subtitle = ""
} = {}) {
    const mode = kind === "drop" ? "drop" : "giveaway";
    const palette = COLORS[mode];
    const title = mode === "drop" ? "DROP" : "GIVEAWAY";
    const statusTitle = {
        active: "NOW LIVE",
        ended: "ENDED",
        claimed: "CLAIMED",
        cancelled: "CANCELLED"
    }[status] || "NOW LIVE";

    const accent = status === "active"
        ? "#c4b5fd"
        : status === "claimed"
            ? "#a8ffce"
            : "#ffe4e6";

    const svg = [
        '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="460" viewBox="0 0 1200 460">',
        '<defs>',
        '<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">',
        '<stop offset="0%" stop-color="' + palette[0] + '"/>',
        '<stop offset="100%" stop-color="' + palette[1] + '"/>',
        '</linearGradient>',
        '</defs>',
        '<rect width="1200" height="460" rx="32" fill="url(#bg)"/>',
        '<circle cx="1060" cy="30" r="240" fill="#ffffff" opacity=".08"/>',
        '<circle cx="1110" cy="340" r="155" fill="#fff" opacity=".06"/>',
        '<rect x="36" y="38" width="1128" height="384" rx="28" fill="none" stroke="#ffffff" stroke-opacity=".20" stroke-width="2"/>',
        '<rect x="62" y="58" width="270" height="38" rx="19" fill="#000000" fill-opacity=".22"/>',
        '<text x="78" y="85" font-size="20" font-weight="bold" fill="#ffffff" font-family="DejaVu Sans, Arial, sans-serif">ITAMAROS EVENTS</text>',
        '<text x="67" y="172" font-size="76" font-weight="bold" fill="#ffffff" font-family="DejaVu Sans, Arial, sans-serif">' + xml(title) + '</text>',
        '<text x="68" y="250" font-size="54" font-weight="bold" fill="' + accent + '" font-family="DejaVu Sans, Arial, sans-serif">' + xml(statusTitle) + '</text>',
        '<text x="69" y="324" font-size="29" fill="#ffffff" font-family="DejaVu Sans, Arial, sans-serif">' + xml(String(prize).slice(0, 65)) + '</text>',
        '<text x="69" y="378" font-size="20" fill="#e9dcff" font-family="DejaVu Sans, Arial, sans-serif">' + xml(String(subtitle).slice(0, 85)) + '</text>',
        '</svg>'
    ].join("");

    return sharp(Buffer.from(svg), { limitInputPixels: 3000000 })
        .png()
        .toBuffer();
}

module.exports = { statusCard };
