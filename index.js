process.env.TZ = 'Asia/Taipei';

const puppeteer = require('puppeteer');
const axios = require('axios');

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

// 取得台灣日期格式
function getTaiwanDate() {
  const formatter = new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return formatter.format(new Date());
}

// 格式化賽況訊息
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

// 爬取 CPBL 官網
async function fetchMatches() {
  const browser = await puppeteer.launch({ 
    headless: "new", 
    args: ['--no-sandbox', '--disable-setuid-sandbox'] 
  });
  
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
        results.push({
          gameId,
          rawText: text,
          boxUrl: anchor ? anchor.href : '',
          status: text.includes('進行中') ? '進行中' : '其他'
        });
      }
      return results;
    });

    for (let match of matchesData) {
      if (match.status === '進行中' && match.boxUrl) {
        try {
          const detailPage = await browser.newPage();
          await detailPage.emulateTimezone('Asia/Taipei');
          await detailPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
          await detailPage.goto(match.boxUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
          await new Promise(r => setTimeout(r, 3000));

          const detailData = await detailPage.evaluate(() => {
            const fullText = document.body.innerText;
            let inning = '';
            const inningMatch = fullText.match(/(\d{1,2}|[一二三四五六七八九十]+)\s*局?\s*([上下])/);
            if (inningMatch) inning = `${inningMatch[1]}局${inningMatch[2]}`;

            const invalidNames = ['局數', '打席', '打數', '安打', '得分', '打點', '三振', '四壞', '四死', '失分', '自責分', '投球數', '防禦率', '先發', '替補', '合計', '成績', '紀錄', '投手', '打者', '守備', '代打', '代跑', '勝投', '敗投', '救援', '出局', '好球', '壞球', '殘壘', '雙殺', '飛球', '滾地', '平飛', '接殺', '觸身', '暴投', '捕逸', '盜壘', '刺殺', '封殺', '野選', '一壘', '二壘', '三壘', '本壘', '無死', '一死', '二死', '保送', '換投', '暫停', '進行中'];

            let pitcher = '';
            for (const m of Array.from(fullText.matchAll(/(?:投手|投\s*手|P)\s*[:：]?\s*([\u4e00-\u9fa5·•]{2,8})/g))) {
              if (!invalidNames.some(inv => m[1].trim().includes(inv))) { pitcher = m[1].trim(); break; }
            }

            let batter = '';
            for (const m of Array.from(fullText.matchAll(/(?:打者|打\s*者|B)\s*[:：]?\s*([\u4e00-\u9fa5·•]{2,8})/g))) {
              if (!invalidNames.some(inv => m[1].trim().includes(inv))) { batter = m[1].trim(); break; }
            }

            return { inning, pitcher, batter };
          });

          match.inning = detailData.inning;
          match.pitcher = detailData.pitcher;
          match.batter = detailData.batter;
          await detailPage.close();
        } catch (e) {
          console.error(`無法抓取 ${match.gameId} 詳細頁面:`, e.message);
        }
      }
    }

    await browser.close();
    return matchesData;
  } catch (error) {
    await browser.close();
    throw error;
  }
}

// 主執行函式
async function main() {
  if (!DISCORD_WEBHOOK_URL) {
    console.error('❌ 錯誤：未找到 DISCORD_WEBHOOK_URL 環境變數！');
    process.exit(1);
  }

  try {
    console.log('🚀 開始執行 CPBL 賽況抓取...');
    const todayStr = getTaiwanDate();
    const matchesData = await fetchMatches();

    let output = `📢 **中華職棒 賽況即時推播 (${todayStr})**\n\n`;

    if (matchesData.length > 0) {
      matchesData.forEach((m, idx) => output += `**場次 ${idx + 1}**\n${formatMatchInfo(m)}\n───────────────────\n`);
    } else {
      output += `ℹ️ 今日 (${todayStr}) 尚無賽事資料或為休兵日。\n`;
    }

    const chunks = output.match(/[\s\S]{1,1900}/g) || [output];
    for (const chunk of chunks) {
      await axios.post(DISCORD_WEBHOOK_URL, { content: chunk });
      await new Promise(r => setTimeout(r, 500));
    }
    console.log('✅ 賽況 Webhook 推播成功！');
  } catch (error) {
    console.error('❌ 執行過程發生錯誤:', error.message);
    process.exit(1);
  }
}

main();