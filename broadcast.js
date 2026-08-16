// broadcast.js
process.env.TZ = 'Asia/Taipei';
const axios = require('axios');
const { fetchCPBLData } = require('./scraper');

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

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
    awayTeam = otherLines[0]; homeTeam = otherLines[1];
  } else if (otherLines.length === 1) {
    awayTeam = otherLines[0];
  }

  let header = `⚾ **${gameId}**` + (gameType ? ` *(${gameType})*` : '');
  let infoParts = [`📌 **狀態**：${statusStr}`];
  if (time) infoParts.push(`⏰ **${time}**`);
  if (venue) infoParts.push(`📍 **${venue}**`);
  let infoLine = `> ${infoParts.join(' ｜ ')}`;

  let matchupLine = '';
  if (score) matchupLine = `> ⚔️ **${awayTeam || '客隊'}** \`${score}\` **${homeTeam || '主隊'}**`;
  else if (awayTeam && homeTeam) matchupLine = `> ⚔️ **${awayTeam}** vs **${homeTeam}**`;
  else if (otherLines.length > 0) matchupLine = `> ⚔️ ${otherLines.join(' vs ')}`;

  let pbLine = '';
  if (pitcher || batter) {
    const pStr = pitcher ? `🎯 投手：**${pitcher}**` : '';
    const bStr = batter ? `🏏 打者：**${batter}**` : '';
    pbLine = `> ${[pStr, bStr].filter(Boolean).join('  vs  ')}`;
  }

  return [header, infoLine, matchupLine, pbLine].filter(Boolean).join('\n');
}

async function main() {
  console.log(`[${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}] 開始執行文字播報...`);
  try {
    const matchesData = await fetchCPBLData();
    const todayStr = getTaiwanDate();
    let output = `⚡ **中華職棒 即時戰況播報 (${todayStr})**\n\n`;

    if (matchesData.length > 0) {
      matchesData.forEach((matchObj, idx) => {
        output += `**場次 ${idx + 1}**\n${formatMatchInfo(matchObj)}\n───────────────────\n`;
      });
    } else {
      output += `ℹ️ 今日 (${todayStr}) 尚無賽事資料或為休兵日。\n`;
    }

    await sendToDiscord(output);
    console.log("✅ 播報完成！");
  } catch (error) {
    console.error("播報失敗:", error);
  }
}

main();