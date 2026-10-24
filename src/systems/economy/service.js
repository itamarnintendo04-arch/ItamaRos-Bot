"use strict";

const { getDatabase, getMongoClient } = require("../../../database");

const MAX_AMOUNT = 1000000000;
const MAX_BALANCE = 1000000000000;
const DAILY_MS = 24 * 60 * 60 * 1000;
const WORK_MS = 60 * 60 * 1000;

function database() { return getDatabase(); }
function accounts() { return database().collection("economy_accounts"); }
function catalog() { return database().collection("economy_items"); }
function inventory() { return database().collection("economy_inventory"); }
function settings() { return database().collection("economy_settings"); }
function journal() { return database().collection("economy_transactions"); }

function id(guildId, userId) { return guildId + ":" + userId; }
function itemId(guildId, name) {
    return guildId + ":" + slug(name);
}
function slug(name) {
    return String(name || "").trim().toLowerCase()
        .replace(/[^a-z0-9 _-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .slice(0, 45);
}
function amount(value) {
    if (!Number.isSafeInteger(value) || value < 0 ||
        value > MAX_AMOUNT) throw new Error("Amount must be between 1 and 1,000,000,000.");
    return value;
}
function fail(message) { throw new Error(message); }

async function setupAccount(guildId, userId, session) {
    await accounts().updateOne({ _id: id(guildId, userId) }, {
        $setOnInsert: {
            guildId, userId, cash: 0, bank: 0,
            dailyAt: new Date(0), workAt: new Date(0),
            stealAt: new Date(0), playAt: new Date(0),
            createdAt: new Date()
        }
    }, { upsert: true, session });
}
async function getAccount(guildId, userId) {
    await setupAccount(guildId, userId);
    return accounts().findOne({ _id: id(guildId, userId) });
}
async function getSettings(guildId) {
    const saved = await settings().findOne({ _id: guildId });
    return {
        currency: saved?.currency || "🪙",
        dailyReward: saved?.dailyReward ?? 250,
        workReward: saved?.workReward ?? 75,
        sellPercent: saved?.sellPercent ?? 50
    };
}

async function inTransaction(work) {
    const session = getMongoClient().startSession();
    try {
        return await session.withTransaction(() => work(session));
    } finally {
        await session.endSession();
    }
}

async function log(session, guildId, kind, userId, targetId, value, extra = {}) {
    await journal().insertOne({
        guildId, kind, userId, targetId: targetId || null,
        amount: value, ...extra, createdAt: new Date()
    }, { session });
}

async function moveMoney(guildId, userId, kind, value) {
    const n = amount(value);
    if (n < 1) fail("Amount must be at least 1.");
    const from = kind === "deposit" ? "cash" : "bank";
    const to = kind === "deposit" ? "bank" : "cash";
    if (kind !== "deposit" && kind !== "withdraw") fail("Unknown transfer.");

    return inTransaction(async session => {
        await setupAccount(guildId, userId, session);
        const updated = await accounts().updateOne({
            _id: id(guildId, userId),
            [from]: { $gte: n },
            [to]: { $lte: MAX_BALANCE - n }
        }, { $inc: { [from]: -n, [to]: n } }, { session });
        if (updated.modifiedCount !== 1) fail("Insufficient funds or balance limit exceeded.");
        await log(session, guildId, kind, userId, null, n);
        return accounts().findOne({ _id: id(guildId, userId) }, { session });
    });
}

async function pay(guildId, fromId, toId, value) {
    const n = amount(value);
    if (n < 1) fail("Amount must be at least 1.");
    if (fromId === toId) fail("You cannot pay yourself.");
    await inTransaction(async session => {
        await setupAccount(guildId, fromId, session);
        await setupAccount(guildId, toId, session);
        const debit = await accounts().updateOne({
            _id: id(guildId, fromId), cash: { $gte: n }
        }, { $inc: { cash: -n } }, { session });
        if (!debit.modifiedCount) fail("Not enough cash.");
        const credit = await accounts().updateOne({
            _id: id(guildId, toId), cash: { $lte: MAX_BALANCE - n }
        }, { $inc: { cash: n } }, { session });
        if (!credit.modifiedCount) fail("Recipient has reached the cash limit.");
        await log(session, guildId, "pay", fromId, toId, n);
    });
    return n;
}
async function earn(guildId, userId, kind) {
    if (!["daily", "work"].includes(kind)) fail("Unknown reward.");
    const cfg = await getSettings(guildId);
    const reward = kind === "daily" ? cfg.dailyReward : cfg.workReward;
    const cooldown = kind === "daily" ? DAILY_MS : WORK_MS;
    const field = kind + "At";
    return inTransaction(async session => {
        await setupAccount(guildId, userId, session);
        const now = new Date();
        const lastAllowed = new Date(now.getTime() - cooldown);
        const update = await accounts().updateOne({
            _id: id(guildId, userId),
            [field]: { $lte: lastAllowed },
            cash: { $lte: MAX_BALANCE - reward }
        }, {
            $inc: { cash: reward },
            $set: { [field]: now }
        }, { session });
        if (!update.modifiedCount) {
            const profile = await accounts().findOne(
                { _id: id(guildId, userId) }, { session }
            );
            const nextAt = new Date(
                new Date(profile?.[field] || 0).getTime() + cooldown
            );
            fail("Not available yet. Next reward: <t:" +
                Math.floor(nextAt.getTime() / 1000) + ":R>.");
        }
        await log(session, guildId, kind, userId, null, reward);
        return reward;
    });
}

async function adjustMoney(guildId, userId, mode, kind, value, actorId) {
    const n = amount(value);
    if (!["cash", "bank"].includes(kind)) fail("Unknown balance.");
    if (!["add", "remove", "set"].includes(mode)) fail("Unknown action.");
    return inTransaction(async session => {
        await setupAccount(guildId, userId, session);
        const current = await accounts().findOne(
            { _id: id(guildId, userId) }, { session }
        );
        const next = mode === "set" ? n :
            mode === "add" ? current[kind] + n :
                current[kind] - n;
        if (next < 0 || next > MAX_BALANCE) fail("Balance out of range.");
        const applied = await accounts().updateOne({
            _id: id(guildId, userId),
            [kind]: current[kind]
        }, { $set: { [kind]: next } }, { session });
        if (!applied.matchedCount) fail("Balance changed. Try again.");
        await log(session, guildId, "staff_" + mode, actorId, userId, n, {
            balanceType: kind
        });
        return next;
    });
}
async function setSetting(guildId, setting, value) {
    const allowed = {
        currency: typeof value === "string" &&
            value.length <= 12 && value.length > 0,
        dailyReward: Number.isInteger(value) && value >= 0 &&
            value <= MAX_AMOUNT,
        workReward: Number.isInteger(value) && value >= 0 &&
            value <= MAX_AMOUNT,
        sellPercent: Number.isInteger(value) && value >= 0 && value <= 100
    };
    if (!Object.prototype.hasOwnProperty.call(allowed, setting) ||
        !allowed[setting]) fail("Invalid economy setting.");
    await settings().updateOne(
        { _id: guildId },
        { $set: { [setting]: value, updatedAt: new Date() } },
        { upsert: true }
    );
}

async function createItem(guildId, info) {
    const key = slug(info.name);
    if (!key || key.length < 2) fail("Item name must use letters or numbers.");
    const price = amount(info.price);
    if (price < 1) fail("Item price must be at least 1.");
    const type = info.type || "collectible";
    if (!["collectible", "consumable", "role"].includes(type)) {
        fail("Invalid item type.");
    }
    if (type === "role" && !/^\d{17,20}$/.test(info.roleId || "")) {
        fail("Role items require a Discord role.");
    }
    const document = {
        _id: itemId(guildId, info.name),
        guildId, key, name: String(info.name).slice(0, 70),
        description: String(info.description || "").slice(0, 500),
        category: String(info.category || "General").slice(0, 40),
        price, type,
        roleId: type === "role" ? info.roleId : null,
        stock: info.stock ?? null,
        createdAt: new Date(),
        enabled: true
    };
    try {
        await catalog().insertOne(document);
    } catch (error) {
        if (error.code === 11000) fail("An item with that name already exists.");
        throw error;
    }
    return document;
}
async function listItems(guildId) {
    return catalog().find({ guildId, enabled: true })
        .sort({ category: 1, price: 1 }).limit(100).toArray();
}
async function getItem(guildId, key) {
    return catalog().findOne({ _id: itemId(guildId, key) });
}
async function getInventory(guildId, userId) {
    return inventory().find({ guildId, userId, quantity: { $gt: 0 } })
        .sort({ updatedAt: -1 }).limit(100).toArray();
}

async function buy(guildId, userId, itemKey, quantity) {
    const qty = Number(quantity);
    if (!Number.isSafeInteger(qty) || qty < 1 || qty > 50) {
        fail("Quantity must be between 1 and 50.");
    }
    return inTransaction(async session => {
        const item = await catalog().findOne({
            _id: itemId(guildId, itemKey), enabled: true
        }, { session });
        if (!item) fail("Item is not on sale.");
        if (item.stock !== null && item.stock < qty) fail("Not enough stock.");
        const cost = item.price * qty;
        if (!Number.isSafeInteger(cost) || cost > MAX_BALANCE) {
            fail("Purchase exceeds the balance limit.");
        }
        await setupAccount(guildId, userId, session);
        const debit = await accounts().updateOne({
            _id: id(guildId, userId), cash: { $gte: cost }
        }, { $inc: { cash: -cost } }, { session });
        if (!debit.modifiedCount) fail("Not enough cash in your wallet.");
        if (item.stock !== null) {
            const stock = await catalog().updateOne({
                _id: item._id, enabled: true, stock: { $gte: qty }
            }, { $inc: { stock: -qty } }, { session });
            if (!stock.modifiedCount) fail("Item sold out.");
        }
        await inventory().updateOne(
            { _id: id(guildId, userId) + ":" + item.key },
            {
                $setOnInsert: {
                    guildId, userId, itemKey: item.key,
                    itemName: item.name, itemType: item.type,
                    roleId: item.roleId, purchasePrice: item.price,
                    createdAt: new Date()
                },
                $inc: { quantity: qty },
                $set: { updatedAt: new Date() }
            }, { upsert: true, session }
        );
        await log(session, guildId, "buy", userId, null, cost, {
            itemKey: item.key, quantity: qty
        });
        return { item, quantity: qty, cost };
    });
}
async function sell(guildId, userId, itemKey, quantity) {
    const qty = Number(quantity);
    if (!Number.isSafeInteger(qty) || qty < 1 || qty > 50) {
        fail("Quantity must be between 1 and 50.");
    }
    return inTransaction(async session => {
        const item = await catalog().findOne(
            { _id: itemId(guildId, itemKey) }, { session }
        );
        if (!item) fail("Item does not exist anymore.");
        const cfg = await settings().findOne({ _id: guildId }, { session });
        const sellPercent = cfg?.sellPercent ?? 50;
        const reward = Math.floor(item.price * qty * sellPercent / 100);
        const removed = await inventory().updateOne({
            _id: id(guildId, userId) + ":" + item.key,
            quantity: { $gte: qty }
        }, { $inc: { quantity: -qty } }, { session });
        if (!removed.modifiedCount) fail("Not enough items in inventory.");
        await setupAccount(guildId, userId, session);
        const credit = await accounts().updateOne({
            _id: id(guildId, userId),
            cash: { $lte: MAX_BALANCE - reward }
        }, { $inc: { cash: reward } }, { session });
        if (!credit.modifiedCount) fail("Wallet is full.");
        if (item.stock !== null) {
            await catalog().updateOne(
                { _id: item._id }, { $inc: { stock: qty } }, { session }
            );
        }
        await log(session, guildId, "sell", userId, null, reward, {
            itemKey: item.key, quantity: qty
        });
        return { item, quantity: qty, reward };
    });
}

async function useItem(guildId, userId, itemKey) {
    return inTransaction(async session => {
        const item = await catalog().findOne(
            { _id: itemId(guildId, itemKey) }, { session }
        );
        if (!item) fail("Item no longer exists.");
        if (item.type === "collectible") {
            fail("This is a collectible. It cannot be used.");
        }
        if (item.type === "role") {
            // Role assignment needs Discord permissions and must
            // be coordinated by the command before consumption.
            fail("Role items use the dedicated role redemption action.");
        }
        const consumed = await inventory().updateOne({
            _id: id(guildId, userId) + ":" + item.key,
            quantity: { $gte: 1 }
        }, { $inc: { quantity: -1 } }, { session });
        if (!consumed.modifiedCount) fail("You do not own this item.");
        await log(session, guildId, "use", userId, null, 0, {
            itemKey: item.key
        });
        return item;
    });
}

async function redeemRole(guildId, userId, itemKey, member) {
    const item = await getItem(guildId, itemKey);
    if (!item || item.type !== "role" || !item.roleId) {
        fail("This is not a role item.");
    }
    if (member.roles.cache.has(item.roleId)) {
        fail("You already have this role.");
    }
    const role = await member.guild.roles.fetch(item.roleId);
    if (!role || role.managed || role.id === guildId) {
        fail("The configured role is not assignable.");
    }
    const bot = await member.guild.members.fetchMe();
    if (role.position >= bot.roles.highest.position) {
        fail("The bot's highest role must be above the shop role.");
    }
    const owned = await inventory().findOne({
        _id: id(guildId, userId) + ":" + item.key,
        quantity: { $gte: 1 }
    });
    if (!owned) fail("You do not own this role item.");

    // Assign role first. If the DB decrement fails, reverse it.
    await member.roles.add(role, "Redeemed shop item " + item.name);
    try {
        await inTransaction(async session => {
            const decrement = await inventory().updateOne({
                _id: id(guildId, userId) + ":" + item.key,
                quantity: { $gte: 1 }
            }, { $inc: { quantity: -1 } }, { session });
            if (!decrement.modifiedCount) fail("Item already redeemed.");
            await log(session, guildId, "redeem_role", userId, null, 0, {
                itemKey: item.key, roleId: item.roleId
            });
        });
    } catch (error) {
        await member.roles.remove(
            role, "Shop redemption failed"
        ).catch(() => {});
        throw error;
    }
    return item;
}


const STEAL_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const GAME_COOLDOWN_MS = 10 * 60 * 1000;

async function stealCoins(guildId, thiefId, victimId) {
    if (thiefId === victimId) fail("You cannot steal from yourself.");
    return inTransaction(async session => {
        await setupAccount(guildId, thiefId, session);
        await setupAccount(guildId, victimId, session);
        const now = new Date();
        const validSince = new Date(now.getTime() - STEAL_COOLDOWN_MS);
        const thief = await accounts().findOne(
            { _id: id(guildId, thiefId) }, { session }
        );
        const victim = await accounts().findOne(
            { _id: id(guildId, victimId) }, { session }
        );
        if (new Date(thief.stealAt || 0) > validSince) {
            const next = Math.floor(
                (new Date(thief.stealAt).getTime() +
                 STEAL_COOLDOWN_MS) / 1000
            );
            fail("Try again <t:" + next + ":R>.");
        }
        const eligible = Math.max(0, Math.floor(victim.cash || 0));
        if (!eligible) fail("This member has no wallet coins.");
        const max = Math.min(100, eligible, Math.max(1, Math.floor(eligible * 0.2)));
        const n = 1 + Math.floor(Math.random() * max);
        const cooldown = await accounts().updateOne({
            _id: id(guildId, thiefId),
            $or: [
                { stealAt: { $lte: validSince } },
                { stealAt: { $exists: false } }
            ],
            cash: { $lte: MAX_BALANCE - n }
        }, {
            $set: { stealAt: now },
            $inc: { cash: n }
        }, { session });
        if (!cooldown.modifiedCount) fail("You are on cooldown or your wallet is full.");
        const removed = await accounts().updateOne({
            _id: id(guildId, victimId),
            cash: { $gte: n }
        }, { $inc: { cash: -n } }, { session });
        if (!removed.modifiedCount) fail("Target balance changed. Try again later.");
        await log(session, guildId, "steal", thiefId, victimId, n);
        return n;
    });
}

async function playGame(guildId, userId, answer) {
    if (!["1","2","3"].includes(answer)) fail("Answer must be 1, 2, or 3.");
    // Simple knowledge quiz, no currency is put at risk.
    const questions = [
        { question: "How many sides does a hexagon have?", correct: "2",
          choices: ["1. Five", "2. Six", "3. Seven"] },
        { question: "Which planet is known as the Red Planet?", correct: "3",
          choices: ["1. Venus", "2. Jupiter", "3. Mars"] },
        { question: "How many bits are in a byte?", correct: "1",
          choices: ["1. Eight", "2. Four", "3. Twelve"] },
        { question: "Which is the largest planet?", correct: "2",
          choices: ["1. Earth", "2. Jupiter", "3. Neptune"] }
    ];
    // Each user receives a stable question for each 10-minute
    // period; the correct answer is never accepted twice.
    const slot = Math.floor(Date.now() / GAME_COOLDOWN_MS);
    const index = Math.abs(
        Array.from(userId + ":" + slot).reduce((x,ch) =>
            (Math.imul(x, 31) + ch.charCodeAt(0)) | 0, 0)
    ) % questions.length;
    const challenge = questions[index];
    return inTransaction(async session => {
        await setupAccount(guildId, userId, session);
        const now = new Date();
        const since = new Date(now.getTime() - GAME_COOLDOWN_MS);
        const isCorrect = answer === challenge.correct;
        const reward = isCorrect ? 50 : 0;
        const claim = await accounts().updateOne({
            _id: id(guildId, userId),
            $or: [
                { playAt: { $lte: since } },
                { playAt: { $exists: false } }
            ],
            cash: { $lte: MAX_BALANCE - reward }
        }, {
            $set: { playAt: now },
            $inc: { cash: reward }
        }, { session });
        if (!claim.modifiedCount) fail("Wait 10 minutes between games.");
        await log(session, guildId, "game", userId, null, reward, {
            answer, correct: isCorrect
        });
        return { ...challenge, isCorrect, reward };
    });
}

function getGameQuestion(userId) {
    const slot = Math.floor(Date.now() / GAME_COOLDOWN_MS);
    const questions = [
        { question: "How many sides does a hexagon have?",
          choices: ["1. Five", "2. Six", "3. Seven"] },
        { question: "Which planet is known as the Red Planet?",
          choices: ["1. Venus", "2. Jupiter", "3. Mars"] },
        { question: "How many bits are in a byte?",
          choices: ["1. Eight", "2. Four", "3. Twelve"] },
        { question: "Which is the largest planet?",
          choices: ["1. Earth", "2. Jupiter", "3. Neptune"] }
    ];
    const idx = Math.abs(
        Array.from(userId + ":" + slot).reduce((x,ch) =>
            (Math.imul(x, 31) + ch.charCodeAt(0)) | 0, 0)
    ) % questions.length;
    return questions[idx];
}

async function top(guildId) {
    return accounts().aggregate([
        { $match: { guildId } },
        { $addFields: { total: { $add: ["$cash", "$bank"] } } },
        { $sort: { total: -1 } },
        { $limit: 10 }
    ]).toArray();
}

module.exports = {
    MAX_AMOUNT, MAX_BALANCE,
    slug, id, itemId, accounts, catalog, inventory, journal,
    getAccount, getSettings, getItem, getInventory, listItems,
    moveMoney, pay, earn, adjustMoney, setSetting,
    createItem, buy, sell, useItem, redeemRole, top,
    stealCoins, playGame, getGameQuestion
};
