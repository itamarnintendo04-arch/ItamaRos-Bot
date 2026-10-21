
const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags
} = require("discord.js");

const { getDatabase } = require("../../../database");
const { GIVEAWAY_SETTINGS } = require("./config");

const SETTINGS = Object.freeze({
    PAGE_SIZE: 10,
    MAX_BUTTONS_PER_ROW: 5,
    MAX_PAGES: 10000,
    COLOR: GIVEAWAY_SETTINGS.DEFAULT_COLOR
});

const data = new SlashCommandBuilder()
    .setName("active-giveaways")
    .setDescription("Browse active giveaways in this server")
    .setDMPermission(false)
    .addIntegerOption(option =>
        option
            .setName("page")
            .setDescription("Page number (default: 1)")
            .setMinValue(1)
            .setMaxValue(SETTINGS.MAX_PAGES)
            .setRequired(false)
    );

function safeText(value, limit = 150) {
    return String(value ?? "Unknown")
        .replace(/[\r\n\t]+/g, " ")
        .replace(/@/g, "@\u200b")
        .trim()
        .slice(0, limit);
}

function isDiscordId(value) {
    return (
        typeof value === "string" &&
        /^\d{17,20}$/.test(value)
    );
}

function getGiveawayUrl(giveaway) {
    if (
        !isDiscordId(giveaway.guildId) ||
        !isDiscordId(giveaway.channelId) ||
        !isDiscordId(giveaway.messageId)
    ) {
        return null;
    }

    return (
        "https://discord.com/channels/" +
        `${giveaway.guildId}/` +
        `${giveaway.channelId}/` +
        `${giveaway.messageId}`
    );
}

function getParticipantsCount(giveaway) {
    return Array.isArray(giveaway.participants)
        ? giveaway.participants.length
        : 0;
}

function getTimestamp(value) {
    const timestamp = new Date(value).getTime();

    if (!Number.isFinite(timestamp)) {
        return null;
    }

    return Math.floor(timestamp / 1000);
}

function createGiveawayEmbed(giveaway, position) {
    const prize = safeText(
        giveaway.prize,
        120
    );

    const timestamp = getTimestamp(
        giveaway.endsAt
    );

    const participantCount =
        getParticipantsCount(giveaway);

    const winnerCount = Number.isInteger(
        giveaway.winnerCount
    )
        ? giveaway.winnerCount
        : 1;

    const host = isDiscordId(giveaway.hostId)
        ? `<@${giveaway.hostId}>`
        : "Unknown";

    const description = [
        `**👑 Hosted by:** ${host}`,
        `**👥 Participants:** ${participantCount}`,
        `**🏆 Winners:** ${winnerCount}`,
        "",
        timestamp
            ? `**📅 Ends:** <t:${timestamp}:F>`
            : "**📅 Ends:** Unknown",
        timestamp
            ? `**⏳ Time remaining:** <t:${timestamp}:R>`
            : "**⏳ Time remaining:** Unknown"
    ];

    const url = getGiveawayUrl(giveaway);

    if (url) {
        description.push(
            "",
            `🔗 [Jump to Giveaway](${url})`
        );
    }

    const embed = new EmbedBuilder()
        .setColor(SETTINGS.COLOR)
        .setTitle(`🎁 ${position}. ${prize}`)
        .setDescription(
            description.join("\n")
        )
        .setFooter({
            text: "ItamaRos Bot • Active Giveaways"
        });

    if (
        typeof giveaway.imageUrl === "string" &&
        /^https:\/\//i.test(giveaway.imageUrl)
    ) {
        embed.setThumbnail(giveaway.imageUrl);
    }

    return embed;
}

function createLinkButtons(giveaways, startIndex) {
    const buttons = [];

    for (
        let index = 0;
        index < giveaways.length;
        index++
    ) {
        const giveaway = giveaways[index];

        const url = getGiveawayUrl(
            giveaway
        );

        if (!url) {
            continue;
        }

        const prize = safeText(
            giveaway.prize,
            55
        );

        const button = new ButtonBuilder()
            .setLabel(
                `${startIndex + index + 1}. ${prize}`.slice(0, 80)
            )
            .setStyle(ButtonStyle.Link)
            .setURL(url)
            .setEmoji("🎁");

        buttons.push(button);
    }

    const rows = [];

    for (
        let index = 0;
        index < buttons.length;
        index += SETTINGS.MAX_BUTTONS_PER_ROW
    ) {
        const row = new ActionRowBuilder()
            .addComponents(
                buttons.slice(
                    index,
                    index + SETTINGS.MAX_BUTTONS_PER_ROW
                )
            );

        rows.push(row);
    }

    return rows;
}

function createErrorEmbed(description) {
    return new EmbedBuilder()
        .setColor(0xEF4444)
        .setTitle("❌ Giveaways Unavailable")
        .setDescription(description)
        .setFooter({
            text: "ItamaRos Bot • Giveaways"
        });
}

async function execute(interaction) {
    if (!interaction.inGuild()) {
        await interaction.reply({
            content:
                "This command can only be used in a server.",
            flags: MessageFlags.Ephemeral
        });

        return;
    }

    await interaction.deferReply();

    try {
        const collection = getDatabase().collection(
            GIVEAWAY_SETTINGS.COLLECTION
        );

        const page = interaction.options.getInteger(
            "page"
        ) || 1;

        const filter = {
            guildId: interaction.guildId,

            status: GIVEAWAY_SETTINGS.STATUS.ACTIVE,

            // Do not show giveaways whose end time has passed,
            // even if the scheduler hasn't processed them yet.
            endsAt: {
                $gt: new Date()
            }
        };

        const total = await collection.countDocuments(
            filter
        );

        if (total === 0) {
            const embed = new EmbedBuilder()
                .setColor(SETTINGS.COLOR)
                .setTitle("🎉 No Active Giveaways")
                .setDescription(
                    [
                        "There are currently no active giveaways in this server.",
                        "",
                        "Check back later for new prizes!"
                    ].join("\n")
                )
                .setFooter({
                    text: "ItamaRos Bot • Giveaways"
                });

            await interaction.editReply({
                embeds: [embed],
                components: []
            });

            return;
        }

        const totalPages = Math.ceil(
            total / SETTINGS.PAGE_SIZE
        );

        if (page > totalPages) {
            await interaction.editReply({
                embeds: [
                    createErrorEmbed(
                        `Page ${page} does not exist. ` +
                        `There are currently ${totalPages} pages.`
                    )
                ]
            });

            return;
        }

        const skip = (
            page - 1
        ) * SETTINGS.PAGE_SIZE;

        const giveaways = await collection
            .find(filter)
            .sort({
                endsAt: 1,
                _id: 1
            })
            .skip(skip)
            .limit(SETTINGS.PAGE_SIZE)
            .toArray();

        if (giveaways.length === 0) {
            await interaction.editReply({
                embeds: [
                    createErrorEmbed(
                        "The active giveaway list changed. " +
                        "Please run the command again."
                    )
                ]
            });

            return;
        }

        const startIndex = skip;

        const embeds = giveaways.map(
            (giveaway, index) =>
                createGiveawayEmbed(
                    giveaway,
                    startIndex + index + 1
                )
        );

        const rows = createLinkButtons(
            giveaways,
            startIndex
        );

        const header = [
            "🎉 **ITAMAROS • ACTIVE GIVEAWAYS**",
            "",
            `🎁 **Active Giveaways:** ${total}`,
            `📄 **Page:** ${page}/${totalPages}`,
            "",
            "Click a giveaway button below to join!"
        ];

        if (totalPages > 1) {
            const nextPage = Math.min(
                page + 1,
                totalPages
            );

            header.push(
                "",
                `To browse another page, use ` +
                `\`/active-giveaways page:${nextPage}\`.`
            );
        }

        await interaction.editReply({
            content: header.join("\n"),
            embeds,
            components: rows,
            allowedMentions: {
                parse: []
            }
        });

        console.log(
            `[ActiveGiveaways] ` +
            `${interaction.user.id} viewed page ${page} ` +
            `in guild ${interaction.guildId}.`
        );
    } catch (error) {
        console.error(
            "[ActiveGiveaways] Command failed:",
            error
        );

        await interaction.editReply({
            content: "",
            embeds: [
                createErrorEmbed(
                    "Could not load the active giveaways. " +
                    "Please try again later."
                )
            ],
            components: []
        }).catch(replyError => {
            console.error(
                "[ActiveGiveaways] Reply failed:",
                replyError
            );
        });
    }
}

module.exports = {
    data,
    execute
};
