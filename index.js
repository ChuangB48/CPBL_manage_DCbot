const axios = require('axios');
const cheerio = require('cheerio');

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

async function main() {
  if (!DISCORD_WEBHOOK_URL) {
    console.error("❌ 錯誤：未找到 DISCORD_WEBHOOK_URL 環境變數，請確認 GitHub Secrets 設定。");
    process.exit(1);
  }

  try {
    console.log("🔍 正在從 Yahoo 運動抓取中職最新比分資訊...");
    
    // 改用 Yahoo 運動 CPBL 頁面，海外雲端 IP 連線保證穩定
    const response = await axios.get('https://tw.sports.yahoo.com/cpbl/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8'
      },
      timeout: 20000 // 加長超時時間至 20 秒
    });

    console.log("✅ 成功取得網頁資料，開始解析...");
    const $ = cheerio.load(response.data);
    let matchContent = "";

    // 解析賽事比分看板 (選取常見的球隊與比分文字)
    $('ul li, div[class*="Scoreboard"], div[class*="game"]').each((_, element) => {
      const text = $(element).text().trim();
      // 判斷是否包含中職常見球隊名稱
      if (text.includes("兄弟") || text.includes("獅") || text.includes("龍") || text.includes("悍將") || text.includes("桃猿") || text.includes("雄鷹")) {
        if (text.length < 150 && !matchContent.includes(text)) {
          matchContent += `📌 ${text}\n\n`;
        }
      }
    });

    if (!matchContent.trim()) {
      matchContent = "⚾ **今日賽事快訊**\n今日目前非比賽時段，或暫無最新賽況更新。";
    }

    const payload = {
      content: `📢 **中華職棒 今日戰況速報**\n\n${matchContent.slice(0, 1500)}` // 限制長度避免超過 Discord 2000 字上限
    };

    console.log("🚀 正在發送訊息至 Discord Webhook...");
    await axios.post(DISCORD_WEBHOOK_URL, payload);
    console.log("✅ 成功推播最新戰況到 Discord！");

  } catch (error) {
    if (error.response) {
      console.error(`❌ 發送失敗，狀態碼: ${error.response.status}`);
      console.error("📋 回傳錯誤詳情:", JSON.stringify(error.response.data, null, 2));
    } else {
      console.error("❌ 執行過程發生錯誤:", error.message);
    }
    process.exit(1);
  }
}

main();