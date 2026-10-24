"use strict";
const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const eco = require("./service");
const data = new SlashCommandBuilder().setName("store")
 .setDescription("Shop for virtual items").setDMPermission(false);
data.addSubcommand(s => s.setName("list").setDescription("Browse shop items"));
data.addSubcommand(s => s.setName("inventory").setDescription("View virtual items")
 .addUserOption(o => o.setName("member").setDescription("Member").setRequired(false)));
data.addSubcommand(s => s.setName("info").setDescription("Item details")
 .addStringOption(o => o.setName("item").setDescription("Item name").setRequired(true)));
for (const action of ["buy","sell"]) {
 data.addSubcommand(s => s.setName(action).setDescription(action + " shop items")
  .addStringOption(o => o.setName("item").setDescription("Item name").setRequired(true))
  .addIntegerOption(o => o.setName("quantity").setDescription("Quantity")
   .setMinValue(1).setMaxValue(50).setRequired(false)));
}
data.addSubcommand(s => s.setName("use").setDescription("Use an item or redeem a role")
 .addStringOption(o => o.setName("item").setDescription("Item name").setRequired(true)));
const fmt = (value,symbol) => Number(value||0).toLocaleString("en-US")+" "+symbol;
async function execute(interaction) {
 if (!interaction.inGuild()) return interaction.reply({
  content:"Server-only command.",flags:MessageFlags.Ephemeral
 });
 await interaction.deferReply({flags:MessageFlags.Ephemeral});
 try {
  const guildId=interaction.guildId;
  const action=interaction.options.getSubcommand();
  const userId=interaction.user.id;
  const currency=(await eco.getSettings(guildId)).currency;
  const key=interaction.options.getString("item");
  const qty=interaction.options.getInteger("quantity")||1;
  let answer="";
  if (action==="list") {
   const items=await eco.listItems(guildId);
   answer="🛒 **ItamaRos Shop**\n\n"+
    (items.map(i=>"**"+i.name+"** ("+i.key+") — "+
     fmt(i.price,currency)+" | "+i.category+" | "+
     (i.stock===null?"Unlimited":i.stock+" in stock")).join("\n")
     || "No items yet.");
  } else if (action==="info") {
   const i=await eco.getItem(guildId,key);
   if (!i) throw Error("Item not found.");
   answer="📦 **"+i.name+"**\n"+(i.description||"No description")+
    "\nCategory: "+i.category+"\nPrice: "+fmt(i.price,currency)+
    "\nType: "+i.type+"\nStock: "+(i.stock===null?"Unlimited":i.stock);
  } else if (action==="inventory") {
   const target=interaction.options.getUser("member")||interaction.user;
   const items=await eco.getInventory(guildId,target.id);
   answer="🎒 **Inventory of <@"+target.id+">**\n\n"+
    (items.map(i=>"• "+i.itemName+" ("+i.itemKey+") ×"+
     i.quantity).join("\n")||"Empty");
  } else if (action==="buy") {
   const r=await eco.buy(guildId,userId,key,qty);
   answer="✅ Bought "+r.quantity+"× **"+r.item.name+"** for "+
    fmt(r.cost,currency)+".";
  } else if (action==="sell") {
   const r=await eco.sell(guildId,userId,key,qty);
   answer="✅ Sold "+r.quantity+"× **"+r.item.name+"** for "+
    fmt(r.reward,currency)+".";
  } else if (action==="use") {
   const item=await eco.getItem(guildId,key);
   if (!item) throw Error("Item not found.");
   if (item.type==="role") {
    const member=await interaction.guild.members.fetch(userId);
    await eco.redeemRole(guildId,userId,key,member);
    answer="✅ You redeemed the **"+item.name+"** role!";
   } else {
    await eco.useItem(guildId,userId,key);
    answer="✨ Used **"+item.name+"**!";
   }
  }
  await interaction.editReply({
   content:answer.slice(0,1950),allowedMentions:{parse:[]}
  });
 } catch (error) {
  console.error("[Store] Error:",error);
  await interaction.editReply({
   content:"❌ "+String(error.message||"Store unavailable").slice(0,200),
   allowedMentions:{parse:[]}
  }).catch(()=>{});
 }
}
module.exports={data,execute};
