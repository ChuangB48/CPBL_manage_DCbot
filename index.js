const axios = require('axios');
const cheerio = require('cheerio');
const cron = require('node-cron');

// 替換成你在 Discord 頻道設定中複製的 Webhook 網址
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || '你的_DISCORD_WEBHOOK_URL';

// 記錄前一次的比分狀態，避免重複洗版
let lastScoreRecord = "";

async function checkAndSendScores() {
    try {
        const response = await axios.get('https://www.cpbl.com.tw', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        const $ = cheerio.load(response.data);
        let currentScoreText = "";

        // 根據你調整好的 class 抓取資料
        $('.game_box, .item').each((index, element) => {
            const awayTeam = $(element).find('.team_away, .away').text().trim();
            const homeTeam = $(element).find('.team_home, .home').text().trim();
            const score = $(element).find('.score').text().trim();
            const status = $(element).find('.status, .inning').text().trim();

            if (awayTeam && homeTeam) {
                currentScoreText += `⚾ **${awayTeam}** vs **${homeTeam}**\n📊 比分：${score || "未開打"}\n⏱️ 狀態：${status}\n\n`;
            }
        });

        // 如果有抓到資料，且內容有更新才推播
        if (currentScoreText && currentScoreText !== lastScoreRecord) {
            lastScoreRecord = currentScoreText;

            await axios.post(DISCORD_WEBHOOK_URL, {
                embeds: [{
                    title: "📢 中華職棒 即時戰況更新",
                    description: currentScoreText,
                    color: 0x0080ff, // 藍色邊框
                    timestamp: new Date()
                }]
            });
            console.log("已成功推播最新戰況到 Discord！");
        } else {
            console.log("比分未變動或暫無比賽，不重複發送。");
        }

    } catch (error) {
        console.error("執行失敗:", error.message);
    }
}

// 本機測試：執行時先跑一次
checkAndSendScores();

// 排程：每天 18:00 到 22:00，每 3 分鐘檢查一次
cron.schedule('*/3 18-22 * * *', () => {
    console.log("正在執行比分檢查排程...");
    checkAndSendScores();
});