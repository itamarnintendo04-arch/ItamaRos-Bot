"use strict";

const { Events } = require("discord.js");
const { rememberCreatedInvite } = require("../systems/invites/tracker");

module.exports = {
    name: Events.InviteCreate,
    async execute(invite) {
        rememberCreatedInvite(invite);
    }
};
