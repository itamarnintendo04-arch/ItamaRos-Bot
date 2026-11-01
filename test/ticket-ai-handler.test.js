"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

test("AI continues ticket discussions without mentions, but ignores uninvolved members", async () => {
    const database = require("../database");
    const originalGetDatabase = database.getDatabase;
    const originalNow = Date.now;

    const userId = "111111111111111111";
    const botId = "999999999999999999";
    let clock = 1_000_000;
    let ticketIsOpen = true;
    const answers = [];
    const questions = [];

    database.getDatabase = () => ({
        collection: name => {
            assert.equal(name, "tickets");
            return {
                findOne: async query => ticketIsOpen &&
                    query.guildId === "guild-1" &&
                    query.channelId === "ticket-1" &&
                    query.status === "open"
                    ? {
                        _id: "ticket-record",
                        guildId: "guild-1",
                        channelId: "ticket-1",
                        type: "server_questions",
                        typeLabel: "General Server Questions",
                        status: "open",
                        userId,
                        createdAt: new Date(0),
                        answers: {}
                    }
                    : null
            };
        }
    });
    Date.now = () => clock;

    try {
        delete require.cache[require.resolve("../src/systems/ai/mentionHandler")];
        const { createAiMentionHandler } = require("../src/systems/ai/mentionHandler");
        const handle = createAiMentionHandler({
            generateReply: async ({ question }) => {
                questions.push(question);
                return "Answer " + questions.length + " to: " + question;
            }
        });

        const makeMessage = ({ authorId = userId, mention = false, content = "" } = {}) => ({
            guild: {
                id: "guild-1",
                name: "ItamaRos",
                roles: { everyone: { id: "everyone" } },
                channels: { cache: new Map() }
            },
            channel: {
                id: "ticket-1",
                sendTyping: async () => {},
                messages: { fetch: async () => new Map() }
            },
            id: "message-" + (answers.length + 1),
            client: { user: { id: botId } },
            author: { id: authorId, bot: false },
            member: {},
            webhookId: null,
            mentions: { users: { has: id => mention && id === botId } },
            content,
            reply: async payload => {
                answers.push(payload);
                return { id: "reply-" + answers.length };
            }
        });

        assert.equal(await handle(makeMessage({
            mention: true,
            content: "<@" + botId + "> How can I get XP?"
        })), true);
        assert.equal(questions.length, 1);
        assert.match(answers[0].content, /Answer 1/);

        clock += 6000;
        assert.equal(await handle(makeMessage({ content: "And how about giveaways?" })), true);
        assert.equal(questions[1], "And how about giveaways?");
        assert.match(answers[1].content, /Answer 2/);

        clock += 6000;
        assert.equal(await handle(makeMessage({
            authorId: "222222222222222222", content: "Staff are discussing this."
        })), false);
        assert.equal(answers.length, 2);

        // A session expires 30 minutes after the most recent AI reply.
        clock += 30 * 60 * 1000 + 1;
        assert.equal(await handle(makeMessage({ content: "Are you there?" })), false);

        // Explicit mention reactivates the discussion.
        assert.equal(await handle(makeMessage({
            mention: true, content: "<@" + botId + "> Continue please"
        })), true);
        assert.equal(answers.length, 3);

        ticketIsOpen = false;
        clock += 6000;
        assert.equal(await handle(makeMessage({ content: "Can we continue?" })), false);
        ticketIsOpen = true;
        assert.equal(await handle(makeMessage({ content: "No new mention" })), false);
    } finally {
        database.getDatabase = originalGetDatabase;
        Date.now = originalNow;
        delete require.cache[require.resolve("../src/systems/ai/mentionHandler")];
    }
});
