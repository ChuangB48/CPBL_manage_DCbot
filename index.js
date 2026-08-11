const axios = require('axios');
const cheerio = require('cheerio');

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

const CPBL_TEAMS = [
  "中信兄弟", "統一7-ELEVEn獅", "統一獅", "味全龍",
  "富邦悍將", "樂天桃猿", "台鋼雄鷹"
];

// 排行榜與新聞特徵關鍵字（一律過濾）
const BLACKLIST_KEYWORDS = [
  "盜壘", "打擊", "勝投", "安打", "防禦率", "打點", "全壘打", "救援", "中繼", "三振",
  "橫掃", "再勝", "先發", "串聯", "擊退", "惜敗", "險勝", "例行賽編號", "補賽",
  "報導", "新聞", "賽後", "影音", "特輯", "快訊"
];

async function main() {
  if (!DISCORD_WEBHOOK_URL) {
    console.error("❌ 錯誤：未找到 DISCORD_WEBHOOK_URL 環境變數，請確認 GitHub Secrets 設定。");
    process.exit(1);
  }

  try {
    console.log("🔍 正在從 CPBL 官方首頁精確解析頂部賽事看板...");

    const response = await axios.get('https://www.cpbl.com.tw/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8'
      },
      timeout: 15000
    });

    const $ = cheerio.load(response.data);

    // 移除新聞、側欄、數據榜、跑馬燈 DOM 節點
    $('footer, marquee, .news, .standing, .rank, .leaderboard, .sidebar, .banner, .video').remove();

    const matches = [];

    // 遍歷所有節點，尋找「看板級」的賽事卡片
    $('*').each((_, el) => {
      // 排除子節點過多的父容器
      if ($(el).children().length > 8) return;

      const rawText = $(el).text().replace(/\s+/g, ' ').trim();

      // 1. 命中黑名單（新聞/排行榜）直接跳過
      const isBlacklisted = BLACKLIST_KEYWORDS.some(word => rawText.includes(word));
      if (isBlacklisted) return;

      // 2. 必須包含中職球隊
      const foundTeams = CPBL_TEAMS.filter(t => rawText.includes(t));

      // 3. 剛好兩隊對決，且長度符合看板卡片尺寸（10~70 字元）
      if (foundTeams.length === 2 && rawText.length >= 8 && rawText.length <= 70) {
        
        // 4. 卡片內必須含有賽事特徵（時間格式 18:35、VS、分數字樣、結束、延賽等）
        const hasMatchFeature = /(\d{1,2}:\d{2}|VS|vs|V\.S\.|結束|終場|Final|延賽|取消|LIVE|第\d局|\d+\s*[-:比]\s*\d+)/i.test(rawText);
        if (!hasMatchFeature) return;

        const key = `${foundTeams[0]}-${foundTeams[1]}`;
        const reverseKey = `${foundTeams[1]}-${foundTeams[0]}`;

        if (!matches.some(m => m.key === key || m.key === reverseKey)) {
          let statusEmoji = "🟢";
          let statusText = "進行中 / 賽前";

          if (rawText.includes("結束") || rawText.includes("終場") || rawText.includes("Final")) {
            statusEmoji = "🔴";
            statusText = "比賽結束";
          } else if (rawText.includes("延賽") || rawText.includes("取消") || rawText.includes("因雨")) {
            statusEmoji = "🌧️";
            statusText = "因雨延賽";
          }

          matches.push({
            key,
            awayTeam: foundTeams[0],
            homeTeam: foundTeams[1],
            scoreboardText: rawText,
            status: `${statusEmoji} ${statusText}`
          });
        }
      }
    });

    let messageContent = "";

    if (matches.length > 0) {
      messageContent = matches.map(m => {
        return `⚾ **${m.awayTeam}** vs **${m.homeTeam}**\n📊 **比分/看板**：${m.scoreboardText}\n📌 **狀態**：${m.status}`;
      }).join('\n\n───────────────\n\n');
    } else {
      messageContent = "ℹ️ 首頁目前無進行中賽事或排定賽程（今日無比賽或尚未開賽）。";
    }

    const payload = {
      content: `📢 **中華職棒 今日即時賽況 / 比分看板**\n\n${messageContent}`
    };

    console.log("🚀 正在發送訊息至 Discord Webhook...");
    await axios.post(DISCORD_WEBHOOK_URL, payload);
    console.log("✅ 成功推播精確比分看板到 Discord！");

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

main();