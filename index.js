const puppeteer = require('puppeteer');
const axios = require('axios');

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

function getTaiwanDate() {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const twTime = new Date(utc + (3600000 * 8));

  const yyyy = twTime.getFullYear();
  const mm = String(twTime.getMonth() + 1).padStart(2, '0');
  const dd = String(twTime.getDate()).padStart(2, '0');

  return `${yyyy}/${mm}/${dd}`;
}

async function sendToDiscord(content) {
  if (!DISCORD_WEBHOOK_URL) return;
  if (content.length > 1900) {
    const chunks = content.match(/[\s\S]{1,1900}/g) || [];
    for (const chunk of chunks) {
      await axios.post(DISCORD_WEBHOOK_URL, { content: chunk });
      await new Promise(r => setTimeout(r, 500));
    }
  } else {
    await axios.post(DISCORD_WEBHOOK_URL, { content: content });
  }
}

async function main() {
  if (!DISCORD_WEBHOOK_URL) {
    console.error("❌ 錯誤：未找到 DISCORD_WEBHOOK_URL。");
    process.exit(1);
  }

  const todayStr = getTaiwanDate();
  const targetUrl = ['https://', 'stats.', 'cpbl.', 'com.', 'tw/'].join('');
  console.log("🌐 正在載入 CPBL 數據中心進行葉子節點賽況解析: " + targetUrl);

  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--window-size=1920,1080'
    ]
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    
    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 45000 });
    // 等待動態比分與狀態載入
    await new Promise(r => setTimeout(r, 6000));

    // 只抓取最底層、沒有子元素包含「比賽代號 (如 GAME)」的最小獨立區塊，徹底避免父子重複抓取
    const uniqueMatchCards = await page.evaluate(() => {
      const cards = [];
      // 尋找所有包含 GAME 字串的元素
      const allElements = document.querySelectorAll('*');
      
      allElements.forEach(el => {
        // 確保這是一個獨立的比賽卡片容器（通常含有 vs 且含有 GAME 字串）
        const text = el.innerText || '';
        if (text.includes('vs') && text.includes('GAME') && el.children.length < 5) {
          // 檢查是不是最末端（即沒有其他包含 GAME 的子元素在裡面）
          const hasChildMatch = Array.from(el.children).some(child => (child.innerText || '').includes('GAME'));
          if (!hasChildMatch) {
            const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
            cards.push(lines);
          }
        }
      });

      // 嚴格過濾重複內容
      const finalCards = [];
      const seenKeys = new Set();
      cards.forEach(c => {
        // 用前幾個關鍵字當作識別 key
        const key = c.slice(0, 4).join('|');
        if (!seenKeys.has(key) && c.length >= 4) {
          seenKeys.add(key);
          finalCards.push(c);
        }
      });

      return finalCards;
    });

    await browser.close();

    let output = `📢 **中華職棒 即時賽況看板 (${todayStr})**\n\n`;

    if (uniqueMatchCards && uniqueMatchCards.length > 0) {
      uniqueMatchCards.forEach((lines, idx) => {
        const joinedStr = lines.join(' ');
        let badge = '📌';
        let status = '未開始';

        if (joinedStr.includes('比賽中')) {
          badge = '🔴';
          status = '比賽中';
        } else if (joinedStr.includes('已完賽') || joinedStr.includes('終場')) {
          badge = '🏁';
          status = '已完賽';
        }

        output += `⚾ **場次 ${idx + 1}** [${badge} ${status}]\n`;
        lines.forEach(line => {
          output += `> ${line}\n`;
        });
        output += `───────────────────\n`;
      });
    } else {
      output += `ℹ️ 今日 (${todayStr}) 尚無即時賽況資料。\n`;
    }

    console.log("✅ 賽況解析完成，正在推送到 Discord...");
    await sendToDiscord(output);
    console.log("🎉 推播成功！");

  } catch (error) {
    if (browser) await browser.close();
    console.error("❌ 執行失敗:", error.message);
    process.exit(1);
  }
}

main();