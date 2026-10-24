"use strict";

const { Events } = require("discord.js");
const {
    isTrackedGuild,
    processMemberJoin
} = require("../systems/invites/tracker");
const { sendWelcome } = require("../systems/invites/welcome");

module.exports = {
    name: Events.GuildMemberAdd,
    async execute(member) {
        if (!isTrackedGuild(member.guild.id) || member.user.bot) {
            return;
        }

        let attribution;
        try {
            attribution = await processMemberJoin(member);
        } catch (error) {
            console.error(
                "[Invites] Failed to attribute new member:",
                error
            );

            attribution = {
                inviterId: null,
                inviteCode: null,
                theirInvites: 0,
                inviterInvites: null
            };
        }

        await sendWelcome(member, attribution);
    }
};
