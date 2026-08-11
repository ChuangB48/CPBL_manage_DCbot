const axios = require('axios');
const cheerio = require('cheerio');

// 從 GitHub Secrets 注入的環境變數中取得 Webhook 網址
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

async function main() {
  if (!DISCORD_WEBHOOK_URL) {
    console.error("❌ 錯誤：未找到 DISCORD_WEBHOOK_URL 環境變數，請確認 GitHub Secrets 設定。");
    process.exit(1);
  }

  try {
    console.log("🔍 開始抓取中職最新比分資訊...");
    
    const response = await axios.get('https://www.cpbl.com.tw', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      timeout: 10000
    });

    const $ = cheerio.load(response.data);
    const matchFields = [];

    // 根據官網比分看板區塊選取資料 (可依實際官網 DOM 結構調整選取器)
    $('.game_box, .item').each((_, element) => {
      const awayTeam = $(element).find('.team_away, .away').text().trim();
      const homeTeam = $(element).find('.team_home, .home').text().trim();
      const score = $(element).find('.score').text().trim();
      const status = $(element).find('.status, .inning').text().trim();

      if (awayTeam && homeTeam) {
        matchFields.push({
          name: `⚾ ${awayTeam} vs ${homeTeam}`,
          value: `> **比分**：${score || '未開打'}\n> **狀態**：${status || '進行中'}`,
          inline: false
        });
      }
    });

    // 若當天有比賽資料，組裝 Embed 並推播
    if (matchFields.length > 0) {
      const payload = {
        embeds: [
          {
            title: "📢 中華職棒 今日戰況推播",
            color: 0x1877f2, // 職棒藍
            fields: matchFields,
            footer: {
              text: "CPBL 即時比分快報"
            },
            timestamp: new Date().toISOString()
          }
        ]
      };

      await axios.post(DISCORD_WEBHOOK_URL, payload);
      console.log("✅ 成功推播最新戰況到 Discord！");
    } else {
      console.log("ℹ️ 今日目前無正在進行或已排程的賽事資訊。");
    }

  } catch (error) {
    console.error("❌ 執行過程發生錯誤:", error.message);
    process.exit(1);
  }
}

main();