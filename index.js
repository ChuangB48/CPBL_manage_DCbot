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
  console.log("🌐 正在載入 CPBL 數據中心進行穩健賽況解析: " + targetUrl);

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

    // 尋找所有包含 vs 與 GAME 字串的元素，並收集起來用內容去重
    const matchCards = await page.evaluate(() => {
      const cards = [];
      const allElements = document.querySelectorAll('div');
      
      allElements.forEach(el => {
        const text = el.innerText || '';
        // 篩選出包含對戰與賽事編號的區塊
        if (text.includes('vs') && text.includes('GAME')) {
          const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
          // 確保這是適當大小的賽事卡片文字群
          if (lines.length >= 4 && lines.length <= 25) {
            cards.push(lines);
          }
        }
      });

      // 透過比對文字內容來精準去除父子重複容器
      const uniqueCards = [];
      const seenSignatures = new Set();

      // 依據字數由短到長排序，優先保留精簡的子容器
      cards.sort((a, b) => a.length - b.length);

      cards.forEach(c => {
        const signature = c.filter(line => line.includes('GAME') || line.includes('vs')).join('_');
        if (signature && !seenSignatures.has(signature)) {
          seenSignatures.add(signature);
          uniqueCards.push(c);
        }
      });

      return uniqueCards;
    });

    await browser.close();

    let output = `📢 **中華職棒 即時賽況看板 (${todayStr})**\n\n`;

    if (matchCards && matchCards.length > 0) {
      matchCards.forEach((lines, idx) => {
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