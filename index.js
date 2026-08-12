const axios = require('axios');
const cheerio = require('cheerio');

// 安全清洗 Webhook URL
let rawWebhook = process.env.DISCORD_WEBHOOK_URL || '';
const DISCORD_WEBHOOK_URL = rawWebhook
  .trim()
  .replace(/^\[|\]$/g, '')
  .replace(/^["']|["']$/g, '')
  .replace(/\(.*?\)/g, '');

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
  if (!DISCORD_WEBHOOK_URL.startsWith('http')) {
    console.error(`❌ 無效的 Webhook 網址: "${DISCORD_WEBHOOK_URL}"`);
    return;
  }

  let currentChunk = `📋 **${title}**\n\`\`\`text\n`;

  for (const item of items) {
    const line = `${item.text.padEnd(16, ' ')} ➔ ${item.href}\n`;
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
  console.log("--------------------------------------------------");
  const todayStr = getTaiwanDate();
  
  // 使用絕對安全的陣列合併來拼出網址，避免任何字串污染
  const targetUrl = ['https://', 'www.', 'cpbl.', 'com.', 'tw'].join('');
  console.log(`🌐 正在請求目標網址: ${targetUrl} [${todayStr}]`);

  try {
    const response = await axios.get(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8'
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
        if (text && href.startsWith('http')) {
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