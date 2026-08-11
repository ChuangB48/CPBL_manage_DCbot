const axios = require('axios');
const cheerio = require('cheerio');

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

// 取得台灣時間 (UTC+8) YYYY/MM/DD
function getTaiwanDate() {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const twTime = new Date(utc + (3600000 * 8));

  const yyyy = twTime.getFullYear();
  const mm = String(twTime.getMonth() + 1).padStart(2, '0');
  const dd = String(twTime.getDate()).padStart(2, '0');

  return `${yyyy}/${mm}/${dd}`;
}

async function main() {
  if (!DISCORD_WEBHOOK_URL) {
    console.error("❌ 錯誤：未找到 DISCORD_WEBHOOK_URL 環境變數，請確認 GitHub Secrets 設定。");
    process.exit(1);
  }

  const todayStr = getTaiwanDate();
  console.log(`🔍 正在從 CPBL 官網首頁提取賽事核心資料 [${todayStr}]...`);

  try {
    const response = await axios.get('https://www.cpbl.com.tw/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8'
      },
      timeout: 15000
    });

    const html = response.data;
    let games = [];

    // 1. 嘗試從 HTML 內部的 <script> 區塊提取初始化的 JSON 資料
    const jsonMatches = html.match(/(?:GameADetail|Games|gamesData)\s*[:=]\s*(\[\{.*?\}\])/s) ||
                        html.match(/var\s+gameList\s*=\s*(\[\{.*?\}\])/s);

    if (jsonMatches && jsonMatches[1]) {
      try {
        games = JSON.parse(jsonMatches[1]);
        console.log(`✅ 成功從首頁 Script 內解析出 ${games.length} 場賽事！`);
      } catch (e) {
        console.log("⚠️ JSON 解析失敗，切換至備用解析方案。");
      }
    }

    // 2. 如果沒有直接內嵌 JSON，改用精準的「比分板 (VSBox)」DOM 節點分析
    if (games.length === 0) {
      const $ = cheerio.load(html);

      // 鎖定一軍賽程容器 .IndexScheduleList.major
      $('.IndexScheduleList.major .game_item, .IndexSchedule .game_item').each((_, el) => {
        const item = $(el);
        const awayTeam = item.find('.team.away .team_name').text().trim();
        const homeTeam = item.find('.team.home .team_name').text().trim();
        const awayScore = item.find('.score .num.away').text().trim() || '-';
        const homeScore = item.find('.score .num.home').text().trim() || '-';
        const field = item.find('.place').first().text().trim() || '未定球場';
        const gameNo = item.find('.tag.game_no').text().trim();
        const statusTag = item.find('.tag.game_status').text().trim();

        // 投手資訊（若有）
        const winPitcher = item.find('.PlayerMatchup.wins .player .name').text().trim();
        const losePitcher = item.find('.PlayerMatchup.loses .player .name').text().trim();
        const savePitcher = item.find('.PlayerMatchup.saves .player .name').text().trim();

        if (awayTeam && homeTeam) {
          games.push({
            VisitingTeamName: awayTeam,
            HomeTeamName: homeTeam,
            VisitingTotalScore: awayScore,
            HomeTotalScore: homeScore,
            FieldAbbe: field,
            GameSno: gameNo,
            StatusText: statusTag,
            WinPitcher: winPitcher,
            LosePitcher: losePitcher,
            SavePitcher: savePitcher
          });
        }
      });
    }

    // 格式化推播內容
    let matchCards = [];

    games.forEach(game => {
      const away = game.VisitingTeamName || game.VisitingClubName || "客隊";
      const home = game.HomeTeamName || game.HomeClubName || "主隊";
      const awayScore = game.VisitingTotalScore ?? "-";
      const homeScore = game.HomeTotalScore ?? "-";
      const field = game.FieldAbbe || game.FieldName || "未定球場";
      const gameTag = game.GameSno ? `[${game.GameSno}]` : "";

      let status = "🕒 賽前預告 / 未開打";
      if (game.StatusText) {
        status = game.StatusText;
      } else if (game.GameStatus === 3 || String(game.VisitingTotalScore).match(/\d+/)) {
        status = `🔴 比賽結束 (${awayScore} : ${homeScore})`;
      } else if (game.GameStatus === 2) {
        status = `🟢 比賽進行中 (${awayScore} : ${homeScore})`;
      }

      let extraInfo = "";
      if (game.WinPitcher) {
        extraInfo = `\n🏆 **勝投**：${game.WinPitcher} | **敗投**：${game.LosePitcher || '無'}`;
        if (game.SavePitcher) extraInfo += ` | **救援**：${game.SavePitcher}`;
      }

      matchCards.push(
        `⚾ **${away}**  vs  **${home}** ${gameTag}\n` +
        `🏟️ **球場**：${field}\n` +
        `📌 **狀態**：${status}${extraInfo}`
      );
    });

    let finalContent = "";
    if (matchCards.length > 0) {
      finalContent = matchCards.join('\n\n───────────────\n\n');
    } else {
      finalContent = `ℹ️ 今日 (${todayStr}) 首頁無一軍賽事對戰組合（可能為休兵日或賽程已結束）。`;
    }

    const payload = {
      content: `📢 **中華職棒 今日賽事對戰列表 (${todayStr})**\n\n${finalContent}`
    };

    console.log("🚀 正在發送訊息至 Discord Webhook...");
    await axios.post(DISCORD_WEBHOOK_URL, payload);
    console.log("✅ 成功推播賽事資料到 Discord！");

  } catch (error) {
    console.error("❌ 執行過程發生錯誤:", error.message);
    if (error.response) {
      console.error(`狀態碼: ${error.response.status}`);
    }
    process.exit(1);
  }
}

main();