process.env.TZ = 'Asia/Taipei';

const puppeteer = require('puppeteer');
const axios = require('axios');

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

// 格式化單場賽事資訊
function formatMatchInfo(matchObj) {
  const { gameId, rawText, inning, pitcher, batter } = matchObj;
  const rawLines = rawText.split('\n').map(l => l.trim()).filter(Boolean);

  let gameType = '';
  let status = '';
  let time = '';
  let score = '';
  let otherLines = [];

  for (const line of rawLines) {
    if (/GAME\d+/i.test(line)) continue;
    
    if (/例行賽|熱身賽|明星賽|季後賽|總冠軍賽/.test(line)) {
      gameType = line;
    } else if (/未開始|進行中|已結束|延賽|因雨延賽|裁定/.test(line)) {
      status = line;
    } else if (/^\d{1,2}:\d{2}$/.test(line)) {
      time = line;
    } else if (/^\d+\s*[:：]\s*\d+$/.test(line)) {
      score = line;
    } else if (/^\d+-\d+-\d+$/.test(line)) {
      // 戰績資訊 (忽略)
    } else if (line.toLowerCase() === 'vs') {
      // 忽略 vs
    } else {
      otherLines.push(line);
    }
  }

  // 1. 狀態與局數
  let statusStr = status || '未開始';
  if (statusStr === '進行中') {
    statusStr = inning ? `進行中 (${inning})` : '進行中';
  }

  // 2. 隊名與球場
  let awayTeam = '';
  let homeTeam = '';
  let venue = '';

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

  // 3. 組合標題與基本資訊
  let header = `⚾ **${gameId}**`;
  if (gameType) header += ` *(${gameType})*`;

  let infoParts = [];
  infoParts.push(`📌 **狀態**：${statusStr}`);
  if (time) infoParts.push(`⏰ **${time}**`);
  if (venue) infoParts.push(`📍 **${venue}**`);

  let infoLine = `> ${infoParts.join(' ｜ ')}`;

  // 4. 對戰隊伍 / 比分
  let matchupLine = '';
  if (score) {
    matchupLine = `> ⚔️ **${awayTeam || '客隊'}** \`${score}\` **${homeTeam || '主隊'}**`;
  } else if (awayTeam && homeTeam) {
    matchupLine = `> ⚔️ **${awayTeam}** vs **${homeTeam}**`;
  } else if (otherLines.length > 0) {
    matchupLine = `> ⚔️ ${otherLines.join(' vs ')}`;
  }

  // 5. 當前投手 vs 打者對決狀態
  let pbLine = '';
  if (pitcher || batter) {
    const pStr = pitcher ? `🎯 投手：**${pitcher}**` : '';
    const bStr = batter ? `🏏 打者：**${batter}**` : '';
    pbLine = `> ${[pStr, bStr].filter(Boolean).join('  vs  ')}`;
  }

  return [header, infoLine, matchupLine, pbLine].filter(Boolean).join('\n');
}

async function main() {
  const targetUrl = 'https://stats.cpbl.com.tw/';
  const browser = await puppeteer.launch({ 
    headless: "new", 
    args: ['--no-sandbox', '--disable-setuid-sandbox'] 
  });
  
  try {
    const page = await browser.newPage();
    await page.emulateTimezone('Asia/Taipei');
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    
    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 45000 });
    await new Promise(r => setTimeout(r, 6000));

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

        // 收集卡片內所有子元素的文字內容
        const allElements = Array.from(card.querySelectorAll('*'));
        const allTexts = [text, ...allElements.map(e => e.innerText || e.textContent || '')].map(t => t.trim()).filter(Boolean);
        const fullString = allTexts.join('\n');

        // 1. 抓取局數 (例: 1上, 3局下, 5下)
        let inning = '';
        const inningMatch = fullString.match(/(\d{1,2}|[一二三四五六七八九十]+)\s*局?\s*([上下])/);
        if (inningMatch) {
          inning = `${inningMatch[1]}局${inningMatch[2]}`;
        }

        // 2. 抓取投手
        let pitcher = '';
        const pMatch = fullString.match(/(?:投\s*手?|P)\s*[:：]?\s*([\u4e00-\u9fa5a-zA-Z0-9·•]{2,8})/i);
        if (pMatch) {
          pitcher = pMatch[1].replace(/^(手|P)/i, '').trim();
        }

        // 3. 抓取打者
        let batter = '';
        const bMatch = fullString.match(/(?:打\s*者?|B)\s*[:：]?\s*([\u4e00-\u9fa5a-zA-Z0-9·•]{2,8})/i);
        if (bMatch) {
          batter = bMatch[1].replace(/^(者|B)/i, '').trim();
        }

        results.push({
          gameId,
          rawText: text,
          inning,
          pitcher,
          batter
        });
      }

      return results;
    });

    await browser.close();

    const todayStr = getTaiwanDate();
    let output = `📢 **中華職棒 賽況回報 (${todayStr})**\n\n`;
    
    if (matchesData.length > 0) {
      matchesData.forEach((matchObj, idx) => {
        const formattedCard = formatMatchInfo(matchObj);
        output += `**場次 ${idx + 1}**\n${formattedCard}\n───────────────────\n`;
      });
    } else {
      output += `ℹ️ 今日 (${todayStr}) 尚無賽事資料或為休兵日。\n`;
    }

    await sendToDiscord(output);
  } catch (error) {
    console.error("執行發生錯誤:", error);
    process.exit(1);
  }
}

main();