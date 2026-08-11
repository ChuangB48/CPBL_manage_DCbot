const axios = require('axios');
const cheerio = require('cheerio');

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

const CPBL_TEAMS = [
  "中信兄弟", "統一7-ELEVEn獅", "統一獅", "味全龍",
  "富邦悍將", "樂天桃猿", "台鋼雄鷹"
];

// 取得台灣時間 (UTC+8) 的 MM/DD 與完整日期
function getTaiwanDateInfo() {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const twTime = new Date(utc + (3600000 * 8));
  
  const yyyy = twTime.getFullYear();
  const m = twTime.getMonth() + 1;
  const d = twTime.getDate();

  const mm = String(m).padStart(2, '0');
  const dd = String(d).padStart(2, '0');
  
  return {
    fullDate: `${yyyy}-${mm}-${dd}`,
    dateQuery: `${yyyy}/${mm}/${dd}`,
    shortDate: `${m}/${d}`, // 8/12
    paddedDate: `${mm}/${dd}` // 08/12
  };
}

async function main() {
  if (!DISCORD_WEBHOOK_URL) {
    console.error("❌ 錯誤：未找到 DISCORD_WEBHOOK_URL 環境變數，請確認 GitHub Secrets 設定。");
    process.exit(1);
  }

  try {
    const dateInfo = getTaiwanDateInfo();
    console.log(`🔍 正在抓取台灣時間 [${dateInfo.fullDate}] 的中職對戰賽程與比分...`);

    // 抓取 CPBL 官方賽程表完整頁面
    const response = await axios.get('https://www.cpbl.com.tw/schedule/index', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8'
      },
      timeout: 15000
    });

    const $ = cheerio.load(response.data);
    const matches = [];

    // 移除公告與頁尾，避免雜訊
    $('footer, marquee, .news, .notice').remove();

    // 搜尋包含今天日期的賽事卡片或列表列
    $('*').each((_, el) => {
      if ($(el).children().length > 8) return;

      const rawText = $(el).text().replace(/\s+/g, ' ').trim();

      // 檢查是否含有今天的日期特徵（如 08/12 或 8/12）以及對戰隊伍
      const hasToday = rawText.includes(dateInfo.shortDate) || rawText.includes(dateInfo.paddedDate) || rawText.includes(dateInfo.fullDate);
      const foundTeams = CPBL_TEAMS.filter(t => rawText.includes(t));

      // 條件：必須剛好包含兩隊
      if (foundTeams.length === 2 && rawText.length >= 8 && rawText.length <= 120) {
        // 如果當前區塊有今日日期，或是父層屬於當日區塊
        const key = `${foundTeams[0]}-${foundTeams[1]}`;
        const reverseKey = `${foundTeams[1]}-${foundTeams[0]}`;

        if (!matches.some(m => m.key === key || m.key === reverseKey)) {
          // 狀態判定
          let statusEmoji = "🕒";
          let statusText = "賽前預告 / 未開打";

          if (rawText.includes("結束") || rawText.includes("終場") || rawText.includes("Final")) {
            statusEmoji = "🔴";
            statusText = "比賽結束";
          } else if (rawText.includes("延賽") || rawText.includes("取消") || rawText.includes("因雨")) {
            statusEmoji = "🌧️";
            statusText = "因雨延賽";
          } else if (rawText.includes("LIVE") || rawText.includes("局") || /\d+\s*[-:比]\s*\d+/.test(rawText)) {
            statusEmoji = "🟢";
            statusText = "比賽進行中";
          }

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

    // 若官方賽程頁因改版未命中，備用抓取首頁今日賽事卡片
    if (matches.length === 0) {
      const homeRes = await axios.get('https://www.cpbl.com.tw/', {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
      });
      const $home = cheerio.load(homeRes.data);
      $home('footer, marquee, .news, .standing, .rank, .leaderboard, .sidebar').remove();

      $home('*').each((_, el) => {
        if ($home(el).children().length > 6) return;
        const text = $home(el).text().replace(/\s+/g, ' ').trim();
        const found = CPBL_TEAMS.filter(t => text.includes(t));

        if (found.length === 2 && text.length <= 60 && !/(盜壘|安打|排行榜|先發|補賽)/.test(text)) {
          const key = `${found[0]}-${found[1]}`;
          if (!matches.some(m => m.key === key)) {
            matches.push({
              key,
              awayTeam: found[0],
              homeTeam: found[1],
              info: text,
              status: "⚾ 當日排定賽程"
            });
          }
        }
      });
    }

    let messageContent = "";
    if (matches.length > 0) {
      messageContent = matches.map(m => {
        return `⚾ **${m.awayTeam}** vs **${m.homeTeam}**\n📋 **資訊**：${m.info}\n📌 **狀態**：${m.status}`;
      }).join('\n\n───────────────\n\n');
    } else {
      messageContent = `ℹ️ 今日 (${dateInfo.fullDate}) 中職官方未排定一軍賽事（休兵日）。`;
    }

    const payload = {
      content: `📢 **中華職棒 今日賽事對戰列表 (${dateInfo.fullDate})**\n\n${messageContent}`
    };

    console.log("🚀 正在發送訊息至 Discord Webhook...");
    await axios.post(DISCORD_WEBHOOK_URL, payload);
    console.log("✅ 成功推播對戰列表到 Discord！");

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