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
    
    // 設定真實瀏覽器的 User-Agent 與視窗大小
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1280, height: 800 });

    console.log("📡 正在前往 CPBL 首頁...");
    await page.goto('https://www.cpbl.com.tw/', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    // 等待 Vue.js 渲染賽程卡片
    console.log("⏳ 等待賽程看板渲染完成...");
    await page.waitForSelector('.IndexScheduleList .game_item', { timeout: 10000 }).catch(() => {
      console.log("⚠️ 未在時限內找到 .game_item，繼續嘗試解析...");
    });

    // 從已渲染完成的 DOM 中提取資料
    const gameData = await page.evaluate(() => {
      const results = [];
      const items = document.querySelectorAll('.IndexScheduleList.major .game_item, .IndexSchedule .game_item');

      items.forEach(item => {
        const awayTeam = item.querySelector('.team.away .team_name')?.innerText?.trim() || '';
        const homeTeam = item.querySelector('.team.home .team_name')?.innerText?.trim() || '';
        const awayScore = item.querySelector('.score .num.away')?.innerText?.trim() || '-';
        const homeScore = item.querySelector('.score .num.home')?.innerText?.trim() || '-';
        const field = item.querySelector('.place')?.innerText?.trim() || '未定球場';
        const gameNo = item.querySelector('.tag.game_no')?.innerText?.trim() || '';
        const status = item.querySelector('.tag.game_status')?.innerText?.trim() || '賽前預告 / 未開打';

        // 投手資訊
        const winPitcher = item.querySelector('.PlayerMatchup.wins .player .name')?.innerText?.trim() || '';
        const losePitcher = item.querySelector('.PlayerMatchup.loses .player .name')?.innerText?.trim() || '';

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

      // 取得頁面顯示的日期
      const dateText = document.querySelector('.date_selected .date')?.innerText?.trim() || '';
      return { dateText, results };
    });

    await browser.close();

    console.log(`✅ 解析完成，共抓取到 ${gameData.results.length} 場賽事！`);

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
        `⚾ **${g.awayTeam}** vs **${g.homeTeam}** [${g.gameNo}]\n` +
        `🏟️ **球場**：${g.field}\n` +
        `${statusDesc}${pitcherDesc}`
      );
    });

    let finalContent = "";
    if (matchCards.length > 0) {
      finalContent = matchCards.join('\n\n───────────────\n\n');
    } else {
      finalContent = `ℹ️ 今日首頁未排定一軍賽事（可能為週一休兵日或賽程結束）。`;
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