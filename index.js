process.env.TZ = 'Asia/Taipei';

const puppeteer = require('puppeteer');
const axios = require('axios');
const { Client, GatewayIntentBits, ChannelType } = require('discord.js');

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID;
const DISCORD_CATEGORY_ID = process.env.DISCORD_CATEGORY_ID;

function getTaiwanDate() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}/${mm}/${dd}`;
}

async function sendToDiscord(content) {
  if (!DISCORD_WEBHOOK_URL) return;
  const chunks = content.match(/[\s\S]{1,1900}/g) || [content];
  for (const chunk of chunks) {
    await axios.post(DISCORD_WEBHOOK_URL, { content: chunk });
    await new Promise(r => setTimeout(r, 500));
  }
}

function formatMatchInfo(matchObj) {
  const { gameId, rawText, inning, pitcher, batter } = matchObj;
  const rawLines = rawText.split('\n').map(l => l.trim()).filter(Boolean);

  let gameType = '', status = '', time = '', score = '', otherLines = [];

  for (const line of rawLines) {
    if (/GAME\d+/i.test(line)) continue;
    if (/例行賽|熱身賽|明星賽|季後賽|總冠軍賽/.test(line)) gameType = line;
    else if (/未開始|進行中|已結束|延賽|因雨延賽|裁定/.test(line)) status = line;
    else if (/^\d{1,2}:\d{2}$/.test(line)) time = line;
    else if (/^\d+\s*[:：]\s*\d+$/.test(line)) score = line;
    else if (/^\d+-\d+-\d+$/.test(line) || line.toLowerCase() === 'vs') continue;
    else otherLines.push(line);
  }

  let statusStr = status || '未開始';
  if (statusStr === '進行中') statusStr = inning ? `進行中 (${inning})` : '進行中';

  let awayTeam = '', homeTeam = '', venue = '';
  if (otherLines.length >= 3) {
    awayTeam = otherLines[0];
    homeTeam = otherLines[otherLines.length - 1];
    venue = otherLines.slice(1, -1).join(' / ');
  } else if (otherLines.length === 2) {
    awayTeam = otherLines[0];
    homeTeam = otherLines[1];
  } else if (otherLines.length === 1) {
    awayTeam = otherLines[0];
  }

  matchObj.awayTeam = awayTeam;
  matchObj.homeTeam = homeTeam;

  let header = `⚾ **${gameId}**`;
  if (gameType) header += ` *(${gameType})*`;

  let infoParts = [`📌 **狀態**：${statusStr}`];
  if (time) infoParts.push(`⏰ **${time}**`);
  if (venue) infoParts.push(`📍 **${venue}**`);

  let infoLine = `> ${infoParts.join(' ｜ ')}`;
  let matchupLine = score 
    ? `> ⚔️ **${awayTeam || '客隊'}** \`${score}\` **${homeTeam || '主隊'}**`
    : `> ⚔️ **${awayTeam || '隊伍1'}** vs **${homeTeam || '隊伍2'}**`;

  let pbLine = '';
  if (pitcher || batter) {
    const pStr = pitcher ? `🎯 投手：**${pitcher}**` : '';
    const bStr = batter ? `🏏 打者：**${batter}**` : '';
    pbLine = `> ${[pStr, bStr].filter(Boolean).join('  vs  ')}`;
  }

  return [header, infoLine, matchupLine, pbLine].filter(Boolean).join('\n');
}

async function manageVoiceChannels(matchesData) {
  if (!DISCORD_BOT_TOKEN || !DISCORD_GUILD_ID) return;

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  try {
    await client.login(DISCORD_BOT_TOKEN);
    const guild = await client.guilds.fetch(DISCORD_GUILD_ID);

    let category = null;
    if (DISCORD_CATEGORY_ID) {
      category = await guild.channels.fetch(DISCORD_CATEGORY_ID).catch(() => null);
    }

    if (!category) return;

    const existingVoiceChannels = guild.channels.cache.filter(
      c => c.parentId === category.id && c.type === ChannelType.GuildVoice
    );

    for (const [_, channel] of existingVoiceChannels) {
      await channel.delete('自動清理舊賽事頻道');
    }

    for (const match of matchesData) {
      const channelName = `🔊 ${match.gameId}`.trim();
      const channel = await guild.channels.create({
        name: channelName.slice(0, 100),
        type: ChannelType.GuildVoice,
        parent: category.id,
      });

      const matchupStatus = (match.awayTeam && match.homeTeam)
        ? `⚔️ ${match.awayTeam} vs ${match.homeTeam}`
        : '⚔️ 對戰組合未定';

      await client.rest.put(`/channels/${channel.id}/voice-status`, { body: { status: matchupStatus } }).catch(() => {});
    }
  } catch (error) {
    console.error("管理語音頻道發生錯誤:", error);
  } finally {
    client.destroy();
  }
}

async function main() {
  const args = process.argv.slice(2);
  let mode = 'all';
  args.forEach(arg => { if (arg.startsWith('--mode=')) mode = arg.split('=')[1]; });

  const browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  
  try {
    const page = await browser.newPage();
    await page.emulateTimezone('Asia/Taipei');
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    await page.goto('https://stats.cpbl.com.tw/', { waitUntil: 'networkidle2', timeout: 45000 });
    await new Promise(r => setTimeout(r, 5000));

    const matchesData = await page.evaluate(() => {
      const allDivs = Array.from(document.querySelectorAll('div'));
      const candidateDivs = allDivs.filter(div => {
        const text = div.innerText.trim();
        const gameMatches = text.match(/GAME\d+/gi) || [];
        const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
        return gameMatches.length === 1 && lines.length >= 3 && lines.length <= 25;
      });

      candidateDivs.sort((a, b) => a.innerText.length - b.innerText.length);
      const seen = new Set();
      const results = [];

      for (const card of candidateDivs) {
        const text = card.innerText.trim();
        const gameIdMatch = text.match(/GAME\d+/gi);
        if (!gameIdMatch) continue;
        const gameId = gameIdMatch[0].toUpperCase();

        if (seen.has(gameId)) continue;
        seen.add(gameId);

        const anchor = card.querySelector('a') || card.closest('a');
        results.push({ gameId, rawText: text, boxUrl: anchor ? anchor.href : '', status: text.includes('進行中') ? '進行中' : '其他' });
      }
      return results;
    });

    await browser.close();
    matchesData.forEach(match => formatMatchInfo(match));

    if (mode === 'all' || mode === 'report' || mode === 'report_only') {
      const todayStr = getTaiwanDate();
      let output = `📢 **中華職棒 賽況回報 (${todayStr})**\n\n`;
      if (matchesData.length > 0) {
        matchesData.forEach((m, idx) => output += `**場次 ${idx + 1}**\n${formatMatchInfo(m)}\n───────────────────\n`);
      } else {
        output += `ℹ️ 今日 (${todayStr}) 尚無賽事資料或為休兵日。\n`;
      }
      await sendToDiscord(output);
    }

    if (mode === 'all' || mode === 'voice' || mode === 'voice_only') {
      if (matchesData.length > 0) await manageVoiceChannels(matchesData);
    }
  } catch (error) {
    console.error("執行發生錯誤:", error);
    process.exit(1);
  }
}

main();