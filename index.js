const axios = require('axios');
const cheerio = require('cheerio');

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

// 中職球隊名稱標準表
const TEAMS = ["中信兄弟", "統一7-ELEVEn獅", "統一獅", "味全龍", "富邦悍將", "樂天桃猿", "台鋼雄鷹"];

async function main() {
  if (!DISCORD_WEBHOOK_URL) {
    console.error("❌ 錯誤：未找到 DISCORD_WEBHOOK_URL 環境變數，請確認 GitHub Secrets 設定。");
    process.exit(1);
  }

  try {
    console.log("🔍 正在從 CPBL 官方首頁 (https://www.cpbl.com.tw/) 解析即時比分與賽程...");

    const response = await axios.get('https://www.cpbl.com.tw/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8'
      },
      timeout: 15000
    });

    const $ = cheerio.load(response.data);
    const matches = [];

    // 1. 優先搜尋首頁頂部比分看版常用的 class 容器
    const scoreSelectors = [
      '.game_box',
      '.header_game',
      '.top_scoreboard',
      '.game_item',
      '.Scoreboard',
      '.match_box'
    ];

    let foundScoreboard = false;

    // 嘗試針對特定比分看版容器抓取
    scoreSelectors.forEach(selector => {
      $(selector).each((_, el) => {
        const text = $(el).text().replace(/\s+/g, ' ').trim();
        const found = TEAMS.filter(t => text.includes(t));

        if (found.length === 2) {
          foundScoreboard = true;
          parseAndPushMatch($, el, found, matches);
        }
      });
    });

    // 2. 若官網改版 class 變更，則以廣域結構化過濾（自動排除新聞與球員榜）
    if (!foundScoreboard || matches.length === 0) {
      $('div, li, a').each((_, el) => {
        // 排除父層容器，鎖定葉子卡片
        if ($(el).find('div, li, a').length > 6) return;

        const text = $(el).text().replace(/\s+/g, ' ').trim();

        // 嚴格過濾條件：必須排除新聞常見字眼（橫掃、再勝、先發、盜壘、安打王、原場地進行補賽等）
        const isNewsOrStats = /(新聞|先發|勝投|盜壘|打擊率|補賽周|補賽週|宣布|報導|火力串聯|客場橫掃)/.test(text);
        if (isNewsOrStats) return;

        const found = TEAMS.filter(t => text.includes(t));
        // 剛好抓到兩隊，且字數短小精幹（卡片區塊）
        if (found.length === 2 && text.length >= 6 && text.length <= 80) {
          parseAndPushMatch($, el, found, matches);
        }
      });
    }

    let messageContent = "";
    if (matches.length > 0) {
      messageContent = matches.map(m => {
        return `⚾ **${m.awayTeam}** vs **${m.homeTeam}**\n📊 **比分/賽況**：${m.detail}\n📌 **狀態**：${m.status}`;
      }).join('\n\n───────────────\n\n');
    } else {
      messageContent = "ℹ️ 首頁目前無進行中或今日排定之賽事（可能非比賽日或尚未開賽）。";
    }

    const payload = {
      content: `📢 **中華職棒 官方首頁最新賽事戰況**\n\n${messageContent}`
    };

    console.log("🚀 正在發送訊息至 Discord Webhook...");
    await axios.post(DISCORD_WEBHOOK_URL, payload);
    console.log("✅ 成功推播首頁比分戰況到 Discord！");

  } catch (error) {
    if (error.response) {
      console.error(`❌ 發送失敗，狀態碼: ${error.response.status}`);
      console.error("📋 回傳錯誤詳情:", typeof error.response.data === 'string' ? error.response.data.slice(0, 300) : error.response.data);
    } else {
      console.error("❌ 執行過程發生錯誤:", error.message);
    }
    process.exit(1);
  }
}

// 輔助函式：解析並去重塞入結果陣列
function parseAndPushMatch($, el, foundTeams, matchesList) {
  const text = $(el).text().replace(/\s+/g, ' ').trim();
  const key = `${foundTeams[0]}-${foundTeams[1]}`;
  const reverseKey = `${foundTeams[1]}-${foundTeams[0]}`;

  if (!matchesList.some(m => m.key === key || m.key === reverseKey)) {
    let status = "🟢 賽前 / 進行中";
    if (text.includes("結束") || text.includes("終場") || text.includes("Final")) {
      status = "🔴 比賽結束";
    } else if (text.includes("延賽") || text.includes("因雨") || text.includes("取消")) {
      status = "🌧️ 因雨延賽";
    }

    matchesList.push({
      key,
      awayTeam: foundTeams[0],
      homeTeam: foundTeams[1],
      detail: text,
      status
    });
  }
}

main();