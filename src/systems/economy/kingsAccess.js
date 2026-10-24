"use strict";

const { PermissionFlagsBits } = require("discord.js");
const { getDatabase } = require("../../../database");
const { getLevel } = require("../xp/service");
const { tierForXp, MAX_RANK, baseKingsRole } = require("../kings/ranks");

const MAX_KINGS_LEVEL = MAX_RANK;

function isStaff(member) {
    return Boolean(member?.permissions?.has(PermissionFlagsBits.ManageGuild) ||
        member?.permissions?.has(PermissionFlagsBits.Administrator));
}

async function getKingsRoleId(guild) {
    return (await baseKingsRole(guild))?.id || null;
}

function kingsOnly(item) {
    return item?.kingsOnly === true;
}

function minLevel(item) {
    const level = item?.minKingsLevel ?? 1;
    return Number.isSafeInteger(level) ? Math.max(0, level) : 0;
}

function availableTo(item, access) {
    if (!kingsOnly(item)) return true;
    if (access.staff) return true;
    return access.king && access.level >= minLevel(item);
}

async function getAccess(guild, userId) {
    const member = await guild.members.fetch({ user: userId, force: true });
    if (isStaff(member)) {
        return { staff: true, king: true, level: MAX_KINGS_LEVEL };
    }

    const roleId = await getKingsRoleId(guild);
    const king = Boolean(roleId && member.roles.cache.has(roleId));
    if (!king) return { staff: false, king: false, level: 0 };

    const xpLevel = await getLevel(guild.id, userId);
    return { staff: false, king: true, level: tierForXp(xpLevel * 200) };
}

async function assertCanAccess(guild, userId, item) {
    if (!kingsOnly(item)) return;
    const access = await getAccess(guild, userId);
    if (!availableTo(item, access)) {
        throw new Error(
            "This product is only available to Kings at rank " +
            minLevel(item) + " or higher."
        );
    }
}

function visibleItems(items, access) {
    return items.filter(item => availableTo(item, access));
}

module.exports = {
    MAX_KINGS_LEVEL,
    isStaff,
    kingsOnly,
    minLevel,
    availableTo,
    getAccess,
    assertCanAccess,
    visibleItems
};
