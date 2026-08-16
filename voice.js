// voice.js
process.env.TZ = 'Asia/Taipei';
const { Client, GatewayIntentBits, ChannelType } = require('discord.js');
const { fetchCPBLData } = require('./scraper');

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID;
const DISCORD_CATEGORY_ID = process.env.DISCORD_CATEGORY_ID;

// 透過環境變數指定模式: 'reset' 或 'update'
const EXEC_MODE = process.env.MODE || 'update';

async function manageVoiceChannels(matchesData, isResetMode) {
  if (!DISCORD_BOT_TOKEN || !DISCORD_GUILD_ID) {
    console.log("未設定 Token 或 Guild ID，跳過語音頻道管理。");
    return;
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  try {
    await client.login(DISCORD_BOT_TOKEN);
    const guild = await client.guilds.fetch(DISCORD_GUILD_ID);

    let category = null;
    if (DISCORD_CATEGORY_ID) {
      try {
        category = await guild.channels.fetch(DISCORD_CATEGORY_ID);
        if (category && category.type !== ChannelType.GuildCategory) category = null;
      } catch (e) {
        console.error(`找不到類別 ID (${DISCORD_CATEGORY_ID})`, e.message);
      }
    }

    if (!category) return;

    const existingVoiceChannels = Array.from(
      guild.channels.cache.filter(c => c.parentId === category.id && c.type === ChannelType.GuildVoice).values()
    );

    if (isResetMode) {
      console.log(`🗑️ [Reset 模式] 清理舊頻道 (${existingVoiceChannels.length} 個)...`);
      for (const channel of existingVoiceChannels) {
        try { await channel.delete('每日重置'); } catch (err) {}
      }

      console.log(`✨ [Reset 模式] 建立今日頻道 (${matchesData.length} 場)...`);
      for (const match of matchesData) {
        const rawLines = match.rawText.split('\n').map(l => l.trim()).filter(Boolean);
        let away = rawLines[0] || '', home = rawLines[rawLines.length - 1] || '';
        
        let channelName = (away && home) ? `⚔️ ${away} vs ${home}` : `⚔️ ${match.gameId} 對戰組合未定`;
        channelName = channelName.slice(0, 100);
        const voiceStatus = `⚾ ${match.gameId}`;

        try {
          const channel = await guild.channels.create({
            name: channelName,
            type: ChannelType.GuildVoice,
            parent: category.id,
          });
          await client.rest.put(`/channels/${channel.id}/voice-status`, { body: { status: voiceStatus } });
        } catch (err) {
          console.error(`建立 ${match.gameId} 頻道失敗:`, err.message);
        }
      }
    } else {
      console.log(`🔄 [Update 模式] 更新語音狀態...`);
      for (const match of matchesData) {
        const targetChannel = existingVoiceChannels.find(c => c.name.includes(match.gameId));
        if (targetChannel) {
          try {
            await client.rest.put(`/channels/${targetChannel.id}/voice-status`, { body: { status: `⚾ ${match.gameId}` } });
          } catch (err) {}
        }
      }
    }
  } finally {
    client.destroy();
  }
}

async function main() {
  const isResetMode = EXEC_MODE === 'reset';
  console.log(`[${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}] 執行語音頻道管理 (${isResetMode ? '重置' : '更新'})...`);
  
  try {
    const matchesData = await fetchCPBLData();
    await manageVoiceChannels(matchesData, isResetMode);
    console.log("✅ 語音頻道處理完成！");
  } catch (error) {
    console.error("語音頻道處理失敗:", error);
  }
}

main();