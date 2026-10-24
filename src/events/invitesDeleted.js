"use strict";

const { Events } = require("discord.js");
const { forgetDeletedInvite } = require("../systems/invites/tracker");

module.exports = {
    name: Events.InviteDelete,
    async execute(invite) {
        forgetDeletedInvite(invite);
    }
};
