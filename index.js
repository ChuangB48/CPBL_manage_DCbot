const axios = require('axios');
const cheerio = require('cheerio');

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

async function sendToDiscordInChunks(title, items) {
  let currentChunk = `📋 **${title}**\n\`\`\`text\n`;

  for (const item of items) {
    const line = `${item.text.padEnd(14, ' ')} ➔ ${item.href}\n`;
    if ((currentChunk + line).length > 1800) {
      currentChunk += '```';
      await axios.post(DISCORD_WEBHOOK_URL, { content: currentChunk });
      await new Promise(r => setTimeout(r, 800));
      currentChunk = `📋 **${title} (接續)**\n\`\`\`text\n`;
    }
    currentChunk += line;
  }

  if (!currentChunk.endsWith('```')) {
    currentChunk += '```';
    await axios.post(DISCORD_WEBHOOK_URL, { content: currentChunk });
  }
}

async function main() {
  if (!DISCORD_WEBHOOK_URL) {
    console.error("❌ 錯誤：未找到 DISCORD_WEBHOOK_URL 環境變數。");
    process.exit(1);
  }

  const todayStr = getTaiwanDate();
  console.log(`🌐 正在使用 Axios 請求 CPBL 首頁 HTML [${todayStr}]...`);

  try {
    const response = await axios.get('[https://www.cpbl.com.tw/](https://www.cpbl.com.tw/)', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7'
      },
      timeout: 20000
    });

    const $ = cheerio.load(response.data);
    const links = [];

    $('a').each((_, el) => {
      const text = ($(el).text() || $(el).attr('title') || '').trim().replace(/\s+/g, ' ');
      let href = $(el).attr('href') || '';

      if (href && !href.startsWith('javascript:')) {
        if (href.startsWith('/')) {
          href = `[https://www.cpbl.com.tw](https://www.cpbl.com.tw)${href}`;
        }
        if (text) {
          links.push({ text, href });
        }
      }
    });

    console.log(`✅ 成功解析出 ${links.length} 個首頁導覽連結！正在推送至 Discord...`);
    await sendToDiscordInChunks(`【CPBL 官網首頁真實連結清單】(${todayStr})`, links);
    console.log("🎉 已全數發送至 Discord！");

  } catch (error) {
    console.error("❌ 請求失敗:", error.message);
    process.exit(1);
  }
}

main();