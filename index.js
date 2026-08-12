const puppeteer = require('puppeteer');
const axios = require('axios');

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

async function main() {
  if (!DISCORD_WEBHOOK_URL) {
    console.error("❌ 錯誤：未找到 DISCORD_WEBHOOK_URL 環境變數。");
    process.exit(1);
  }

  console.log("🌐 正在啟動無頭瀏覽器載入 CPBL 官網...");
  
  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu'
    ]
  });

  try {
    const page = await browser.newPage();
    
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1280, height: 800 });

    console.log("📡 正在前往 CPBL 首頁...");
    await page.goto('https://www.cpbl.com.tw/', {
      waitUntil: 'networkidle2',
      timeout: 45000
    });

    console.log("⏳ 等待 Vue.js 渲染完成（等待樣板標籤解析）...");
    // 關鍵修復：等待日期欄位的 {{ ... }} 消失，確保 Vue 已經把資料填入畫面
    await page.waitForFunction(() => {
      const dateEl = document.querySelector('.date_selected .date, .IndexScheduleList .date');
      return dateEl && !dateEl.innerText.includes('{{') && dateEl.innerText.trim().length > 0;
    }, { timeout: 15000 }).catch(() => {
      console.log("⚠️ 達到等待上限，嘗試強制提取...");
    });

    // 稍微延遲 1 秒確保動畫與子元件全部掛載
    await new Promise(r => setTimeout(r, 1000));

    // 從已渲染完成的 DOM 抓取真實資訊
    const gameData = await page.evaluate(() => {
      const results = [];
      const items = document.querySelectorAll('.IndexScheduleList .game_item, .game_box .game_item');

      items.forEach(item => {
        const awayTeam = item.querySelector('.team.away .team_name, .team.away .name')?.innerText?.trim() || '';
        const homeTeam = item.querySelector('.team.home .team_name, .team.home .name')?.innerText?.trim() || '';
        const awayScore = item.querySelector('.score .num.away, .away_score')?.innerText?.trim() || '-';
        const homeScore = item.querySelector('.score .num.home, .home_score')?.innerText?.trim() || '-';
        const field = item.querySelector('.place, .field')?.innerText?.trim() || '未定球場';
        const gameNo = item.querySelector('.tag.game_no, .game_no')?.innerText?.trim() || '';
        const status = item.querySelector('.tag.game_status, .status')?.innerText?.trim() || '賽事預定';

        const winPitcher = item.querySelector('.PlayerMatchup.wins .name, .win_pitcher .name')?.innerText?.trim() || '';
        const losePitcher = item.querySelector('.PlayerMatchup.loses .name, .lose_pitcher .name')?.innerText?.trim() || '';

        if (awayTeam && homeTeam) {
          results.push({
            awayTeam,
            homeTeam,
            awayScore,
            homeScore,
            field,
            gameNo,
            status,
            winPitcher,
            losePitcher
          });
        }
      });

      const dateEl = document.querySelector('.date_selected .date, .IndexScheduleList .date');
      const dateText = (dateEl && !dateEl.innerText.includes('{{')) ? dateEl.innerText.trim() : '';

      return { dateText, results };
    });

    await browser.close();

    console.log(`✅ 解析完成，日期：[${gameData.dateText}]，共 ${gameData.results.length} 場賽事！`);

    let matchCards = [];
    gameData.results.forEach(g => {
      let statusDesc = `📌 **狀態**：${g.status}`;
      if (g.awayScore !== '-' && g.homeScore !== '-') {
        statusDesc += ` (${g.awayScore} : ${g.homeScore})`;
      }

      let pitcherDesc = "";
      if (g.winPitcher) {
        pitcherDesc = `\n🏆 **勝投**：${g.winPitcher} | **敗投**：${g.losePitcher || '無'}`;
      }

      matchCards.push(
        `⚾ **${g.awayTeam}** vs **${g.homeTeam}** ${g.gameNo ? `[${g.gameNo}]` : ''}\n` +
        `🏟️ **球場**：${g.field}\n` +
        `${statusDesc}${pitcherDesc}`
      );
    });

    let finalContent = "";
    if (matchCards.length > 0) {
      finalContent = matchCards.join('\n\n───────────────\n\n');
    } else {
      finalContent = `ℹ️ 今日 (${gameData.dateText || '當日'}) 官網首頁未排定一軍賽事（可能為休兵日）。`;
    }

    const payload = {
      content: `📢 **中華職棒 官方賽事實況看板 ${gameData.dateText ? `(${gameData.dateText})` : ''}**\n\n${finalContent}`
    };

    console.log("🚀 正在發送訊息至 Discord Webhook...");
    await axios.post(DISCORD_WEBHOOK_URL, payload);
    console.log("✅ 成功推播官網賽事實況到 Discord！");

  } catch (error) {
    if (browser) await browser.close();
    console.error("❌ 執行失敗:", error.message);
    process.exit(1);
  }
}

main();