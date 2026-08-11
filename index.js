const axios = require('axios');
const cheerio = require('cheerio');

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

// 取得台灣時間 (UTC+8) 的年、月、日、YYYY/MM/DD
function getTaiwanDateInfo() {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const twTime = new Date(utc + (3600000 * 8));

  const yyyy = twTime.getFullYear();
  const mm = String(twTime.getMonth() + 1).padStart(2, '0');
  const dd = String(twTime.getDate()).padStart(2, '0');

  return {
    year: yyyy,
    month: mm,
    day: dd,
    fullDateSlash: `${yyyy}/${mm}/${dd}`,
    fullDateDash: `${yyyy}-${mm}-${dd}`
  };
}

async function fetchScheduleFromCalendar(dateInfo) {
  const { year, month, fullDateSlash, fullDateDash } = dateInfo;
  
  // 1. 嘗試調用中職賽程月曆 JSON API
  try {
    const apiUrl = `https://www.cpbl.com.tw/schedule/getschedule`;
    const res = await axios.post(
      apiUrl,
      new URLSearchParams({
        year: String(year),
        month: String(month),
        kindCode: 'A'
      }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'X-Requested-With': 'XMLHttpRequest',
          'Referer': 'https://www.cpbl.com.tw/schedule'
        },
        timeout: 10000
      }
    );

    let list = [];
    if (Array.isArray(res.data)) list = res.data;
    else if (Array.isArray(res.data?.GameADetail)) list = res.data.GameADetail;
    else if (Array.isArray(res.data?.Games)) list = res.data.Games;

    // 依今日日期過濾
    const todayGames = list.filter(g => {
      const gDate = g.GameDate || g.Date || '';
      return gDate.includes(fullDateSlash) || gDate.includes(fullDateDash);
    });

    if (todayGames.length > 0) return todayGames;
  } catch (err) {
    console.log(`⚠️ 賽程 API 呼叫失敗 (${err.message})，切換至 HTML 賽程表解析...`);
  }

  // 2. 備援方案：直接爬取 /schedule 靜態賽程頁面
  try {
    const schedulePageUrl = `https://www.cpbl.com.tw/schedule?year=${year}&month=${month}&kindCode=A`;
    const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(schedulePageUrl)}`;
    const pageRes = await axios.get(proxyUrl, { timeout: 12000 });
    const $ = cheerio.load(pageRes.data);
    
    let parsedGames = [];

    // 尋找包含今天日期的賽事卡片
    $(`.schedule_item, .game_item, tr`).each((_, el) => {
      const text = $(el).text();
      if (text.includes(fullDateSlash) || text.includes(`${month}/${dateInfo.day}`) || text.includes(`${parseInt(month)}/${parseInt(dateInfo.day)}`)) {
        const away = $(el).find('.team.away, .visiting, .away').text().trim();
        const home = $(el).find('.team.home, .home').text().trim();
        const place = $(el).find('.place, .field').text().trim();
        if (away && home) {
          parsedGames.push({
            VisitingTeamName: away,
            HomeTeamName: home,
            FieldAbbe: place || '中職指定球場',
            GameStatusText: '賽事排定中'
          });
        }
      }
    });

    if (parsedGames.length > 0) return parsedGames;
  } catch (e) {
    console.log("備援賽程爬取失敗:", e.message);
  }

  return [];
}

async function main() {
  if (!DISCORD_WEBHOOK_URL) {
    console.error("❌ 錯誤：未找到 DISCORD_WEBHOOK_URL 環境變數，請確認 GitHub Secrets 設定。");
    process.exit(1);
  }

  const dateInfo = getTaiwanDateInfo();
  console.log(`🔍 正在查詢中職官方賽程資料 [${dateInfo.fullDateSlash}]...`);

  try {
    const games = await fetchScheduleFromCalendar(dateInfo);
    let matchCards = [];

    if (games && games.length > 0) {
      games.forEach(game => {
        const away = game.VisitingTeamName || game.VisitingClubName || "客隊";
        const home = game.HomeTeamName || game.HomeClubName || "主隊";
        const awayScore = game.VisitingTotalScore ?? "-";
        const homeScore = game.HomeTotalScore ?? "-";
        const field = game.FieldAbbe || game.FieldName || "未定球場";
        const gameNo = game.GameSno ? `[第 ${game.GameSno} 場]` : "";

        let status = "🕒 賽前預告 / 尚未開打";
        if (game.GameStatus === 3 || game.GameStatusText?.includes("結束") || (awayScore !== '-' && homeScore !== '-')) {
          status = `🔴 比賽結束 (${awayScore} : ${homeScore})`;
        } else if (game.GameStatus === 2 || game.GameStatusText?.includes("進行中")) {
          status = `🟢 比賽進行中 (${awayScore} : ${homeScore})`;
        } else if (game.GameStatus === 4 || game.GameStatusText?.includes("延賽")) {
          status = "🌧️ 因雨延賽 / 取消";
        }

        let extra = "";
        if (game.VisitingStartingPitcherName || game.HomeStartingPitcherName) {
          extra = `\n🥊 **預告先發**：${game.VisitingStartingPitcherName || '未定'} vs ${game.HomeStartingPitcherName || '未定'}`;
        }

        matchCards.push(
          `⚾ **${away}**  vs  **${home}** ${gameNo}\n` +
          `🏟️ **球場**：${field}\n` +
          `📌 **狀態**：${status}${extra}`
        );
      });
    }

    let messageContent = "";
    if (matchCards.length > 0) {
      messageContent = matchCards.join('\n\n───────────────\n\n');
    } else {
      messageContent = `ℹ️ 今日 (${dateInfo.fullDateSlash}) 官方賽程表無一軍賽事（休兵日或季後無賽程）。`;
    }

    const payload = {
      content: `📢 **中華職棒 今日賽事實況看板 (${dateInfo.fullDateSlash})**\n\n${messageContent}`
    };

    console.log("🚀 正在發送訊息至 Discord Webhook...");
    await axios.post(DISCORD_WEBHOOK_URL, payload);
    console.log("✅ 成功推播今日賽事到 Discord！");

  } catch (error) {
    console.error("❌ 執行失敗:", error.message);
    process.exit(1);
  }
}

main();