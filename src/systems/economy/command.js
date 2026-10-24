"use strict";
const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const eco = require("./service");

const data = new SlashCommandBuilder()
 .setName("economy").setDescription("Server economy: money, bank, earnings")
 .setDMPermission(false);

data.addSubcommand(s => s.setName("balance").setDescription("Show wallet and bank")
 .addUserOption(o => o.setName("member").setDescription("Member").setRequired(false)));
data.addSubcommand(s => s.setName("daily").setDescription("Claim a daily coin reward"));
data.addSubcommand(s => s.setName("work").setDescription("Work for virtual coins"));
for (const action of ["deposit", "withdraw"]) {
 data.addSubcommand(s => s.setName(action).setDescription(action + " bank funds")
  .addIntegerOption(o => o.setName("amount").setDescription("Coins")
   .setMinValue(1).setMaxValue(eco.MAX_AMOUNT).setRequired(true)));
}
data.addSubcommand(s => s.setName("pay").setDescription("Transfer coins to someone")
 .addUserOption(o => o.setName("member").setDescription("Recipient").setRequired(true))
 .addIntegerOption(o => o.setName("amount").setDescription("Coins")
  .setMinValue(1).setMaxValue(eco.MAX_AMOUNT).setRequired(true)));
data.addSubcommand(s => s.setName("leaderboard").setDescription("Wealth rankings"));
data.addSubcommand(s => s.setName("steal").setDescription("Try to take a random number of virtual coins")
 .addUserOption(o => o.setName("member").setDescription("Target player")
  .setRequired(true)));
data.addSubcommand(s => s.setName("quiz").setDescription("Play trivia to earn coins")
 .addStringOption(o => o.setName("answer")
  .setDescription("Choose 1, 2 or 3 from /economy question")
  .setRequired(true).addChoices(
   {name:"1",value:"1"},{name:"2",value:"2"},{name:"3",value:"3"}
  )));
data.addSubcommand(s => s.setName("question").setDescription("View today's quiz question"));

const fmt = (n, symbol) => Number(n || 0).toLocaleString("en-US") + " " + symbol;

async function execute(interaction) {
 if (!interaction.inGuild()) {
  return interaction.reply({content:"Server only.",flags:MessageFlags.Ephemeral});
 }
 await interaction.deferReply({flags:MessageFlags.Ephemeral});
 try {
  const guild = interaction.guildId, user = interaction.user;
  const action = interaction.options.getSubcommand();
  const symbol = (await eco.getSettings(guild)).currency;
  let answer = "";
  if (action === "balance") {
   const target = interaction.options.getUser("member") || user;
   const acc = await eco.getAccount(guild,target.id);
   answer = "🪙 **Wallet of <@" + target.id + ">**\n"+
    "**Cash:** " + fmt(acc.cash,symbol) + "\n**Bank:** " +
    fmt(acc.bank,symbol) + "\n**Total:** " + fmt(acc.cash+acc.bank,symbol);
  } else if (action === "daily" || action === "work") {
   const earned = await eco.earn(guild,user.id,action);
   answer = "✅ Earned **" + fmt(earned,symbol) + "**!";
  } else if (action === "deposit" || action === "withdraw") {
   const n = interaction.options.getInteger("amount",true);
   const acc = await eco.moveMoney(guild,user.id,action,n);
   answer = "✅ " + action + " completed.\nCash: " +
    fmt(acc.cash,symbol) + "\nBank: " + fmt(acc.bank,symbol);
  } else if (action === "pay") {
   const target = interaction.options.getUser("member",true);
   if (target.bot) throw Error("Cannot pay bots.");
   const n = interaction.options.getInteger("amount",true);
   await eco.pay(guild,user.id,target.id,n);
   answer = "✅ Sent **" + fmt(n,symbol) + "** to <@" + target.id + ">.";
  } else if (action === "steal") {
   const target = interaction.options.getUser("member",true);
   if (target.bot || user.bot) throw Error("Bots cannot participate in the economy.");
   const amount = await eco.stealCoins(guild,user.id,target.id);
   answer = "🕵️ You stole **"+fmt(amount,symbol)+"** of virtual coins from <@"+target.id+">.";
  } else if (action === "question") {
   const q = eco.getGameQuestion(user.id);
   answer = "🧩 **Trivia Game**\n\n"+q.question+"\n"+
    q.choices.join("\n")+"\n\nUse /economy quiz with your answer. No coins are wagered.";
  } else if (action === "quiz") {
   const result = await eco.playGame(guild,user.id,interaction.options.getString("answer",true));
   answer = result.isCorrect
    ? "🎉 Correct! You earned **"+fmt(result.reward,symbol)+"**!"
    : "Not quite! The right answer was **"+result.correct+"**. Try again in 10 minutes.";
  } else if (action === "leaderboard") {
   const list = await eco.top(guild);
   answer = "🏆 **Richest Members**\n\n" +
    (list.map((x,i)=> (i+1)+". <@"+x.userId+"> — "+
      fmt(x.total,symbol)).join("\n") || "No accounts yet.");
  }
  await interaction.editReply({content:answer,allowedMentions:{parse:[]}});
 } catch(error) {
  console.error("[Economy]",error);
  await interaction.editReply({content:"❌ "+String(error.message).slice(0,200),
    allowedMentions:{parse:[]}}).catch(()=>{});
 }
}
module.exports = {data,execute};
