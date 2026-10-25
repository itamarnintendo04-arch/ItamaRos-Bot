"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { data: tomorrowCommand } =
    require("../src/systems/dailyQuestion/tomorrowCommand");
const { data: streakCommand } =
    require("../src/systems/dailyQuestion/streakCommand");
const { data: dashboardCommand } =
    require("../src/systems/dashboard/command");

const { TICKET_TYPES, getPublicTicketTypes } =
    require("../src/systems/tickets/config");
const {
    buildTicketModal
} = require("../src/systems/tickets/forms");
const { buildTicketPanel } =
    require("../src/systems/tickets/panel");
const { buildWelcomeEmbed } =
    require("../src/systems/tickets/create");

test("server questions and Daily Quiz help have their own required question fields", () => {
    for (const type of [
        TICKET_TYPES.SERVER_QUESTIONS,
        TICKET_TYPES.DAILY_QUIZ_HELP,
        TICKET_TYPES.BUG_REPORT,
        TICKET_TYPES.SUGGESTION
    ]) {
        assert.equal(type.publicEnabled, true);
        assert.equal(type.fields[0].id, "question");
        assert.equal(type.fields[0].required, true);
        const modal = buildTicketModal(type.id).toJSON();
        assert.match(modal.title, /./);
        assert.ok(modal.components.length >= 1);
    }
});

test("automatic prize claim tickets cannot be opened from the public panel", () => {
    assert.equal(TICKET_TYPES.DAILY_QUIZ_REWARD.publicEnabled, false);
    assert.equal(TICKET_TYPES.GIVEAWAY.publicEnabled, false);
    assert.ok(!getPublicTicketTypes().some(x =>
        x.id === TICKET_TYPES.DAILY_QUIZ_REWARD.id));
    assert.throws(() => buildTicketModal("daily_quiz_reward"), /GIVEAWAY_RESTRICTED/);
    assert.throws(() => buildTicketModal("giveaway"), /GIVEAWAY_RESTRICTED/);
    const panel = buildTicketPanel();
    const options = panel.components[0].components[0].toJSON().options;
    assert.ok(options.some(x => x.value === "server_questions"));
    assert.ok(options.some(x => x.value === "daily_quiz_help"));
    assert.ok(!options.some(x => x.value === "daily_quiz_reward"));
});

test("streak duration is optional on tomorrow quiz command and manager-only", () => {
    const d = tomorrowCommand.toJSON();
    assert.ok(d.default_member_permissions != null);
    const option = d.options.find(item => item.name === "streak_days");
    assert.ok(option);
    assert.equal(option.min_value, 2);
    assert.equal(option.max_value, 30);
    assert.equal(option.required, false);
});

test("streak and dashboard command builders expose manager-only commands", () => {
    for (const command of [streakCommand, dashboardCommand]) {
        const data = command.toJSON();
        assert.ok(data.default_member_permissions != null);
        assert.ok(data.options.length >= 2);
    }
});

test("new ticket embeds present the exact question from each English form", () => {
    const fields = [
        [TICKET_TYPES.SERVER_QUESTIONS,
            { question: "Where do I find the server rules?" },
            "What is your question about the server?"],
        [TICKET_TYPES.DAILY_QUIZ_HELP,
            { question: "How do Daily Quiz streaks work?" },
            "What is your daily quiz question?"],
        [TICKET_TYPES.BUG_REPORT,
            { question: "Buttons do not work" },
            "What is not working?"],
        [TICKET_TYPES.SUGGESTION,
            { question: "Please add community events" },
            "What would you like to suggest?"]
    ];
    for (const [type, answers, expected] of fields) {
        const embed = buildWelcomeEmbed(
            type, "123456789012345678", answers, "test-session",
            "876543210987654321"
        ).toJSON();
        assert.ok(embed.description.includes(expected),
            "Missing form question for " + type.id);
        assert.ok(embed.description.includes(answers.question));
    }
});
