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
  console.log("🌐 正在載入 CPBL 數據中心 DOM 元素解析: " + targetUrl);

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
    // 給予充分時間讓即時戰況完全渲染
    await new Promise(r => setTimeout(r, 6000));

    // 直接在瀏覽器中透過 CSS 結構或特徵尋找獨立的賽事卡片 DOM 元素
    const gameCards = await page.evaluate(() => {
      const cards = [];
      // 尋找網頁中所有可能代表比賽項目的區塊 (例如包含比分或對戰的 div)
      const allDivs = document.querySelectorAll('div');
      
      allDivs.forEach(div => {
        const text = div.innerText || '';
        // 篩選出同時包含「vs」且含有「比賽中」或「已完賽」或「未開始」的獨立區塊
        if (text.includes('vs') && (text.includes('比賽中') || text.includes('已完賽') || text.includes('未開始'))) {
          // 確保這是獨立的單一賽事卡片（避免抓到大範圍父容器）
          if (div.children.length < 10 && text.length < 250) {
            const cleanLines = text.split('\n').map(s => s.trim()).filter(Boolean);
            cards.push(cleanLines);
          }
        }
      });

      // 過濾掉內容完全重複的子容器
      const uniqueCards = [];
      const seen = new Set();
      cards.forEach(c => {
        const key = c.join('|');
        // 確保不重複且包含對戰隊伍
        if (!seen.has(key) && c.length >= 4) {
          seen.add(key);
          uniqueCards.push(c);
        }
      });

      return uniqueCards;
    });

    await browser.close();

    let output = `📢 **中華職棒 即時賽況看板 (${todayStr})**\n\n`;

    if (gameCards && gameCards.length > 0) {
      gameCards.forEach((lines, idx) => {
        const joinedStr = lines.join(' ');
        let badge = '📌';
        let status = '未開始';
        if (joinedStr.includes('比賽中')) {
          badge = '🔴';
          status = '比賽中';
        } else if (joinedStr.includes('已完賽')) {
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

    console.log("✅ DOM 賽況解析完成，正在推送到 Discord...");
    await sendToDiscord(output);
    console.log("🎉 推播成功！");

  } catch (error) {
    if (browser) await browser.close();
    console.error("❌ 執行失敗:", error.message);
    process.exit(1);
  }
}

main();