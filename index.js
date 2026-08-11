const axios = require('axios');
const cheerio = require('cheerio');

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

const CPBL_TEAMS = [
  "中信兄弟", "統一7-ELEVEn獅", "統一獅", "味全龍",
  "富邦悍將", "樂天桃猿", "台鋼雄鷹"
];

// 取得台灣時間 YYYY-MM-DD
function getTaiwanDateString() {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const twTime = new Date(utc + (3600000 * 8));
  
  const yyyy = twTime.getFullYear();
  const mm = String(twTime.getMonth() + 1).padStart(2, '0');
  const dd = String(twTime.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

async function main() {
  if (!DISCORD_WEBHOOK_URL) {
    console.error("❌ 錯誤：未找到 DISCORD_WEBHOOK_URL 環境變數，請確認 GitHub Secrets 設定。");
    process.exit(1);
  }

  try {
    const todayStr = getTaiwanDateString();
    console.log(`🔍 正在查詢 [${todayStr}] 中職當日賽程與即時比分 (via Yahoo 運動)...`);

    // 抓取 Yahoo 奇摩運動 中職比分/賽程頁面（不擋 GitHub Actions 機房）
    const response = await axios.get('https://tw.sports.yahoo.com/cpbl/schedule/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8'
      },
      timeout: 15000
    });

    const $ = cheerio.load(response.data);
    const matches = [];

    // 解析 Yahoo 賽程卡片
    $('div, li, section').each((_, el) => {
      // 避免父層大容器重複抓取
      if ($(el).children().length > 10) return;

      const rawText = $(el).text().replace(/\s+/g, ' ').trim();
      const foundTeams = CPBL_TEAMS.filter(team => rawText.includes(team));

      // 命中 2 支球隊對決
      if (foundTeams.length === 2 && rawText.length >= 8 && rawText.length <= 100) {
        // 排除新聞與非賽事條目
        if (/(新聞|影音|戰績排行|打擊榜|盜壘榜)/.test(rawText)) return;

        const key = `${foundTeams[0]}-${foundTeams[1]}`;
        const reverseKey = `${foundTeams[1]}-${foundTeams[0]}`;

        if (!matches.some(m => m.key === key || m.key === reverseKey)) {
          let status = "🕒 賽前預告 / 未開打";

          if (rawText.includes("結束") || rawText.includes("終場") || rawText.includes("Final")) {
            status = "🔴 比賽結束";
          } else if (rawText.includes("延賽") || rawText.includes("取消") || rawText.includes("因雨")) {
            status = "🌧️ 因雨延賽";
          } else if (/\d+\s*[-:比]\s*\d+/.test(rawText) || rawText.includes("局")) {
            status = "🟢 比賽進行中";
          }

          matches.push({
            key,
            awayTeam: foundTeams[0],
            homeTeam: foundTeams[1],
            info: rawText,
            status: status
          });
        }
      }
    });

    let messageContent = "";

    if (matches.length > 0) {
      messageContent = matches.map(m => {
        return `⚾ **${m.awayTeam}** vs **${m.homeTeam}**\n📋 **賽況/時間**：${m.info}\n📌 **狀態**：${m.status}`;
      }).join('\n\n───────────────\n\n');
    } else {
      messageContent = `ℹ️ 今日 (${todayStr}) 無排定賽事，或今日賽程尚未開始。`;
    }

    const payload = {
      content: `📢 **中華職棒 今日賽事對戰列表 (${todayStr})**\n\n${messageContent}`
    };

    console.log("🚀 正在發送訊息至 Discord Webhook...");
    await axios.post(DISCORD_WEBHOOK_URL, payload);
    console.log("✅ 成功推播對戰賽事到 Discord！");

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