// voice.js
process.env.TZ = 'Asia/Taipei';
const { Client, GatewayIntentBits, ChannelType } = require('discord.js');
const { fetchCPBLData } = require('./scraper');

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID;
const DISCORD_CATEGORY_ID = process.env.DISCORD_CATEGORY_ID;

async function createDailyVoiceChannels() {
  if (!DISCORD_BOT_TOKEN || !DISCORD_GUILD_ID || !DISCORD_CATEGORY_ID) {
    console.log("未設定 Token、Guild ID 或 Category ID，跳過語音頻道建立。");
    return;
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  try {
    console.log("正在抓取今日 CPBL 賽事資料...");
    const matchesData = await fetchCPBLData();

    await client.login(DISCORD_BOT_TOKEN);
    const guild = await client.guilds.fetch(DISCORD_GUILD_ID);

    const category = await guild.channels.fetch(DISCORD_CATEGORY_ID).catch(() => null);
    if (!category || category.type !== ChannelType.GuildCategory) {
      console.error("❌ 找不到有效的類別 ID！");
      return;
    }

    // 1. 刪除類別下的舊語音頻道
    const existingChannels = Array.from(
      guild.channels.cache.filter(c => c.parentId === category.id && c.type === ChannelType.GuildVoice).values()
    );

    console.log(`🗑️ 開始清理舊頻道 (共 ${existingChannels.length} 個)...`);
    for (const channel of existingChannels) {
      try {
        await channel.delete('每日定時重置');
        console.log(`  - 已刪除舊頻道：${channel.name}`);
      } catch (err) {
        console.error(`  - 刪除頻道 ${channel.name} 失敗:`, err.message);
      }
    }

    // 2. 為今日賽事建立全新語音頻道
    console.log(`✨ 開始為今日 ${matchesData.length} 場賽事建立頻道...`);
    for (const match of matchesData) {
      const rawLines = match.rawText.split('\n').map(l => l.trim()).filter(Boolean);
      let away = rawLines[0] || '';
      let home = rawLines[rawLines.length - 1] || '';

      let channelName = (away && home) ? `⚔️ ${away} vs ${home}` : `⚔️ ${match.gameId} 對戰組合未定`;
      channelName = channelName.slice(0, 100);
      const voiceStatus = `⚾ ${match.gameId}`;

      try {
        const channel = await guild.channels.create({
          name: channelName,
          type: ChannelType.GuildVoice,
          parent: category.id,
        });

        // 設定語音頻道狀態文字（只設定一次）
        try {
          await client.rest.put(`/channels/${channel.id}/voice-status`, { body: { status: voiceStatus } });
        } catch (e) {
          // 若無權限或功能未開啟可忽略
        }

        console.log(`  + 已建立頻道：${channelName} (${voiceStatus})`);
      } catch (err) {
        console.error(`建立 ${match.gameId} 頻道失敗:`, err.message);
      }
    }

    console.log("✅ 今日語音頻道重置與建立完成！");
  } catch (error) {
    console.error("執行語音頻道重置時發生錯誤:", error);
  } finally {
    client.destroy();
  }
}

createDailyVoiceChannels();