"use strict";

const sharp = require("sharp");
const {
    AttachmentBuilder,
    EmbedBuilder,
    PermissionFlagsBits
} = require("discord.js");

function xml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;")
        .replace(/[\x00-\x1f\x7f]/g, " ")
        .slice(0, 100);
}

function displayText(value, limit = 25) {
    return String(value ?? "Member").trim().slice(0, limit);
}

async function renderWelcomeImage(member, attribution, inviterName) {
    const username = xml(displayText(
        member.displayName || member.user.username, 28
    ));

    const inviter = attribution.inviterId
        ? displayText(inviterName || "Known member", 23)
        : "Unknown";

    const first = xml(
        displayText(member.displayName || member.user.username, 1)
            .toUpperCase()
    );

    const visitorCount = Number(attribution.theirInvites || 0);
    const inviterCount = attribution.inviterInvites ?? 0;

    // Render a personalized PNG directly, no copyrighted
    // game artwork or external image hosting necessary.
    const svg = [
        '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="480" viewBox="0 0 1200 480">',
        '<defs>',
        '<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">',
        '<stop offset="0%" stop-color="#111128"/>',
        '<stop offset="55%" stop-color="#26205e"/>',
        '<stop offset="100%" stop-color="#4931a0"/>',
        '</linearGradient>',
        '<radialGradient id="orb"><stop offset="0%" stop-color="#e2baff"/><stop offset="100%" stop-color="#6855cd"/></radialGradient>',
        '<radialGradient id="glow"><stop stop-color="#bd8dff" stop-opacity=".5"/><stop offset="1" stop-color="#bd8dff" stop-opacity="0"/></radialGradient>',
        '</defs>',
        '<rect width="1200" height="480" rx="35" fill="url(#bg)"/>',
        '<circle cx="1040" cy="160" r="340" fill="url(#glow)"/>',
        '<path d="M710 0 L900 0 L580 480 L390 480Z" fill="#fff" opacity=".035"/>',
        '<path d="M1010 40 L1034 103 L1100 105 L1048 145 L1068 209 L1010 171 L952 209 L972 145 L920 105 L986 103Z" fill="#fff" opacity=".12"/>',
        '<circle cx="1000" cy="420" r="220" fill="#bd8dff" opacity=".07"/>',
        '<rect x="36" y="36" width="1128" height="408" rx="28" fill="none" stroke="#ffffff" stroke-opacity=".20" stroke-width="2"/>',
        '<rect x="63" y="62" width="340" height="44" rx="22" fill="#ffffff" fill-opacity=".10"/>',
        '<text x="86" y="92" font-family="DejaVu Sans, Arial, sans-serif" font-size="22" fill="#eee9ff" font-weight="bold">ITAMAROS COMMUNITY</text>',
        '<circle cx="105" cy="233" r="63" fill="url(#orb)" stroke="#ede0ff" stroke-opacity=".8" stroke-width="5"/>',
        '<text x="105" y="255" font-family="DejaVu Sans, Arial, sans-serif" text-anchor="middle" font-size="65" font-weight="bold" fill="#ffffff">' + first + '</text>',
        '<text x="200" y="192" font-family="DejaVu Sans, Arial, sans-serif" font-size="55" font-weight="bold" fill="#ffffff">WELCOME!</text>',
        '<text x="200" y="250" font-family="DejaVu Sans, Arial, sans-serif" font-size="35" font-weight="bold" fill="#c4b5fd">' + username + '</text>',
        '<text x="200" y="302" font-family="DejaVu Sans, Arial, sans-serif" font-size="23" fill="#ede9fe">Invited by: ' + xml(inviter) + '</text>',
        '<rect x="65" y="354" width="1070" height="58" rx="18" fill="#090b22" fill-opacity=".68" stroke="#c9a7ff" stroke-opacity=".45"/>',
        '<text x="96" y="391" font-family="DejaVu Sans, Arial, sans-serif" font-size="22" fill="#ffffff">Your invites: ' + visitorCount + '</text>',
        '<text x="535" y="391" font-family="DejaVu Sans, Arial, sans-serif" font-size="22" fill="#ffffff">Inviter invites: ' + inviterCount + '</text>',
        '</svg>'
    ].join("");

    const canvas = sharp(Buffer.from(svg), {
        limitInputPixels: 3000000
    });
    // Render the newcomer's actual circular avatar, while retaining
    // the built-in initial as a graceful offline fallback.
    try {
        const avatarUrl = member.displayAvatarURL({
            extension: "png", size: 256
        });
        const response = await fetch(avatarUrl, {
            signal: AbortSignal.timeout(8000)
        });
        if (!response.ok) throw new Error("Avatar unavailable.");

        const raw = Buffer.from(await response.arrayBuffer());
        if (raw.length < 10 || raw.length > 4 * 1024 * 1024) {
            throw new Error("Avatar size outside safe limits.");
        }

        const circle = Buffer.from(
            '<svg width="126" height="126" xmlns="http://www.w3.org/2000/svg">' +
            '<circle cx="63" cy="63" r="63" fill="#fff"/></svg>'
        );
        const roundedAvatar = await sharp(raw)
            .resize(126, 126, { fit: "cover" })
            .composite([{ input: circle, blend: "dest-in" }])
            .png().toBuffer();

        return canvas.composite([{
            input: roundedAvatar, left: 42, top: 170
        }]).png().toBuffer();
    } catch (error) {
        console.warn(
            "[Welcome] Avatar failed; rendered the initial instead:",
            error.message
        );
        return canvas.png().toBuffer();
    }
}

async function sendWelcome(member, attribution) {
    const guild = member.guild;
    const channelId = process.env.WELCOME_CHANNEL_ID;

    if (!channelId) {
        console.warn(
            "[Welcome] Set WELCOME_CHANNEL_ID in Render to enable greetings."
        );
        return false;
    }

    const channel = await guild.channels.fetch(channelId)
        .catch(() => null);

    if (
        !channel ||
        channel.guildId !== guild.id ||
        !channel.isTextBased?.() ||
        typeof channel.send !== "function"
    ) {
        console.warn("[Welcome] Invalid Discord welcome channel.");
        return false;
    }

    const me = await guild.members.fetchMe();
    const permissions = channel.permissionsFor(me);
    if (
        !permissions?.has(PermissionFlagsBits.ViewChannel) ||
        !permissions?.has(PermissionFlagsBits.SendMessages) ||
        !permissions?.has(PermissionFlagsBits.EmbedLinks)
    ) {
        console.warn("[Welcome] Bot needs View, Send and Embed permissions.");
        return false;
    }

    let inviterName = null;
    if (attribution.inviterId) {
        const inviter = await guild.members
            .fetch(attribution.inviterId)
            .catch(() => null);

        inviterName = inviter?.displayName ||
            inviter?.user?.username || "Known member";
    }

    const inviterLabel = attribution.inviterId
        ? "<@" + attribution.inviterId + ">"
        : "Unknown (invite could not be identified)";

    const inviterInvites = attribution.inviterInvites;
    const embed = new EmbedBuilder()
        .setColor(0x8B5CF6)
        .setTitle("💜 Welcome to ItamaRos!")
        .setDescription([
            "🎉 Welcome <@" + member.id + ">!",
            "",
            "📨 **Invited by:** " + inviterLabel,
            "🏆 **Inviter's invites:** " +
                (inviterInvites === null ? "Unknown" : inviterInvites),
            "🎟️ **Your invites:** " + (attribution.theirInvites || 0),
            "👥 **Server member count:** " + guild.memberCount,
            "",
            "Enjoy your stay in our community!"
        ].join("\n"))
        .setFooter({ text: "ItamaRos Bot • Welcome System" })
        .setTimestamp();

    const payload = {
        content: "Welcome to the server, <@" + member.id + ">! 💜",
        embeds: [embed],
        allowedMentions: {
            parse: [],
            users: [member.id]
        }
    };

    try {
        if (permissions.has(PermissionFlagsBits.AttachFiles)) {
            const png = await renderWelcomeImage(
                member,
                attribution,
                inviterName
            );
            embed.setImage("attachment://welcome.png");
            payload.files = [
                new AttachmentBuilder(png, { name: "welcome.png" })
            ];
        }

        await channel.send(payload);
        return true;
    } catch (error) {
        console.error("[Welcome] Image/message failed:", error);
        // Still welcome the member if PNG rendering or upload fails.
        await channel.send({
            ...payload,
            files: [],
            embeds: [EmbedBuilder.from(embed).setImage(null)]
        }).catch(failure => {
            console.error(
                "[Welcome] Text fallback failed:",
                failure.message
            );
        });
        return false;
    }
}

module.exports = { sendWelcome, renderWelcomeImage };
