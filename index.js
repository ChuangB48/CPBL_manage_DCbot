const axios = require('axios');
const cheerio = require('cheerio');

// 清理與驗證 Discord Webhook URL
let rawWebhook = process.env.DISCORD_WEBHOOK_URL || '';
const DISCORD_WEBHOOK_URL = rawWebhook.trim().replace(/^["']|["']$/g, '');

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
  if (!DISCORD_WEBHOOK_URL || !DISCORD_WEBHOOK_URL.startsWith('http')) {
    console.error("❌ DISCORD_WEBHOOK_URL 不是有效的 HTTP(S) 網址！請檢查 GitHub Secrets。");
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
  if (!DISCORD_WEBHOOK_URL) {
    console.error("❌ 錯誤：未設定 DISCORD_WEBHOOK_URL。");
    process.exit(1);
  } else if (!DISCORD_WEBHOOK_URL.startsWith('[https://discord.com/api/webhooks/](https://discord.com/api/webhooks/)')) {
    console.warn("⚠️ 警告：DISCORD_WEBHOOK_URL 格式可能不正確（非標準 Discord Webhook 路徑）。");
  } else {
    console.log("✅ Webhook URL 格式檢驗通過。");
  }

  const todayStr = getTaiwanDate();
  const targetUrl = '[https://www.cpbl.com.tw](https://www.cpbl.com.tw)';
  console.log(`🌐 正在使用 Axios 請求 CPBL 首頁 HTML [${todayStr}] (${targetUrl})...`);

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
    
    // 在 Log 裡也直接印出前 15 筆以供除錯
    links.slice(0, 15).forEach((item, i) => {
      console.log(`[${i + 1}] ${item.text} -> ${item.href}`);
    });

    await sendToDiscordInChunks(`【CPBL 官網首頁真實連結清單】(${todayStr})`, links);
    console.log("🎉 已全數發送至 Discord！");

  } catch (error) {
    console.error("❌ 請求失敗:", error.message);
    if (error.config && error.config.url) {
      console.error("出錯的 URL 是:", error.config.url);
    }
    process.exit(1);
  }
}

main();