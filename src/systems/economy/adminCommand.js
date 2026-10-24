"use strict";
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } =
 require("discord.js");
const eco = require("./service");
const { refreshStorePanel } = require("./storePanel");

const data = new SlashCommandBuilder().setName("store-admin")
 .setDescription("Manage the virtual currency and store")
 .setDMPermission(false)
 .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

data.addSubcommand(s=>s.setName("create").setDescription("Add a shop item")
 .addStringOption(o=>o.setName("name").setDescription("Item name (English letters/numbers)").setRequired(true))
 .addIntegerOption(o=>o.setName("price").setDescription("Price").setRequired(true).setMinValue(1).setMaxValue(1000000000))
 .addStringOption(o=>o.setName("type").setDescription("Item kind").setRequired(true)
  .addChoices({name:"Collectible",value:"collectible"},{name:"Consumable",value:"consumable"},{name:"Discord role",value:"role"}))
 .addStringOption(o=>o.setName("description").setDescription("Item description").setRequired(false))
 .addRoleOption(o=>o.setName("role").setDescription("Role (for role items)").setRequired(false))
 .addIntegerOption(o=>o.setName("stock").setDescription("Available stock, omit for unlimited").setMinValue(0).setRequired(false))
 .addStringOption(o=>o.setName("category").setDescription("Shop category").setRequired(false)));
data.addSubcommand(s=>s.setName("remove-item").setDescription("Hide a shop item")
 .addStringOption(o=>o.setName("item").setDescription("Item key/name").setRequired(true)));
for(const mode of ["add","remove","set"]) {
 data.addSubcommand(s=>s.setName(mode).setDescription(mode+" virtual coins")
  .addUserOption(o=>o.setName("member").setDescription("Member").setRequired(true))
  .addStringOption(o=>o.setName("balance").setDescription("Wallet or bank")
   .setRequired(true).addChoices(
    {name:"Wallet",value:"cash"},{name:"Bank",value:"bank"}))
  .addIntegerOption(o=>o.setName("amount").setDescription("Coins")
   .setRequired(true).setMinValue(0).setMaxValue(1000000000)));
}
data.addSubcommand(s=>s.setName("currency").setDescription("Change the currency symbol")
 .addStringOption(o=>o.setName("symbol").setDescription("Emoji or short label")
  .setRequired(true).setMaxLength(12)));
data.addSubcommand(s=>s.setName("rewards").setDescription("Set daily and work rewards")
 .addIntegerOption(o=>o.setName("daily").setDescription("Daily coins").setMinValue(0).setRequired(true))
 .addIntegerOption(o=>o.setName("work").setDescription("Work coins").setMinValue(0).setRequired(true)));

async function execute(interaction) {
 if(!interaction.inGuild()||
   !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)){
   return interaction.reply({
    content:"❌ Manage Server permission required.",
    flags:MessageFlags.Ephemeral
   });
 }
 await interaction.deferReply({flags:MessageFlags.Ephemeral});
 try{
  const guild=interaction.guildId;
  const action=interaction.options.getSubcommand();
  let reply="";
  if(action==="create"){
   const role=interaction.options.getRole("role");
   const type=interaction.options.getString("type",true);
   if(type==="role"){
    if(!role||role.id===guild||role.managed){
     throw Error("Select a regular server role to sell.");
    }
    const bot=await interaction.guild.members.fetchMe();
    if(role.position>=bot.roles.highest.position){
     throw Error("The bot role must be above the item role.");
    }
   }
   const item=await eco.createItem(guild,{
    name:interaction.options.getString("name",true),
    price:interaction.options.getInteger("price",true),
    type,
    description:interaction.options.getString("description")||"",
    roleId:role?.id,
    stock:interaction.options.getInteger("stock"),
    category:interaction.options.getString("category")||"General"
   });
   reply="✅ Shop item **"+item.name+"** created.";
  }else if(action==="remove-item"){
   const key=interaction.options.getString("item",true);
   const item=await eco.getItem(guild,key);
   if(!item)throw Error("Item not found.");
   await eco.catalog().updateOne({_id:item._id},{$set:{
    enabled:false,updatedAt:new Date()
   }});
   reply="✅ **"+item.name+"** removed from shop listings.";
  }else if(["add","remove","set"].includes(action)){
   const member=interaction.options.getUser("member",true);
   if(member.bot)throw Error("Bots cannot receive or lose virtual coins.");
   const kind=interaction.options.getString("balance",true);
   const n=interaction.options.getInteger("amount",true);
   const balance=await eco.adjustMoney(
    guild,member.id,action,kind,n,interaction.user.id
   );
   reply="✅ <@"+member.id+"> now has **"+balance+"** in "+kind+".";
  }else if(action==="currency"){
   const currency=interaction.options.getString("symbol",true);
   await eco.setSetting(guild,"currency",currency);
   reply="✅ Currency changed to "+currency.replace(/@/g,"@\u200b")+".";
  }else if(action==="rewards"){
   const daily=interaction.options.getInteger("daily",true);
   const work=interaction.options.getInteger("work",true);
   await eco.setSetting(guild,"dailyReward",daily);
   await eco.setSetting(guild,"workReward",work);
   reply="✅ Rewards updated. Daily: "+daily+", work: "+work+".";
  }
  // Keep the public catalog in the ORIGINAL #item-store current.
  // Publishing failures must never roll back valid store operations.
  if(["create", "remove-item", "currency"].includes(action)){
   await refreshStorePanel(interaction.guild).catch(error=>{
    console.warn(
     "[Item Store] Couldn't refresh shop panel:",
     error.message
    );
   });
  }
  await interaction.editReply({
   content:reply,allowedMentions:{parse:[]}
  });
 }catch(error){
  console.error("[StoreAdmin]",error);
  await interaction.editReply({
   content:"❌ "+String(error.message||"Unable to update store.").slice(0,200),
   allowedMentions:{parse:[]}
  }).catch(()=>{});
 }
}
module.exports={data,execute};
