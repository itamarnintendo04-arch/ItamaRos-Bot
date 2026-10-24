"use strict";

const sharp = require("sharp");
const {
    AttachmentBuilder,
    EmbedBuilder,
    PermissionFlagsBits
} = require("discord.js");

function clean(value, max = 40) {
    return String(value || "Member").slice(0, max)
        .replace(/[<>&'"]/g, " ")
        .replace(/[\x00-\x1f\x7f]/g, " ");
}

async function kingsImage(member) {
    const displayName = clean(
        member.displayName || member.user?.username, 30
    );
    const first = clean(displayName.slice(0, 1).toUpperCase(), 2);
    const bg = [
        '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="470">',
        '<defs><linearGradient id="k" x1="0" y1="0" x2="1" y2="1">',
        '<stop offset="0%" stop-color="#15102a"/>',
        '<stop offset="100%" stop-color="#7151bd"/>',
        '</linearGradient></defs>',
        '<rect width="1200" height="470" fill="url(#k)" rx="26"/>',
        '<circle cx="1050" cy="20" r="260" fill="#ffffff" fill-opacity=".045"/>',
        '<circle cx="1050" cy="420" r="180" fill="#f9d889" fill-opacity=".06"/>',
        '<rect x="34" y="34" width="1132" height="402" rx="24" fill="none" stroke="#f7dfaa" stroke-opacity=".5" stroke-width="2"/>',
        '<text x="76" y="102" font-size="27" font-weight="bold" fill="#ffe6ab" font-family="DejaVu Sans, Arial, sans-serif">ITAMAROS • EXCLUSIVE MEMBERS</text>',
        '<circle cx="170" cy="252" r="97" fill="#d6b46d"/>',
        '<circle cx="170" cy="252" r="89" fill="#483875"/>',
        '<text x="170" y="278" text-anchor="middle" font-size="80" font-weight="bold" fill="#fff" font-family="DejaVu Sans, Arial, sans-serif">' + first + '</text>',
        '<text x="310" y="205" font-size="60" font-weight="bold" fill="#ffffff" font-family="DejaVu Sans, Arial, sans-serif">WELCOME TO KINGS!</text>',
        '<text x="313" y="267" font-size="37" font-weight="bold" fill="#ffe2a8" font-family="DejaVu Sans, Arial, sans-serif">' + displayName + '</text>',
        '<text x="313" y="321" font-size="22" fill="#f0e8ff" font-family="DejaVu Sans, Arial, sans-serif">Thank you for boosting ItamaRos!</text>',
        '<text x="313" y="370" font-size="19" fill="#ddcfff" font-family="DejaVu Sans, Arial, sans-serif">Boost for 48 hours to keep your Kings rank permanently.</text>',
        '</svg>'
    ].join("");

    const base = sharp(Buffer.from(bg), {
        limitInputPixels: 3000000
    });

    try {
        const avatarUrl = member.displayAvatarURL({
            extension: "png", size: 256
        });
        const res = await fetch(avatarUrl, {
            signal: AbortSignal.timeout(10000)
        });
        if (!res.ok) throw Error("Avatar unavailable.");

        const avatarRaw = Buffer.from(await res.arrayBuffer());
        const circularMask = Buffer.from(
            '<svg width="180" height="180" xmlns="http://www.w3.org/2000/svg">' +
            '<circle cx="90" cy="90" r="90" fill="#fff"/></svg>'
        );
        const avatar = await sharp(avatarRaw)
            .resize(180, 180)
            .composite([{ input: circularMask, blend: "dest-in" }])
            .png().toBuffer();

        return base.composite([
            { input: avatar, left: 80, top: 162 }
        ]).png().toBuffer();
    } catch (error) {
        console.warn(
            "[Kings] Using fallback avatar:",
            error.message
        );
        return base.png().toBuffer();
    }
}

async function sendKingsWelcome(member, channelId) {
    if (!channelId) return false;
    const channel = await member.guild.channels.fetch(channelId)
        .catch(() => null);
    if (!channel || channel.guildId !== member.guild.id ||
        !channel.isTextBased?.() ||
        typeof channel.send !== "function") {
        throw new Error("KINGS_WELCOME_CHANNEL_ID is invalid.");
    }

    const bot = await member.guild.members.fetchMe();
    const permission = channel.permissionsFor(bot);
    if (!permission?.has(PermissionFlagsBits.ViewChannel) ||
        !permission?.has(PermissionFlagsBits.SendMessages) ||
        !permission?.has(PermissionFlagsBits.EmbedLinks)) {
        throw new Error("Missing Kings welcome channel permissions.");
    }

    const embed = new EmbedBuilder()
        .setColor(0xD6B46D)
        .setTitle("👑 Welcome to the Kings!")
        .setDescription([
            "Congratulations, <@" + member.id + ">!",
            "",
            "💜 Thank you for boosting our server.",
            "🔓 You now have access to Kings-exclusive areas.",
            "🏆 **Keep your boost for 48 hours** to retain",
            "your earned Kings rank even after the boost ends."
        ].join("\n"))
        .setTimestamp();

    const payload = {
        content: "👑 Welcome to Kings, <@" + member.id + ">!",
        embeds: [embed],
        allowedMentions: { parse: [], users: [member.id] }
    };

    if (permission.has(PermissionFlagsBits.AttachFiles)) {
        try {
            const png = await kingsImage(member);
            embed.setImage("attachment://kings-welcome.png");
            payload.files = [
                new AttachmentBuilder(png, {
                    name: "kings-welcome.png"
                })
            ];
        } catch (error) {
            console.warn("[Kings] Image render failed:", error.message);
            embed.setImage(null);
        }
    }

    await channel.send(payload);
    return true;
}

module.exports = { kingsImage, sendKingsWelcome };
