// 強制設定 Node.js 環境時區為台灣時間
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
    
    // 💡 關鍵設定：強制瀏覽器模仿台灣時區
    await page.emulateTimezone('Asia/Taipei');
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    
    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 45000 });
    await new Promise(r => setTimeout(r, 6000));

    // 1. 抓取包含 GAME 與 vs 的區塊
    const rawMatches = await page.evaluate(() => {
      const allDivs = Array.from(document.querySelectorAll('div'));
      return allDivs
        .map(div => div.innerText.trim())
        .filter(text => text.includes('GAME') && text.includes('vs'));
    });

    await browser.close();

    // 2. 依照長度排序，優先取最小容器
    rawMatches.sort((a, b) => a.length - b.length);

    const uniqueMatches = [];
    const seenGames = new Set();

    // 3. 去重
    rawMatches.forEach(text => {
      const matchIds = text.match(/GAME\d+/g) || [];
      if (matchIds.length === 1) {
        const gameId = matchIds[0];
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