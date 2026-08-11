const axios = require('axios');
const cheerio = require('cheerio');

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
    let matchContent = "";

    // 解析比分區塊
    $('.game_box, .item').each((_, element) => {
      const awayTeam = $(element).find('.team_away, .away').text().trim();
      const homeTeam = $(element).find('.team_home, .home').text().trim();
      const score = $(element).find('.score').text().trim();
      const status = $(element).find('.status, .inning').text().trim();

      if (awayTeam && homeTeam) {
        matchContent += `### ⚾ ${awayTeam} vs ${homeTeam}\n* **比分**：${score || '未開打'}\n* **狀態**：${status || '進行中'}\n\n`;
      }
    });

    // 如果沒有抓到比賽資訊，給予預設說明文字
    if (!matchContent.trim()) {
      matchContent = "ℹ️ 今日目前無正在進行中的賽事或非比賽時段。";
    }

    // 組裝合規且美觀的 Discord Embed Payload
    const payload = {
      username: "CPBL 戰況快報",
      avatar_url: "https://www.cpbl.com.tw/images/logo.png",
      embeds: [
        {
          title: "📢 中華職棒 即時戰況",
          description: matchContent,
          color: 0x1877f2, // 職棒藍
          footer: {
            text: "資料來源：中華職棒官網"
          },
          timestamp: new Date().toISOString()
        }
      ]
    };

    console.log("🚀 正在發送訊息至 Discord Webhook...");
    await axios.post(DISCORD_WEBHOOK_URL, payload);
    console.log("✅ 成功推播最新戰況到 Discord！");

  } catch (error) {
    if (error.response) {
      console.error(`❌ 發送失敗，狀態碼: ${error.response.status}`);
      console.error("📋 Discord 回傳錯誤詳情:", JSON.stringify(error.response.data, null, 2));
    } else {
      console.error("❌ 執行過程發生錯誤:", error.message);
    }
    process.exit(1);
  }
}

main();