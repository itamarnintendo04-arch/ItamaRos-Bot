"use strict";

const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    MessageFlags
} = require("discord.js");
const eco = require("./service");
const photos = require("./itemImages");
const { refreshStorePanel } = require("./storePanel");

const P = PermissionFlagsBits;

const data = new SlashCommandBuilder()
    .setName("store-admin")
    .setDescription("Manage items and virtual currency")
    .setDMPermission(false)
    .setDefaultMemberPermissions(P.ManageGuild);

function addProperties(sub, required) {
    if (required) {
        sub.addStringOption(o => o.setName("name")
            .setDescription("Item name")
            .setMinLength(2).setMaxLength(70).setRequired(true));
        sub.addIntegerOption(o => o.setName("price")
            .setDescription("Price in virtual coins")
            .setMinValue(1).setMaxValue(eco.MAX_AMOUNT)
            .setRequired(true));
        sub.addStringOption(o => o.setName("type")
            .setDescription("Item type").setRequired(true)
            .addChoices(
                { name: "Collectible", value: "collectible" },
                { name: "Consumable", value: "consumable" },
                { name: "Discord role (legacy)", value: "role" },
                { name: "Instant reward (XP/coins/role)", value: "reward" }
            ));
    } else {
        sub.addStringOption(o => o.setName("name")
            .setDescription("New displayed item name")
            .setMinLength(2).setMaxLength(70).setRequired(false));
        sub.addIntegerOption(o => o.setName("price")
            .setDescription("New price")
            .setMinValue(1).setMaxValue(eco.MAX_AMOUNT)
            .setRequired(false));
        sub.addStringOption(o => o.setName("type")
            .setDescription("Change item type")
            .setRequired(false)
            .addChoices(
                { name: "Collectible", value: "collectible" },
                { name: "Consumable", value: "consumable" },
                { name: "Discord role (legacy)", value: "role" },
                { name: "Instant reward (XP/coins/role)", value: "reward" }
            ));
    }

    return sub
        .addStringOption(o => o.setName("description")
            .setDescription("Product description")
            .setMaxLength(500).setRequired(false))
        .addStringOption(o => o.setName("category")
            .setDescription("Product category")
            .setMaxLength(40).setRequired(false))
        .addIntegerOption(o => o.setName("stock")
            .setDescription("Available quantity (-1 for unlimited)")
            .setMinValue(-1).setMaxValue(eco.MAX_AMOUNT)
            .setRequired(false))
        .addRoleOption(o => o.setName("role")
            .setDescription("Role given when a role item is redeemed")
            .setRequired(false))
        .addAttachmentOption(o => o.setName("image")
            .setDescription("Optional product photo (PNG/JPG/WebP/GIF; max 7 MB)")
            .setRequired(false))
        .addBooleanOption(o => o.setName("kings_only")
            .setDescription("Only Kings members (and staff) can see and buy this item")
            .setRequired(false))
        .addIntegerOption(o => o.setName("kings_min_level")
            .setDescription("Required XP level for Kings (0-1000); staff bypass")
            .setMinValue(0).setMaxValue(1000).setRequired(false));
}

data.addSubcommand(s => addProperties(
    s.setName("create").setDescription("Create a new product"), true
).addIntegerOption(o => o.setName("reward_xp")
    .setDescription("Instant XP after purchase (0 = none; locked)")
    .setMinValue(0).setMaxValue(200000).setRequired(false))
.addIntegerOption(o => o.setName("reward_coins")
    .setDescription("Instant coins after purchase (0 = none; locked)")
    .setMinValue(0).setMaxValue(eco.MAX_AMOUNT).setRequired(false))
.addBooleanOption(o => o.setName("shop_pack").setDescription("Enable multiple rewards in this Shop Pack").setRequired(false))
.addStringOption(o => o.setName("external_rewards").setDescription("External prizes separated by | (max 10)").setMaxLength(1500).setRequired(false))
.addStringOption(o => o.setName("extra_roles").setDescription("Extra role IDs separated by commas (Shop Packs only)").setMaxLength(250).setRequired(false)));

data.addSubcommand(s => addProperties(
    s.setName("update").setDescription("Edit an existing product")
        .addStringOption(o => o.setName("item")
            .setDescription("Existing item ID from the shop")
            .setRequired(true)), false
).addBooleanOption(o => o.setName("remove-image")
    .setDescription("Remove the product picture").setRequired(false))
.addBooleanOption(o => o.setName("enabled")
    .setDescription("Show or hide this product in the store")
    .setRequired(false)));

data.addSubcommand(s => s.setName("remove-item")
    .setDescription("Hide a product (preserves purchased inventory)")
    .addStringOption(o => o.setName("item")
        .setDescription("Item key or original name").setRequired(true)));

for (const mode of ["add", "remove", "set"]) {
    data.addSubcommand(s => s.setName(mode)
        .setDescription(mode + " virtual coins")
        .addUserOption(o => o.setName("member")
            .setDescription("Member").setRequired(true))
        .addStringOption(o => o.setName("balance")
            .setDescription("Wallet or bank").setRequired(true)
            .addChoices(
                { name: "Wallet", value: "cash" },
                { name: "Bank", value: "bank" }
            ))
        .addIntegerOption(o => o.setName("amount")
            .setDescription("Coins")
            .setMinValue(0).setMaxValue(eco.MAX_AMOUNT)
            .setRequired(true)));
}

data.addSubcommand(s => s.setName("currency")
    .setDescription("Update server currency symbol")
    .addStringOption(o => o.setName("symbol")
        .setDescription("Emoji or short label")
        .setMaxLength(12).setRequired(true)));

data.addSubcommand(s => s.setName("rewards")
    .setDescription("Update daily and work rewards")
    .addIntegerOption(o => o.setName("daily")
        .setDescription("Daily coins")
        .setMinValue(0).setMaxValue(eco.MAX_AMOUNT)
        .setRequired(true))
    .addIntegerOption(o => o.setName("work")
        .setDescription("Work coins")
        .setMinValue(0).setMaxValue(eco.MAX_AMOUNT)
        .setRequired(true)));

const forbiddenRolePermissions = [
    P.Administrator, P.ManageGuild, P.ManageRoles,
    P.ManageChannels, P.BanMembers, P.KickMembers,
    P.ModerateMembers, P.ManageWebhooks
];

async function validateRole(guild, role) {
    if (!role) return;
    if (role.id === guild.id || role.managed ||
        role.id === process.env.KINGS_ROLE_ID ||
        /^kings?(?:[ |:-]*(?:level|lvl|rank|tier)?[ -]*[0-9]+)?$/i.test(role.name) ||
        /^Level [1-3]$/.test(role.name)) {
        throw new Error("This special or managed role cannot be sold.");
    }
    if (forbiddenRolePermissions.some(p => role.permissions.has(p))) {
        throw new Error("Store roles cannot grant moderation permissions.");
    }
    const bot = await guild.members.fetchMe();
    if (role.position >= bot.roles.highest.position) {
        throw new Error("Move the bot role above the product role.");
    }
}

function getProperties(options, isCreate) {
    const props = {};
    const keys = ["name", "description", "category", "type"];
    for (const field of keys) {
        const value = options.getString(field);
        if (value !== null) props[field] = value;
    }
    const price = options.getInteger("price");
    if (price !== null) props.price = price;

    const stock = options.getInteger("stock");
    if (stock !== null) props.stock = stock === -1 ? null : stock;

    const kingsOnly = options.getBoolean("kings_only");
    const kingsMinLevel = options.getInteger("kings_min_level");
    if (kingsOnly !== null) props.kingsOnly = kingsOnly;
    if (kingsMinLevel !== null) props.minKingsLevel = kingsMinLevel;
    if (isCreate && kingsOnly === null) props.kingsOnly = false;
    if (isCreate && kingsMinLevel === null) props.minKingsLevel = 0;

    const role = options.getRole("role");
    if (role) props.roleId = role.id;
    if (isCreate) {
        props.name = options.getString("name", true);
        props.price = options.getInteger("price", true);
        props.type = options.getString("type", true);
        const externalRaw = options.getString("external_rewards") || "";
        const extraRaw = options.getString("extra_roles") || "";
        const isPack = options.getBoolean("shop_pack") === true;
        const hasNewRewards = Boolean(externalRaw || extraRaw || isPack);
        if (hasNewRewards && props.type !== "reward") {
            throw new Error("Shop Packs and external rewards require Instant reward type.");
        }
        if (props.type === "reward") {
            const { validateShopRewards } = require("./shopPacks");
            const roles = [role?.id, ...extraRaw.split(",").map(x => x.trim())].filter(Boolean);
            const external = externalRaw.split("|").map(x => x.trim()).filter(Boolean);
            const checked = validateShopRewards({
                isPack, xp: options.getInteger("reward_xp") ?? 0,
                coins: options.getInteger("reward_coins") ?? 0,
                roles, external
            });
            props.isShopPack = checked.isPack;
            props.externalRewards = [...checked.external];
            props.rewards = {
                xp: checked.xp, coins: checked.coins,
                roleId: checked.roles[0] || null,
                roleIds: [...checked.roles]
            };
        } else if (options.getInteger("reward_xp") ||
                   options.getInteger("reward_coins")) {
            throw new Error("XP and coin rewards require Instant reward type.");
        }
    }
    return { props, role };
}

async function execute(interaction) {
    if (!interaction.inGuild() ||
        !interaction.memberPermissions?.has(P.ManageGuild)) {
        return interaction.reply({
            content: "❌ Manage Server permission required.",
            flags: MessageFlags.Ephemeral
        });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
        const guild = interaction.guild;
        const action = interaction.options.getSubcommand();
        const guildId = interaction.guildId;
        let response = "";
        let refresh = false;

        if (action === "create" || action === "update") {
            const create = action === "create";
            const { props, role } = getProperties(
                interaction.options, create
            );
            if (role) await validateRole(guild, role);
            if (create && props.rewards?.roleIds) {
                for (const id of props.rewards.roleIds) {
                    await validateRole(guild, await guild.roles.fetch(id));
                }
            }

            const image = interaction.options.getAttachment("image");
            const clearImage = !create &&
                interaction.options.getBoolean("remove-image") === true;
            if (image && clearImage) {
                throw new Error("Choose an image OR remove-image, not both.");
            }

            const processed = image
                ? await photos.readAttachment(image) : null;

            let item;
            if (create) {
                if (props.type === "role" && !role) {
                    throw new Error("A role product needs a Discord role.");
                }
                item = await eco.createItem(guildId, props);
            } else {
                const key = interaction.options.getString("item", true);
                const enabled = interaction.options.getBoolean("enabled");
                if (enabled !== null) props.enabled = enabled;

                if (!Object.keys(props).length &&
                    !processed && !clearImage) {
                    throw new Error("Choose a field or photo to update.");
                }

                item = Object.keys(props).length
                    ? await eco.updateItem(guildId, key, props)
                    : await eco.getItem(guildId, key);
                if (!item) throw new Error("Product not found.");
            }

            if (processed || clearImage) {
                try {
                    if (processed) {
                        await photos.saveImage(guildId, item.key, processed);
                    } else {
                        await photos.removeImage(guildId, item.key);
                    }
                } catch (error) {
                    throw new Error(
                        "Product saved, but the image update failed: " +
                        error.message
                    );
                }
            }

            response = "✅ **" + item.name + "** " +
                (create ? "created" : "updated") +
                " successfully. Item ID: " + item.key +
                (item.kingsOnly
                    ? "\\n👑 Kings only — XP level " +
                      (item.minKingsLevel || 0) + "+ (staff bypass)"
                    : "") +
                (create && item.type === "reward"
                    ? "\n🎁 Instant rewards: " +
                      (item.rewards.xp ? item.rewards.xp + " XP " : "") +
                      (item.rewards.coins ? item.rewards.coins + " coins " : "") +
                      (item.rewards.roleId ? "<@&" + item.rewards.roleId + "> " : "") +
                      "\n🔒 Reward types and amounts cannot be edited later."
                    : "");
            refresh = true;
        } else if (action === "remove-item") {
            const key = interaction.options.getString("item", true);
            const item = await eco.getItem(guildId, key);
            if (!item) throw new Error("Product not found.");
            await eco.catalog().updateOne(
                { _id: item._id },
                { $set: { enabled: false, updatedAt: new Date() } }
            );
            response = "✅ **" + item.name +
                "** hidden from the store. Owned items remain.";
            refresh = true;
        } else if (["add", "remove", "set"].includes(action)) {
            const member = interaction.options.getUser("member", true);
            if (member.bot) {
                throw new Error("Bots cannot gain or lose virtual coins.");
            }
            const kind = interaction.options.getString("balance", true);
            const amount = interaction.options.getInteger("amount", true);
            const balance = await eco.adjustMoney(
                guildId, member.id, action, kind, amount,
                interaction.user.id
            );
            response = "✅ <@" + member.id + "> now has " +
                balance + " coins in " + kind + ".";
        } else if (action === "currency") {
            const symbol = interaction.options.getString("symbol", true);
            await eco.setSetting(guildId, "currency", symbol);
            response = "✅ Currency symbol updated.";
            refresh = true;
        } else if (action === "rewards") {
            const daily = interaction.options.getInteger("daily", true);
            const work = interaction.options.getInteger("work", true);
            await eco.setSetting(guildId, "dailyReward", daily);
            await eco.setSetting(guildId, "workReward", work);
            response = "✅ Daily and work rewards updated.";
        } else {
            throw new Error("Unknown management action.");
        }

        if (refresh) {
            await refreshStorePanel(guild).catch(error => {
                console.warn(
                    "[Item Store] Panel refresh failed:", error.message
                );
                response += "\n⚠️ The shop display could not refresh.";
            });
        }

        await interaction.editReply({
            content: response,
            allowedMentions: { parse: [] }
        });
    } catch (error) {
        console.error("[StoreAdmin] Command error:", error);
        await interaction.editReply({
            content: "❌ " +
                String(error.message || "Could not manage the store.")
                    .slice(0, 350),
            allowedMentions: { parse: [] }
        }).catch(() => {});
    }
}

module.exports = { data, execute };
