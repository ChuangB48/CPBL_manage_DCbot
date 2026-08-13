process.env.TZ = 'Asia/Taipei';

const puppeteer = require('puppeteer');
const axios = require('axios');
const { Client, GatewayIntentBits, ChannelType } = require('discord.js');

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID;

// 可以在此直接填入你的 Discord 類別 ID，或是設定環境變數 DISCORD_CATEGORY_ID
const DISCORD_CATEGORY_ID = process.env.DISCORD_CATEGORY_ID || '把你的類別ID貼在這邊';

function getTaiwanDate() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}/${mm}/${dd}`;
}

// 發送 Discord 文字訊息 (via Webhook)
async function sendToDiscord(content) {
  if (!DISCORD_WEBHOOK_URL) return;
  const chunks = content.match(/[\s\S]{1,1900}/g) || [content];
  for (const chunk of chunks) {
    await axios.post(DISCORD_WEBHOOK_URL, { content: chunk });
    await new Promise(r => setTimeout(r, 500));
  }
}

// 格式化單場賽事文字卡片
function formatMatchInfo(matchObj) {
  const { gameId, rawText, inning, pitcher, batter } = matchObj;
  const rawLines = rawText.split('\n').map(l => l.trim()).filter(Boolean);

  let gameType = '';
  let status = '';
  let time = '';
  let score = '';
  let otherLines = [];

  for (const line of rawLines) {
    if (/GAME\d+/i.test(line)) continue;
    
    if (/例行賽|熱身賽|明星賽|季後賽|總冠軍賽/.test(line)) {
      gameType = line;
    } else if (/未開始|進行中|已結束|延賽|因雨延賽|裁定/.test(line)) {
      status = line;
    } else if (/^\d{1,2}:\d{2}$/.test(line)) {
      time = line;
    } else if (/^\d+\s*[:：]\s*\d+$/.test(line)) {
      score = line;
    } else if (/^\d+-\d+-\d+$/.test(line)) {
      // 忽略戰績
    } else if (line.toLowerCase() === 'vs') {
      // 忽略 vs
    } else {
      otherLines.push(line);
    }
  }

  // 1. 狀態與局數
  let statusStr = status || '未開始';
  if (statusStr === '進行中') {
    statusStr = inning ? `進行中 (${inning})` : '進行中';
  }

  // 2. 隊名與球場
  let awayTeam = '';
  let homeTeam = '';
  let venue = '';

  if (otherLines.length >= 3) {
    awayTeam = otherLines[0];
    homeTeam = otherLines[otherLines.length - 1];
    venue = otherLines.slice(1, -1).join(' / ');
  } else if (otherLines.length === 2) {
    awayTeam = otherLines[0];
    homeTeam = otherLines[1];
  } else if (otherLines.length === 1) {
    awayTeam = otherLines[0];
  }

  // 將解析好的隊名寫回物件，方便開頻道使用
  matchObj.awayTeam = awayTeam;
  matchObj.homeTeam = homeTeam;

  // 3. 組合標題與基本資訊
  let header = `⚾ **${gameId}**`;
  if (gameType) header += ` *(${gameType})*`;

  let infoParts = [];
  infoParts.push(`📌 **狀態**：${statusStr}`);
  if (time) infoParts.push(`⏰ **${time}**`);
  if (venue) infoParts.push(`📍 **${venue}**`);

  let infoLine = `> ${infoParts.join(' ｜ ')}`;

  // 4. 對戰隊伍 / 比分
  let matchupLine = '';
  if (score) {
    matchupLine = `> ⚔️ **${awayTeam || '客隊'}** \`${score}\` **${homeTeam || '主隊'}**`;
  } else if (awayTeam && homeTeam) {
    matchupLine = `> ⚔️ **${awayTeam}** vs **${homeTeam}**`;
  } else if (otherLines.length > 0) {
    matchupLine = `> ⚔️ ${otherLines.join(' vs ')}`;
  }

  // 5. 當前投手 vs 打者 (有抓到正確姓名才顯示)
  let pbLine = '';
  if (pitcher || batter) {
    const pStr = pitcher ? `🎯 投手：**${pitcher}**` : '';
    const bStr = batter ? `🏏 打者：**${batter}**` : '';
    pbLine = `> ${[pStr, bStr].filter(Boolean).join('  vs  ')}`;
  }

  return [header, infoLine, matchupLine, pbLine].filter(Boolean).join('\n');
}

// 自動維護 Discord 語音頻道
async function manageVoiceChannels(matchesData) {
  if (!DISCORD_BOT_TOKEN || !DISCORD_GUILD_ID) {
    console.log("未設定 DISCORD_BOT_TOKEN 或 DISCORD_GUILD_ID，跳過語音頻道建立。");
    return;
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  try {
    await client.login(DISCORD_BOT_TOKEN);
    const guild = await client.guilds.fetch(DISCORD_GUILD_ID);

    let category = null;

    // 1. 優先使用指定的類別 ID 尋找現成類別
    if (DISCORD_CATEGORY_ID && DISCORD_CATEGORY_ID !== 1536369967274922037) {
      try {
        category = await guild.channels.fetch(DISCORD_CATEGORY_ID);
      } catch (e) {
        console.error("找不到指定的類別 ID，請確認 ID 是否正確。");
      }
    }

    // 2. 若沒設定 ID，預設找「⚾ 今日賽事討論區」
    if (!category) {
      category = guild.channels.cache.find(
        c => c.type === ChannelType.GuildCategory && c.name === '⚾ 今日賽事討論區'
      );
    }

    // 3. 都找不到才新建類別
    if (!category) {
      category = await guild.channels.create({
        name: '⚾ 今日賽事討論區',
        type: ChannelType.GuildCategory,
      });
    }

    // 4. 清理該類別下舊的賽事語音頻道
    const existingVoiceChannels = guild.channels.cache.filter(
      c => c.parentId === category.id && c.type === ChannelType.GuildVoice
    );

    for (const [_, channel] of existingVoiceChannels) {
      await channel.delete('清理舊賽事頻道');
    }

    // 5. 依照今日比賽建立語音頻道
    for (const match of matchesData) {
      const teams = (match.awayTeam && match.homeTeam) 
        ? `${match.awayTeam}vs${match.homeTeam}` 
        : '';
      const channelName = `🔊 ${teams} ${match.gameId}`.trim();

      await guild.channels.create({
        name: channelName.slice(0, 100),
        type: ChannelType.GuildVoice,
        parent: category.id,
      });
    }

    console.log(`已成功在指定類別（${category.name}）下建立今日 ${matchesData.length} 場語音頻道！`);
  } catch (error) {
    console.error("建立語音頻道時發生錯誤:", error);
  } finally {
    client.destroy();
  }
}

async function main() {
  const targetUrl = 'https://stats.cpbl.com.tw/';
  const browser = await puppeteer.launch({ 
    headless: "new", 
    args: ['--no-sandbox', '--disable-setuid-sandbox'] 
  });
  
  try {
    const page = await browser.newPage();
    await page.emulateTimezone('Asia/Taipei');
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    
    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 45000 });
    await new Promise(r => setTimeout(r, 6000));

    // 1. 抓取卡片與詳細頁連結
    const matchesData = await page.evaluate(() => {
      const allDivs = Array.from(document.querySelectorAll('div'));
      
      const candidateDivs = allDivs.filter(div => {
        const text = div.innerText.trim();
        const gameMatches = text.match(/GAME\d+/gi) || [];
        const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
        return gameMatches.length === 1 && lines.length >= 3 && lines.length <= 25;
      });

      candidateDivs.sort((a, b) => a.innerText.length - b.innerText.length);

      const seen = new Set();
      const results = [];

      for (const card of candidateDivs) {
        const text = card.innerText.trim();
        const gameIdMatch = text.match(/GAME\d+/gi);
        if (!gameIdMatch) continue;
        const gameId = gameIdMatch[0].toUpperCase();

        if (seen.has(gameId)) continue;
        seen.add(gameId);

        const anchor = card.querySelector('a') || card.closest('a');
        const boxUrl = anchor ? anchor.href : '';

        results.push({
          gameId,
          rawText: text,
          boxUrl,
          status: text.includes('進行中') ? '進行中' : '其他'
        });
      }

      return results;
    });

    // 2. 「進行中」比賽進詳細頁抓取局數與投打
    for (let match of matchesData) {
      if (match.status === '進行中' && match.boxUrl) {
        try {
          const detailPage = await browser.newPage();
          await detailPage.emulateTimezone('Asia/Taipei');
          await detailPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
          await detailPage.goto(match.boxUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
          await new Promise(r => setTimeout(r, 3000));

          const detailData = await detailPage.evaluate(() => {
            const fullText = document.body.innerText;

            let inning = '';
            const inningMatch = fullText.match(/(\d{1,2}|[一二三四五六七八九十]+)\s*局?\s*([上下])/);
            if (inningMatch) {
              inning = `${inningMatch[1]}局${inningMatch[2]}`;
            }

            // 黑名單，過濾表格欄位及賽況術語
            const invalidNames = [
              '局數', '打席', '打數', '安打', '得分', '打點', '三振', '四壞', '四死',
              '失分', '自責分', '投球數', '防禦率', '先發', '替補', '合計', '成績',
              '紀錄', '投手', '打者', '守備', '代打', '代跑', '勝投', '敗投', '救援',
              '出局', '好球', '壞球', '殘壘', '雙殺', '飛球', '滾地', '平飛', '接殺',
              '觸身', '暴投', '捕逸', '盜壘', '刺殺', '封殺', '野選', '一壘', '二壘',
              '三壘', '本壘', '無死', '一死', '二死', '保送', '換投', '暫停', '進行中'
            ];

            let pitcher = '';
            const pMatches = Array.from(fullText.matchAll(/(?:投手|投\s*手|P)\s*[:：]?\s*([\u4e00-\u9fa5·•]{2,8})/g));
            for (const m of pMatches) {
              const candidate = m[1].trim();
              if (!invalidNames.some(inv => candidate.includes(inv))) {
                pitcher = candidate;
                break;
              }
            }

            let batter = '';
            const bMatches = Array.from(fullText.matchAll(/(?:打者|打\s*者|B)\s*[:：]?\s*([\u4e00-\u9fa5·•]{2,8})/g));
            for (const m of bMatches) {
              const candidate = m[1].trim();
              if (!invalidNames.some(inv => candidate.includes(inv))) {
                batter = candidate;
                break;
              }
            }

            return { inning, pitcher, batter };
          });

          match.inning = detailData.inning;
          match.pitcher = detailData.pitcher;
          match.batter = detailData.batter;

          await detailPage.close();
        } catch (e) {
          console.error(`無法取得 ${match.gameId} 詳細資料:`, e.message);
        }
      }
    }

    await browser.close();

    // 3. 發送 Discord 文字推播
    const todayStr = getTaiwanDate();
    let output = `📢 **中華職棒 賽況回報 (${todayStr})**\n\n`;
    
    if (matchesData.length > 0) {
      matchesData.forEach((matchObj, idx) => {
        const formattedCard = formatMatchInfo(matchObj);
        output += `**場次 ${idx + 1}**\n${formattedCard}\n───────────────────\n`;
      });
    } else {
      output += `ℹ️ 今日 (${todayStr}) 尚無賽事資料或為休兵日。\n`;
    }

    await sendToDiscord(output);

    // 4. 自動建立 / 更新 Discord 語音頻道
    if (matchesData.length > 0) {
      await manageVoiceChannels(matchesData);
    }

  } catch (error) {
    console.error("執行發生錯誤:", error);
    process.exit(1);
  }
}

main();