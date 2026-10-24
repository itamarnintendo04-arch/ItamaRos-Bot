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
