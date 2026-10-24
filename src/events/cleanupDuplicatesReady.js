"use strict";

const { Events, ChannelType, PermissionFlagsBits } =
    require("discord.js");
const { getDatabase } = require("../../database");

const GUILD_ID = process.env.GUILD_ID;
const CHANNEL_MAPPINGS = Object.freeze([
    {
        key: "ticket-panel",
        duplicate: "1563469786644742145",
        original: "1557303118796955668",
        duplicateName: "support-tickets",
        originalName: "tickets"
    },
    {
        key: "giveaways",
        duplicate: "1563469795578347581",
        original: "1541314936070742068",
        duplicateName: "giveaways",
        originalName: "g-ï-v-ê-å-w-å-¥-§"
    },
    {
        key: "shop",
        duplicate: "1563469804797562991",
        original: "1550947251927523358",
        duplicateName: "shop",
        originalName: "item-store"
    }
]);

async function cleanOne(guild, rule) {
    const db = getDatabase();
    const savedCollection = db.collection("bot_system_channels");
    const auditCollection = db.collection("duplicate_cleanup_audit");
    const rowId = guild.id + ":" + rule.key;
    const record = await savedCollection.findOne({ _id: rowId });

    const original = await guild.channels.fetch(rule.original)
        .catch(() => null);
    const duplicate = await guild.channels.fetch(rule.duplicate)
        .catch(() => null);

    if (!original ||
        original.guildId !== guild.id ||
        original.name !== rule.originalName ||
        original.type !== ChannelType.GuildText) {
        console.warn(
            "[Cleanup] Original channel mismatch for " +
            rule.key + "; no deletion performed."
        );
        return false;
    }

    if (!duplicate) {
        // Already removed manually or on an earlier startup.
        // Restore the mapping to the original existing channel.
        await savedCollection.updateOne(
            { _id: rowId },
            { $set: {
                guildId: guild.id,
                channelId: original.id,
                channelName: original.name,
                autoCreated: false,
                introSent: true,
                updatedAt: new Date()
            } },
            { upsert: true }
        );
        console.log("[Cleanup] Already gone: " + rule.duplicate);
        return true;
    }

    const cleanName = duplicate.name === rule.duplicateName;
    const createdOnOctober24 = duplicate.createdAt &&
        duplicate.createdAt.toISOString().startsWith("2026-10-24");
    const recordedBySetup = record?.channelId === duplicate.id &&
        record?.autoCreated === true &&
        Boolean(record?.introMessageId);
    if (
        duplicate.guildId !== guild.id ||
        duplicate.type !== ChannelType.GuildText ||
        !cleanName ||
        !createdOnOctober24 ||
        !recordedBySetup
    ) {
        console.warn(
            "[Cleanup] Identity verification failed for " +
            rule.key + "; no deletion performed."
        );
        return false;
    }

    const recent = await duplicate.messages.fetch({ limit: 5 });
    if (
        recent.size !== 1 ||
        recent.first()?.id !== record.introMessageId ||
        recent.first()?.author?.id !== guild.client.user.id ||
        duplicate.lastMessageId !== record.introMessageId
    ) {
        console.warn(
            "[Cleanup] Found additional activity in " +
            rule.key + "; preserving channel."
        );
        return false;
    }

    // Change the system mapping before deleting the empty duplicate,
    // so automatic recovery never targets the removed ID.
    await savedCollection.updateOne(
        { _id: rowId, channelId: duplicate.id },
        {
            $set: {
                guildId: guild.id,
                channelId: original.id,
                channelName: original.name,
                autoCreated: false,
                introSent: true,
                updatedAt: new Date(),
                cleanedDuplicateChannelId: duplicate.id
            },
            $unset: { introMessageId: "", introSentAt: "" }
        }
    );

    await auditCollection.updateOne(
        { _id: guild.id + ":" + duplicate.id },
        { $setOnInsert: {
            guildId: guild.id,
            system: rule.key,
            oldId: duplicate.id,
            keptId: original.id,
            markedAt: new Date()
        } },
        { upsert: true }
    );

    try {
        await duplicate.delete(
            "ItamaRos: remove verified empty duplicate; original " +
            original.id + " preserved"
        );
    } catch (error) {
        console.warn(
            "[Cleanup] Could not delete " + duplicate.id +
            ": " + error.message
        );
        // The original is still mapped. No data was deleted.
        return false;
    }

    await auditCollection.updateOne(
        { _id: guild.id + ":" + duplicate.id },
        { $set: { deletedAt: new Date() } }
    );

    console.log(
        "[Cleanup] Deleted verified duplicate " +
        duplicate.name + " (" + duplicate.id +
        "), kept " + original.name + " (" + original.id + ")."
    );
    return true;
}

async function safeCleanup(client) {
    if (process.env.BOT_DUPLICATE_CLEANUP !== "true") return;
    const guild = await client.guilds.fetch(GUILD_ID);
    const me = await guild.members.fetchMe();
    if (!me.permissions.has(PermissionFlagsBits.ManageChannels)) {
        console.warn(
            "[Cleanup] Manage Channels permission missing; no deletion."
        );
        return;
    }

    let done = 0;
    for (const rule of CHANNEL_MAPPINGS) {
        try {
            if (await cleanOne(guild, rule)) done++;
        } catch (error) {
            console.error(
                "[Cleanup] Could not process " +
                rule.key + ": " + error.message
            );
        }
    }
    console.log(
        "[Cleanup] Completed " + done +
        "/" + CHANNEL_MAPPINGS.length + " verified cleanup tasks."
    );
}

module.exports = {
    name: Events.ClientReady,
    once: true,
    async execute(client) {
        // Existing channel IDs are restored by autoChannelsReady.
        // Cleanup verifies its own MongoDB mapping and channel identity,
        // and never deletes a channel containing human messages.
        await safeCleanup(client);
    },
    CHANNEL_MAPPINGS,
    safeCleanup
};
