const axios = require('axios');
const cheerio = require('cheerio');

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

async function main() {
  if (!DISCORD_WEBHOOK_URL) {
    console.error("❌ 錯誤：未找到 DISCORD_WEBHOOK_URL 環境變數，請確認 GitHub Secrets 設定。");
    process.exit(1);
  }

  try {
    console.log("🔍 正在從 Yahoo 賽程專頁抓取當日對戰比分...");

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

    // 定位賽事列表每一列 (包含賽事狀態、球隊與比分)
    $('div[class*="Mah(0)"], div[data-test="schedule-item"], li[class*="Py(12px)"], div[class*="Py(12px)"]').each((_, el) => {
      const fullText = $(el).text().replace(/\s+/g, ' ').trim();

      // 檢查是否包含中職隊伍
      const teams = ["中信兄弟", "統一獅", "味全龍", "富邦悍將", "樂天桃猿", "台鋼雄鷹"];
      const foundTeams = teams.filter(team => fullText.includes(team));

      // 只要區塊內含有兩支對戰隊伍
      if (foundTeams.length >= 2) {
        // 抓取比分數字與狀態 (例如：結束、延賽、7局下)
        const isFinished = fullText.includes("結束") || fullText.includes("Final");
        const status = isFinished ? "🔴 比賽結束" : (fullText.includes("延賽") ? "🌧️ 延賽" : "🟢 進行中 / 賽前");

        // 整理輸出排版
        matches.push({
          away: foundTeams[0],
          home: foundTeams[1],
          raw: fullText,
          status: status
        });
      }
    });

    let messageContent = "";

    if (matches.length > 0) {
      // 避免重複賽事，進行去重
      const uniqueMatches = [];
      const seen = new Set();
      for (const m of matches) {
        const key = `${m.away}-${m.home}`;
        if (!seen.has(key)) {
          seen.add(key);
          uniqueMatches.push(m);
        }
      }

      messageContent = uniqueMatches.map(m => {
        return `⚾ **${m.away}** vs **${m.home}**\n📋 **賽況簡述**：${m.raw}\n📌 **狀態**：${m.status}`;
      }).join('\n\n───────────────\n\n');
    } else {
      messageContent = "ℹ️ 今日無排定之中華職棒賽事。";
    }

    const payload = {
      content: `📢 **中華職棒 當日戰況 / 最終比分**\n\n${messageContent.slice(0, 1800)}`
    };

    console.log("🚀 正在發送訊息至 Discord Webhook...");
    await axios.post(DISCORD_WEBHOOK_URL, payload);
    console.log("✅ 成功推播當日戰況到 Discord！");

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