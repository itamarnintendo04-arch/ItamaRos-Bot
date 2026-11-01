"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
    createAiProvider,
    buildModelRequest,
    isRepetitiveReply,
    SERVER_ONLY_REPLY
} = require("../src/systems/ai/provider");
const {
    conversationContext,
    serverContext
} = require("../src/systems/ai/ticketContext");
const { ChannelType } = require("discord.js");

const ticket = {
    type: "report",
    typeLabel: "Report a member",
    formAnswers: [{ field: "Reason", answer: "Need staff help" }],
    recentMessages: [
        { speaker: "Ticket opener", text: "How do giveaways work?" },
        {
            speaker: "AI assistant",
            text: "Giveaway winners receive a private ticket and staff handle the prize claim."
        },
        { speaker: "Ticket opener", text: "And where do I go next?" }
    ],
    server: {
        name: "ItamaRos Community",
        publicChannels: ["announcements", "general"],
        ticketCategories: ["Report a member", "General Server Questions"],
        knownFeatures: ["Giveaways and winner tickets"]
    }
};

test("AI instructions allow general server questions from any ticket type", async () => {
    const request = buildModelRequest("How do giveaways work?", ticket);
    const payload = JSON.parse(request.userMessage);
    assert.equal(payload.publicServerInformation.name, "ItamaRos Community");
    assert.equal(payload.recentTicketConversation[1].speaker, "AI assistant");
    assert.match(request.systemInstruction, /ANY question about this ItamaRos Discord server/);
    assert.doesNotMatch(request.systemInstruction, /STRICT TICKET CATEGORY BOUNDARY/);

    const provider = createAiProvider({
        generateText: async () => JSON.stringify({
            inScope: true,
            reply: "You can join eligible giveaways in their announcements."
        }),
        useOfflineFallback: false
    });
    assert.match(
        await provider.generateReply({ question: "How do giveaways work?", ticket: { ...ticket, recentMessages: [] } }),
        /eligible giveaways/
    );
});

test("repetition detector notices repeated AI text, not unrelated answers", () => {
    const history = [
        { speaker: "AI assistant", text: "Giveaway winners receive a private ticket and staff handle the prize claim." },
        { speaker: "Ticket opener", text: "Thanks" }
    ];
    assert.equal(
        isRepetitiveReply("Giveaway winners receive a private ticket and staff handle the prize claim.", history),
        true
    );
    assert.equal(
        isRepetitiveReply("Please give staff your giveaway message link if they request it.", history),
        false
    );
});

test("AI retries once when an answer is nearly identical to a previous reply", async () => {
    let calls = 0;
    const provider = createAiProvider({
        generateText: async request => {
            calls++;
            if (calls === 1) {
                return JSON.stringify({
                    inScope: true,
                    reply: "Giveaway winners receive a private ticket and staff handle the prize claim."
                });
            }
            assert.match(request.systemInstruction, /first answer repeated/);
            return JSON.stringify({
                inScope: true,
                reply: "Ask a staff member in the winner ticket about the next claim step."
            });
        },
        useOfflineFallback: false
    });
    assert.match(
        await provider.generateReply({ question: "And where do I go next?", ticket }),
        /next claim step/
    );
    assert.equal(calls, 2);
});

test("unrelated general questions are still outside the server assistant scope", async () => {
    const provider = createAiProvider({
        generateText: async () => { throw Error("Must not call model"); },
        useOfflineFallback: false
    });
    assert.equal(
        await provider.generateReply({ question: "Explain calculus homework", ticket }),
        SERVER_ONLY_REPLY
    );
});

test("ticket history includes AI answers but excludes unrelated bots", async () => {
    const userId = "111111111111111111", botId = "999999999999999999";
    const old = 1740000000000;
    const create = (id, author, content, extra = {}) => ({
        id, author, content, createdTimestamp: old + Number(id),
        guild: { ownerId: "333333333333333333" },
        attachments: new Map(),
        ...extra
    });
    const records = [
        create("1", { id: userId, bot: false }, "I have a question"),
        create("2", { id: botId, bot: true },
            "<@" + userId + ">\n\nThe bot replied with useful context.",
            { reference: { messageId: "1" } }),
        create("3", { id: "888888888888888888", bot: true },
            "Unrelated automatic notification")
    ];
    const message = {
        id: "4",
        client: { user: { id: botId } },
        channel: { messages: { fetch: async () =>
            new Map(records.map(entry => [entry.id, entry])) } }
    };
    const previous = await conversationContext(message, {
        createdAt: new Date(old - 1000),
        userId,
        claimedBy: null
    });
    assert.deepEqual(previous.map(item => item.speaker),
        ["Ticket opener", "AI assistant"]);
    assert.match(previous[1].text, /useful context/);
    assert.doesNotMatch(previous[1].text, /<@/);
});

test("public server snapshot never includes private channels", () => {
    const visibleChannel = (name, publicAccess) => ({
        name,
        type: ChannelType.GuildText,
        position: 1,
        permissionsFor: () => ({ has: () => publicAccess })
    });
    const guild = {
        name: "ItamaRos",
        memberCount: 50,
        roles: { everyone: { id: "everyone" } },
        channels: { cache: new Map([
            ["1", visibleChannel("general", true)],
            ["2", visibleChannel("private-staff", false)]
        ]) }
    };
    const snapshot = serverContext({ guild, member: { id: "member" } });
    assert.deepEqual(snapshot.publicChannels, ["general"]);
    assert.equal(snapshot.memberCount, 50);
});
