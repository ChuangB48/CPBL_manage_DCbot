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

    // 1. 抓取包含 GAME 且行數介於 4~15 行之間的「完整比賽卡片」
    const rawMatches = await page.evaluate(() => {
      const allDivs = Array.from(document.querySelectorAll('div'));
      return allDivs
        .map(div => div.innerText.trim())
        .filter(text => {
          const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
          const gameCount = (text.match(/GAME\d+/gi) || []).length;
          
          // 條件：包含 GAME、只有 1 場比賽，且行數要在 4~15 行之間（過濾微型標籤與超大容器）
          return gameCount === 1 && lines.length >= 4 && lines.length <= 15;
        });
    });

    await browser.close();

    // 2. 依照字數排序，優先取合適的卡片
    rawMatches.sort((a, b) => a.length - b.length);

    const uniqueMatches = [];
    const seenGames = new Set();

    // 3. 去重
    rawMatches.forEach(text => {
      const matchIds = text.match(/GAME\d+/gi) || [];
      if (matchIds.length === 1) {
        const gameId = matchIds[0].toUpperCase();
        if (!seenGames.has(gameId)) {
          seenGames.add(gameId);
          uniqueMatches.push(text);
        }
      }
    });

    // 4. 輸出結果
    const todayStr = getTaiwanDate();
    let output = `📢 **中華職棒 賽況回報 (${todayStr})**\n\n`;
    
    if (uniqueMatches.length > 0) {
      uniqueMatches.forEach((matchText, idx) => {
        const lines = matchText.split('\n').map(l => l.trim()).filter(Boolean);
        
        output += `⚾ **場次 ${idx + 1}**\n`;
        lines.forEach(line => output += `> ${line}\n`);
        output += `───────────────────\n`;
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