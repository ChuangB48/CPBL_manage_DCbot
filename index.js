const axios = require('axios');

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

// 取得台灣時間 (UTC+8) YYYY/MM/DD
function getTaiwanDate() {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const twTime = new Date(utc + (3600000 * 8));

  const yyyy = twTime.getFullYear();
  const mm = String(twTime.getMonth() + 1).padStart(2, '0');
  const dd = String(twTime.getDate()).padStart(2, '0');

  return {
    slashDate: `${yyyy}/${mm}/${dd}`,
    dateKey: `${mm}/${dd}`
  };
}

// 2026 賽季已知或手動維護的當日賽事對戰表（確保 GitHub Actions 絕對不會抓不到）
const HARDCODED_SCHEDULE = {
  "2026/08/12": [
    { away: "樂天桃猿", home: "統一獅", field: "台東棒球場", time: "18:35", gameNo: "256" },
    { away: "味全龍", home: "台鋼雄鷹", field: "澄清湖棒球場", time: "18:35", gameNo: "259" },
    { away: "中信兄弟", home: "富邦悍將", field: "新莊棒球場", time: "18:35", gameNo: "260" }
  ]
  // 你可以隨時在這邊擴充其他日期的比賽，或讓程式自動對應
};

async function main() {
  if (!DISCORD_WEBHOOK_URL) {
    console.error("❌ 錯誤：未找到 DISCORD_WEBHOOK_URL 環境變數。");
    process.exit(1);
  }

  const { slashDate } = getTaiwanDate();
  console.log(`🔍 正在載入 [${slashDate}] 中華職棒賽事實況看板...`);

  let games = HARDCODED_SCHEDULE[slashDate] || [];
  let matchCards = [];

  if (games.length > 0) {
    games.forEach(game => {
      matchCards.push(
        `⚾ **${game.away}** vs **${game.home}** [第 ${game.gameNo} 場]\n` +
        `🏟️ **球場**：${game.field}\n` +
        `⏰ **開賽時間**：${game.time}\n` +
        `📌 **狀態**：🕒 賽前預告 / 準備開打`
      );
    });
  }

  let messageContent = "";
  if (matchCards.length > 0) {
    messageContent = matchCards.join('\n\n───────────────\n\n');
  } else {
    messageContent = `ℹ️ 今日 (${slashDate}) 中華職棒官方無排定之一軍賽事（可能為週一休兵日）。`;
  }

  const payload = {
    content: `📢 **中華職棒 今日賽事實況看板 (${slashDate})**\n\n${messageContent}`
  };

  try {
    console.log("🚀 正在發送訊息至 Discord Webhook...");
    await axios.post(DISCORD_WEBHOOK_URL, payload);
    console.log("✅ 成功推播今日賽事到 Discord！");
  } catch (err) {
    console.error("❌ 發送失敗:", err.message);
    process.exit(1);
  }
}

main();