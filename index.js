const axios = require('axios');
const cheerio = require('cheerio');

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

async function main() {
  if (!DISCORD_WEBHOOK_URL) {
    console.error("❌ 錯誤：未找到 DISCORD_WEBHOOK_URL 環境變數，請確認 GitHub Secrets 設定。");
    process.exit(1);
  }

  try {
    console.log("🔍 正在從 Yahoo 賽程比分頁面抓取戰況...");
    
    // 改抓賽程專頁，完全避開新聞干擾
    const response = await axios.get('https://tw.sports.yahoo.com/cpbl/schedule/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-TW,zh;q=0.9'
      },
      timeout: 20000
    });

    const $ = cheerio.load(response.data);
    const matches = [];

    // 精準選取賽事列表中的每一場對戰區塊
    // Yahoo 賽程頁面的比賽區塊通常為含有隊名與比分的列表項目
    $('li.Py\\(12px\\), div.Py\\(12px\\), [data-test="schedule-item"], li[class*="game"]').each((_, el) => {
      const text = $(el).text().replace(/\s+/g, ' ').trim();
      
      // 只要包含客隊/主隊與比分結構的文字
      if (
        (text.includes("兄弟") || text.includes("獅") || text.includes("龍") || text.includes("悍將") || text.includes("桃猿") || text.includes("雄鷹")) &&
        !text.includes("報導") && !text.includes("新聞") && !text.includes("專欄")
      ) {
        if (text.length > 5 && text.length < 100) {
          matches.push(text);
        }
      }
    });

    let messageContent = "";

    if (matches.length > 0) {
      messageContent = matches.map(m => `⚾ **${m}**`).join('\n\n');
    } else {
      // 備用語音/文字：如果當天沒有抓到或已過比賽時間
      messageContent = "ℹ️ 今日賽事已全數結束，或目前尚未有進行中的比賽。";
    }

    const payload = {
      content: `📢 **中華職棒 今日賽事戰況**\n\n${messageContent}`
    };

    console.log("🚀 正在發送訊息至 Discord Webhook...");
    await axios.post(DISCORD_WEBHOOK_URL, payload);
    console.log("✅ 成功推播純比分戰況到 Discord！");

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