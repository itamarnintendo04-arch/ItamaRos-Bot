"use strict";

const sharp = require("sharp");

function xml(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;")
        .replace(/[\x00-\x1f\x7f]/g, " ")
        .slice(0, 110);
}

async function kingsGiveawayCard(prize, status = "active") {
    const headline = status === "ended" ? "WINNERS CROWNED"
        : status === "cancelled" ? "EVENT CANCELLED"
        : "EXCLUSIVE GIVEAWAY";
    const svg = [
        '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="500" viewBox="0 0 1200 500">',
        '<defs>',
        '<linearGradient id="royal" x1="0" y1="0" x2="1" y2="1">',
        '<stop offset="0" stop-color="#0b0820"/>',
        '<stop offset=".55" stop-color="#332255"/>',
        '<stop offset="1" stop-color="#7b5027"/>',
        '</linearGradient>',
        '<linearGradient id="gold" x1="0" y1="0" x2="1" y2="0">',
        '<stop offset="0" stop-color="#f7d17a"/>',
        '<stop offset=".5" stop-color="#fff0b4"/>',
        '<stop offset="1" stop-color="#c89543"/>',
        '</linearGradient>',
        '</defs>',
        '<rect width="1200" height="500" rx="36" fill="url(#royal)"/>',
        '<circle cx="1050" cy="90" r="255" fill="#f8cf72" opacity=".14"/>',
        '<path d="M700 0 L880 0 L570 500 L390 500Z" fill="#fff" opacity=".04"/>',
        '<circle cx="943" cy="170" r="170" fill="none" stroke="#f7d17a" stroke-opacity=".15" stroke-width="22"/>',
        '<circle cx="1150" cy="445" r="210" fill="#c6a7ff" opacity=".08"/>',
        '<rect x="34" y="32" width="1132" height="436" rx="29" fill="none" stroke="#f7d17a" stroke-width="3" stroke-opacity=".68"/>',
        '<rect x="53" y="50" width="1094" height="400" rx="22" fill="none" stroke="#fff" stroke-opacity=".09"/>',
        '<path d="M790 190 L830 105 L885 154 L943 65 L1002 154 L1055 105 L1095 190 L1074 220 L811 220 Z" fill="url(#gold)" stroke="#fff1c5" stroke-width="5"/>',
        '<circle cx="943" cy="152" r="18" fill="#7751b3" stroke="#f5e4ff" stroke-width="4"/>',
        '<rect x="819" y="232" width="248" height="25" rx="8" fill="#f4d17c"/>',
        '<text x="74" y="109" font-size="26" font-family="DejaVu Sans, Arial, sans-serif" font-weight="bold" fill="#e9c88b">ITAMAROS • KINGS EXCLUSIVE</text>',
        '<text x="73" y="195" font-size="66" font-family="DejaVu Sans, Arial, sans-serif" font-weight="bold" fill="#fff9e8">KINGS ONLY</text>',
        '<text x="75" y="268" font-size="43" font-family="DejaVu Sans, Arial, sans-serif" font-weight="bold" fill="url(#gold)">' + xml(headline) + '</text>',
        '<rect x="72" y="313" width="1055" height="102" rx="22" fill="#000" fill-opacity=".5" stroke="#f7d17a" stroke-opacity=".5"/>',
        '<text x="101" y="355" font-size="22" font-family="DejaVu Sans, Arial, sans-serif" fill="#f4deb0">THE ROYAL PRIZE</text>',
        '<text x="101" y="394" font-size="30" font-family="DejaVu Sans, Arial, sans-serif" font-weight="bold" fill="#fff">' + xml(prize) + '</text>',
        '</svg>'
    ].join("");

    return sharp(Buffer.from(svg), { limitInputPixels: 3000000 })
        .png().toBuffer();
}

module.exports = { kingsGiveawayCard };
