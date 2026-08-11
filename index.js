const axios = require('axios');
const cheerio = require('cheerio');

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

const CPBL_TEAMS = [
  "中信兄弟", "統一7-ELEVEn獅", "統一獅", "味全龍",
  "富邦悍將", "樂天桃猿", "台鋼雄鷹"
];

async function main() {
  if (!DISCORD_WEBHOOK_URL) {
    console.error("❌ 錯誤：未找到 DISCORD_WEBHOOK_URL 環境變數，請確認 GitHub Secrets 設定。");
    process.exit(1);
  }

  try {
    console.log("🔍 正在從 CPBL 首頁頂部看板抓取最新賽程與即時比分...");

    const response = await axios.get('https://www.cpbl.com.tw/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8'
      },
      timeout: 15000
    });

    const $ = cheerio.load(response.data);

    // 1. 先把公告、跑馬燈、新聞、頁尾等非看板內容直接從 DOM 移除
    $('marquee, footer, .marquee, .news, .notice, .bulletin, .rank, .standing, .sidebar').remove();

    const matches = [];

    // 2. 針對頁面頂部的賽事看板卡片節點進行掃描
    // CPBL 頂部賽事看板通常位於 header 或是 swiper-slide / game_item 結構中
    $('header, .header, .top_scoreboard, .swiper-wrapper, body').find('div, li, a').each((_, el) => {
      // 限制節點層級，避免重複抓到外層大容器
      if ($(el).children().length > 10) return;

      const rawText = $(el).text().replace(/\s+/g, ' ').trim();

      // 嚴格排除補賽公告與歷史新聞常見字
      if (
        rawText.includes("例行賽編號") ||
        rawText.includes("原場地進行補賽") ||
        rawText.includes("延賽至") ||
        rawText.includes("棒球場進行補賽") ||
        rawText.includes("先發") ||
        rawText.includes("盜壘")
      ) {
        return;
      }

      // 比對是否有對決的 2 支球隊
      const foundTeams = CPBL_TEAMS.filter(team => rawText.includes(team));

      if (foundTeams.length === 2 && rawText.length >= 6 && rawText.length <= 90) {
        const key = `${foundTeams[0]}-${foundTeams[1]}`;
        const reverseKey = `${foundTeams[1]}-${foundTeams[0]}`;

        if (!matches.some(m => m.key === key || m.key === reverseKey)) {
          // 狀態判定
          let statusEmoji = "🟢";
          let statusText = "進行中 / 賽前";

          if (rawText.includes("結束") || rawText.includes("終場") || rawText.includes("Final")) {
            statusEmoji = "🔴";
            statusText = "比賽結束";
          } else if (rawText.includes("延賽") || rawText.includes("取消") || rawText.includes("因雨")) {
            statusEmoji = "🌧️";
            statusText = "因雨延賽";
          }

          // 嘗試抓取分數或局數等簡要資訊
          // 如果卡片內有數字，過濾乾淨顯示
          matches.push({
            key,
            awayTeam: foundTeams[0],
            homeTeam: foundTeams[1],
            info: rawText,
            status: `${statusEmoji} ${statusText}`
          });
        }
      }
    });

    let messageContent = "";

    if (matches.length > 0) {
      messageContent = matches.map(m => {
        return `⚾ **${m.awayTeam}** vs **${m.homeTeam}**\n📊 **賽況資訊**：${m.info}\n📌 **狀態**：${m.status}`;
      }).join('\n\n───────────────\n\n');
    } else {
      messageContent = "ℹ️ 首頁頂部目前無進行中賽事或排定賽程（可能今日無賽事）。";
    }

    const payload = {
      content: `📢 **中華職棒 官方今日即時賽況 / 比分看板**\n\n${messageContent}`
    };

    console.log("🚀 正在發送訊息至 Discord Webhook...");
    await axios.post(DISCORD_WEBHOOK_URL, payload);
    console.log("✅ 成功推播頂部看板賽事到 Discord！");

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