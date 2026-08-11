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
    const matchFields = [];

    // 解析比分區塊
    $('.game_box, .item').each((_, element) => {
      const awayTeam = $(element).find('.team_away, .away').text().trim() || "客隊";
      const homeTeam = $(element).find('.team_home, .home').text().trim() || "主隊";
      const score = $(element).find('.score').text().trim() || "未開打";
      const status = $(element).find('.status, .inning').text().trim() || "賽事準備中";

      // 只有在真的抓到有意義內容時才加入
      if (awayTeam !== "客隊" || homeTeam !== "主隊") {
        matchFields.push({
          name: `⚾ ${awayTeam} vs ${homeTeam}`,
          value: `> **比分**：${score}\n> **狀態**：${status}`,
          inline: false
        });
      }
    });

    // 如果沒抓到任何比賽（非比賽時間或 selector 沒對到），給予預設卡片測試連線
    if (matchFields.length === 0) {
      console.log("ℹ️ 今日目前無進行中賽事卡片，發送預設通知測試。");
      matchFields.push({
        name: "⚾ 今日賽事快訊",
        value: "今日目前非比賽進行時段，或尚未有最新比分資料更新。",
        inline: false
      });
    }

    const payload = {
      embeds: [
        {
          title: "📢 中華職棒 即時戰況通知",
          color: 0x1877f2,
          fields: matchFields,
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