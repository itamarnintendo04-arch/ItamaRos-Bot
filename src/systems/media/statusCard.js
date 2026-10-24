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

    const prizeText = String(prize).slice(0, 54);
    const fontSize = prizeText.length > 39 ? 29 : prizeText.length > 25 ? 36 : 45;
    const highlight = mode === "drop" ? "#46f5d1" : "#f8c5ff";
    const svg = [
        '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="460" viewBox="0 0 1200 460">',
        '<defs>',
        '<linearGradient id="bg" x1="0" y1="1" x2="1" y2="0">',
        '<stop offset="0" stop-color="#080a20"/>',
        '<stop offset=".55" stop-color="' + palette[0] + '"/>',
        '<stop offset="1" stop-color="' + palette[1] + '"/>',
        '</linearGradient>',
        '<radialGradient id="glow"><stop stop-color="' + highlight + '" stop-opacity=".35"/><stop offset="1" stop-color="' + highlight + '" stop-opacity="0"/></radialGradient>',
        '<linearGradient id="shine" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fff" stop-opacity=".22"/><stop offset="1" stop-color="#fff" stop-opacity=".02"/></linearGradient>',
        '</defs>',
        '<rect width="1200" height="460" rx="32" fill="url(#bg)"/>',
        '<circle cx="955" cy="220" r="340" fill="url(#glow)"/>',
        '<path d="M650 0 L940 0 L690 460 L400 460Z" fill="#fff" opacity=".035"/>',
        '<path d="M1060 -60 L1240 120 L880 480 L700 300Z" fill="#fff" opacity=".045"/>',
        '<rect x="28" y="28" width="1144" height="404" rx="27" fill="none" stroke="#fff" stroke-opacity=".25" stroke-width="2"/>',
        '<rect x="58" y="53" width="276" height="45" rx="22" fill="url(#shine)" stroke="#fff" stroke-opacity=".18"/>',
        '<text x="83" y="83" font-size="21" font-weight="bold" fill="#fff" font-family="DejaVu Sans, Arial, sans-serif">✦ ITAMAROS EVENTS</text>',
        '<text x="66" y="184" font-size="82" font-weight="bold" fill="#fff" font-family="DejaVu Sans, Arial, sans-serif">' + xml(title) + '</text>',
        '<text x="68" y="255" font-size="52" font-weight="bold" fill="' + accent + '" font-family="DejaVu Sans, Arial, sans-serif">' + xml(statusTitle) + '</text>',
        '<rect x="65" y="287" width="1060" height="118" rx="23" fill="#080a1b" fill-opacity=".62" stroke="' + highlight + '" stroke-opacity=".45"/>',
        '<text x="91" y="333" font-size="19" font-weight="bold" fill="' + highlight + '" font-family="DejaVu Sans, Arial, sans-serif">THE PRIZE</text>',
        '<text x="91" y="382" font-size="' + fontSize + '" font-weight="bold" fill="#fff" font-family="DejaVu Sans, Arial, sans-serif">' + xml(prizeText) + '</text>',
        '<circle cx="1025" cy="165" r="97" fill="none" stroke="' + highlight + '" stroke-opacity=".7" stroke-width="4"/>',
        '<circle cx="1025" cy="165" r="73" fill="url(#shine)"/>',
        '<path d="M1025 99 L1044 144 L1092 147 L1054 177 L1067 225 L1025 197 L983 225 L996 177 L958 147 L1006 144Z" fill="' + highlight + '"/>',
        '<text x="1120" y="445" text-anchor="end" font-size="17" fill="#fff" fill-opacity=".75" font-family="DejaVu Sans, Arial, sans-serif">' + xml(String(subtitle).slice(0, 64)) + '</text>',
        '</svg>'
    ].join("");

    return sharp(Buffer.from(svg), { limitInputPixels: 3000000 })
        .png()
        .toBuffer();
}

module.exports = { statusCard };
